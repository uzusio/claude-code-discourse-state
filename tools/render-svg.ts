// README 用に、意図ボード（帯とペイン）を SVG に描き出す。
// 並びと中身は mod と同じ関数（sections / bandLine / nextStep）から作るので、mod の表示とずれない。
// 中身は自己言及の例（poc/examples/self.jsonl）：「Claude の意図の読みを見たい」と頼まれて、このボードを作る会話そのもの。
// 会話の実データは使わない。
//
// 使い方（リポジトリの直下で）: npx tsx tools/render-svg.ts
// 出力: docs/board.svg
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { bandLine, nextStep, sections } from '../mod/discourse-state/hooks/board'
import type { Item, Section } from '../mod/discourse-state/hooks/board'
import { board, replay } from '../mod/discourse-state/hooks/state'
import type { Diff } from '../mod/discourse-state/hooks/state'
import type { Flag } from '../mod/discourse-state/types'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------- 例のデータ
const diffs = readFileSync(join(root, 'poc/examples/self.jsonl'), 'utf-8')
  .split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l) as Diff)
const b = board(replay(diffs, 'example'))
// 監査の指摘はボードに出さない（Claude にだけ渡す）
const audit: Flag[] = []

// ---------------------------------------------------------------- 行に起こす（register.tsx の描き方に合わせる）
type Tone = 'white' | 'gray' | 'yellow' | 'red' | 'cyan' | 'accent'
type Line = { indent: number; text: string; tone: Tone; bold?: boolean }

const COLS = 76
const width = (s: string) => [...s].reduce((n, ch) => n + (/[ -~｡-ﾟ]/.test(ch) ? 1 : 2), 0)
// 行頭に来てはいけない文字（閉じ括弧・句読点）は、はみ出しても前の行に残す
const NO_HEAD = /[）」』】〕、。，．・ー！？)\]]/
const wrap = (text: string, cols: number): string[] => {
  const out: string[] = []
  let cur = ''
  for (const ch of text) {
    if (width(cur + ch) > cols && !NO_HEAD.test(ch)) { out.push(cur); cur = '' }
    cur += ch
  }
  if (cur) out.push(cur)
  return out.length ? out : ['']
}
const push = (lines: Line[], indent: number, text: string, tone: Tone, bold = false, hang = 0) => {
  wrap(text, COLS - indent * 2).forEach((t, i) => lines.push({ indent: indent + (i ? hang : 0), text: t, tone, bold }))
}

const toneOf = (it: Item): Tone =>
  it.tone === 'supplemented' ? 'yellow' : it.tone === 'flagged' ? 'red' : it.tone === 'new' ? 'cyan' : it.tone === 'dim' || it.tone === 'quote' ? 'gray' : 'white'

const pane: Line[] = []
pane.push({ indent: 0, text: '[閉じる]', tone: 'accent' })
for (const sec of sections(b, new Set(), audit) as Section[]) {
  const headTone: Tone = sec.tone === 'supplemented' ? 'yellow' : sec.tone === 'flagged' ? 'red' : 'white'
  push(pane, 0, sec.collapsible ? `${sec.collapsible.open ? '▾' : '▸'} ${sec.title}` : sec.title, headTone, true)
  for (const it of sec.items) {
    const d = 1 + (it.indent ?? 0)
    if (it.toggle) { push(pane, d, `${it.toggle.open ? '▾' : '▸'} ${it.text}`, 'white', true, 1); continue }
    push(pane, d, it.text, toneOf(it), it.tone === 'strong', 1)
    for (const s of it.sub ?? []) push(pane, d + 1, s, 'gray')
  }
  pane.push({ indent: 0, text: '', tone: 'white' })
}

const band: Line[] = []
const line = bandLine(b, 2 * COLS)
push(band, 0, `意図：${line.goal}`, 'white')
band.push({ indent: 0, text: nextStep(b) ?? '流れ：まだ無い', tone: 'gray' })

// ---------------------------------------------------------------- SVG
const FONT = 15
const LH = 22
const CW = FONT * 0.6
const PAD = 20
const COLORS: Record<Tone, string> = {
  white: '#e6edf3', gray: '#8b949e', yellow: '#e3b341', red: '#f85149', cyan: '#39c5cf', accent: '#58a6ff',
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// 1枚の SVG にする。button は帯の2行目の右端に描くボタンの文字
const toSvg = (rows: (Line | 'rule')[], title: string, button: string, buttonRow: Line) => {
  const H = PAD * 2 + rows.length * LH + 30
  const W = PAD * 2 + COLS * CW + 20
  const body = rows.map((r, i) => {
    const y = PAD + 30 + i * LH
    if (r === 'rule') return `<line x1="${PAD}" y1="${y - LH / 2 + 4}" x2="${W - PAD}" y2="${y - LH / 2 + 4}" stroke="#30363d"/>`
    if (!r.text) return ''
    const btn = r === buttonRow ? `<text x="${W - PAD}" y="${y}" text-anchor="end" fill="${COLORS.accent}">${esc(button)}</text>` : ''
    const spans = r.text.split(/(｜ 監査の指摘 \d+)/)
      .map(p => (p.startsWith('｜ 監査の指摘') ? `<tspan fill="${COLORS.red}">${esc(p)}</tspan>` : esc(p))).join('')
    return `<text x="${PAD + r.indent * 2 * CW}" y="${y}" fill="${COLORS[r.tone]}"${r.bold ? ' font-weight="bold"' : ''}>${spans}</text>${btn}`
  }).join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'Cascadia Mono','Consolas','Menlo','Noto Sans Mono CJK JP','MS Gothic',monospace" font-size="${FONT}">
<rect width="${W}" height="${H}" rx="10" fill="#0d1117"/>
<circle cx="${PAD + 6}" cy="${PAD}" r="6" fill="#ff5f56"/><circle cx="${PAD + 26}" cy="${PAD}" r="6" fill="#ffbd2e"/><circle cx="${PAD + 46}" cy="${PAD}" r="6" fill="#27c93f"/>
<text x="${W / 2}" y="${PAD + 5}" text-anchor="middle" fill="${COLORS.gray}" font-size="13">${esc(title)}</text>
${body}
</svg>
`
}

const prompt: Line = { indent: 0, text: '> ', tone: 'white' }
const lastBand = band[band.length - 1]!

// ボードを開いた状態
const opened = toSvg([...pane, 'rule', ...band, 'rule', prompt], 'ボードを開いた状態', '[ボードを閉じる]', lastBand)

// ボードを閉じた状態：会話の続きの上に、帯だけが出る
const chat: Line[] = []
push(chat, 0, '> 帯とボードで、Claude の読みを見られるようにして', 'gray')
chat.push({ indent: 0, text: '', tone: 'white' })
push(chat, 0, '● プロンプトの上に意図の読みと次の一歩を出して、詳しくはボタンで開くボードに分けたよ。', 'white', false, 1)
push(chat, 1, '⎿ 帯とボードを描く mod を書いた', 'gray')
chat.push({ indent: 0, text: '', tone: 'white' })
const closed = toSvg([...chat, 'rule', ...band, 'rule', prompt], 'ボードを閉じた状態', '[ボードを開く]', lastBand)

mkdirSync(join(root, 'docs'), { recursive: true })
for (const [name, svg] of [['board.svg', opened], ['board-closed.svg', closed]] as const) {
  const out = join(root, 'docs', name)
  writeFileSync(out, svg)
  console.log(out)
}
