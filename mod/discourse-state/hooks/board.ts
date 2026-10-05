import type { Board, Flag, Task, TaskItem } from '../types'

// board.json の置き場：<一時フォルダ>/discourse-state/<セッション id>/board.json
export const boardPath = (tmp: string, sessionId: string) =>
  `${tmp.replace(/[\\/]+$/, '')}/discourse-state/${sessionId}/board.json`

// 書きかけ・壊れたファイルは null（描かない）
export const parseBoard = (text: string | undefined): Board | null => {
  if (!text) return null
  try {
    const b = JSON.parse(text)
    if (!b || !Array.isArray(b.decided) || !Array.isArray(b.supplemented)) return null
    // 古い形（木・作業の無いもの）でも描けるように埋める
    if (!b.tree) b.tree = { nodes: [], loose: [...b.decided, ...b.supplemented].map((c: { id: string }) => c.id) }
    if (!Array.isArray(b.tasks)) b.tasks = []
    return b as Board
  } catch {
    return null
  }
}

// 表示幅（全角＝2桁）で切る
const cols = (ch: string) => (/[ -~｡-ﾟ]/.test(ch) ? 1 : 2)
export const clip = (s: string, width: number) => {
  let used = 0
  let out = ''
  for (const ch of s) {
    if (used + cols(ch) > width - 1) return `${out}…`
    used += cols(ch)
    out += ch
  }
  return out
}

// いま扱っている作業：いちばん新しい開いている問いから、意図を持つ作業まで親をたどる
export const focusTask = (b: Board): Task | null => {
  const byId = new Map(b.tasks.map(t => [t.id, t]))
  let t = b.open.length ? byId.get(b.open[0]!.id) ?? null : null
  while (t && !t.intent) t = t.parent ? byId.get(t.parent) ?? null : null
  return t
}

// 帯の1行目：いま扱っている作業の意図の読み（width 桁まで）。作業に意図が無ければ旧い会話全体の目的
export const bandLine = (b: Board, width = 60) => {
  const reading = focusTask(b)?.intent?.reading ?? b.goal?.reading
  return { goal: reading ? clip(reading, width) : '意図：まだ読めていない', supplemented: b.supplemented.length, open: b.open.length }
}

// 帯の2行目：流れの次の一歩
export const nextStep = (b: Board) => (b.steps.length ? `次：${b.steps[0]!.text}${b.steps.length > 1 ? `（ほか ${b.steps.length - 1}）` : ''}` : null)

// ---------------------------------------------------------------- ペインの中身（描画は register.tsx）
//
// 中心は「作業ごとの意図」。作業は木（作業の分解）で、各作業の下に意図の読みと、決まったことがぶら下がる。
// 決まったこと同士の線には関係ラベル（答え・補足・理由・対比・結果・条件）。訂正で置き換えたものは置き換え元を添える。
// 文脈の補完（Claude が補った前提）は黄色。監査の指摘はボードに出さない（本体にだけ渡す）。置き換えの履歴はたたむ。
// id（C12 など）は人が使わないので出さない。

export type Item = {
  key: string
  text: string
  sub?: string[]
  tone?: 'supplemented' | 'dim' | 'new' | 'quote' | 'strong' | 'flagged' | 'task'
  indent?: number                  // 字下げの段（木の深さ）
  toggle?: { open: boolean }       // 押すと開閉する行（作業の見出し）
}
export type Section = {
  key: string
  title: string
  tone?: 'supplemented' | 'dim' | 'flagged'
  collapsible?: { open: boolean }
  items: Item[]
}

export const REL_LABEL: Record<TaskItem['rel'], string> = {
  answer: '答え', elaboration: '補足', explanation: '理由', contrast: '対比', result: '結果', condition: '条件',
}
const FLAG_LABEL: Record<Flag['kind'], string> = { deviation: '食い違い', attribution: '出どころ', relevance: '問いへの答え', unclosed: '問いの閉じ方' }
const who = (owner: 'user' | 'claude') => (owner === 'user' ? 'あなた' : 'Claude')

// flipped は「既定の開閉から反転させた行・見出し」のキー
export const sections = (b: Board, flipped: ReadonlySet<string>, audit: readonly Flag[] = []): Section[] => {
  const isOpen = (key: string, byDefault: boolean) => (flipped.has(key) ? !byDefault : byDefault)
  const out: Section[] = []

  // 監査の指摘（赤）。ボードは書き換えていない
  if (audit.length)
    out.push({
      key: 'audit', title: `監査の指摘（${audit.length}）`, tone: 'flagged',
      items: audit.map((f, i) => ({ key: `a:${i}`, text: `${FLAG_LABEL[f.kind]}：${f.text}`, tone: 'flagged' as const })),
    })

  // 作業の木
  const items: Item[] = []
  // 片付いた作業は出さない（その下の作業ごと）
  const children = (parent: string | null) => b.tasks.filter(t => t.parent === parent && !t.closed)
  const task = (t: Task, depth: number) => {
    const key = `t:${t.id}`
    const open = isOpen(key, true)
    items.push({ key, indent: depth, tone: 'task', toggle: { open }, text: `${t.question}（決める人：${who(t.owner)}）` })
    if (!open) return
    if (t.intent) {
      items.push({ key: `${key}:reading`, indent: depth + 1, tone: 'strong', text: `意図：${t.intent.reading}` })
      for (const [i, q] of t.intent.quote.entries()) items.push({ key: `${key}:quote:${i}`, indent: depth + 2, tone: 'quote', text: `「${q}」` })
    }
    const edge = (parent: string | null, d: number) => {
      for (const it of t.items.filter(x => x.parent === parent)) {
        const sup = it.by === 'claude'
        const sub = [
          ...(it.replaces ? [`「${it.replaces}」を置き換え`] : []),
          ...(sup && it.reason ? [`補った理由：${it.reason}`] : []),
        ]
        items.push({
          key: `c:${it.id}`, indent: d,
          text: `${it.turn === b.turn ? '新 ' : ''}${REL_LABEL[it.rel]}${sup ? '（補完）' : ''}：${it.content}`,
          tone: sup ? 'supplemented' : it.turn === b.turn ? 'new' : undefined,
          ...(sub.length ? { sub } : {}),
        })
        edge(it.id, d + 1)
      }
    }
    edge(null, depth + 1)
    for (const c of children(t.id)) task(c, depth + 1)
  }
  for (const r of children(null)) task(r, 0)
  if (items.length) out.push({ key: 'tasks', title: '作業と意図', items })

  // どの作業にも付いていない決まったこと（古い記録など）。片付いた作業のものは出さない。消さずにたたむ
  const loose = [...b.decided, ...b.supplemented].filter(c => b.tree.loose.includes(c.id))
  if (loose.length) {
    const open = isOpen('loose', false)
    const sup = new Set(b.supplemented.map(c => c.id))
    out.push({
      key: 'loose', title: `どの作業にも付いていない決まったこと（${loose.length}）`, tone: 'dim', collapsible: { open },
      items: open
        ? loose.map(c => ({ key: `l:${c.id}`, text: `${sup.has(c.id) ? '（補完）' : ''}${c.content}`, tone: sup.has(c.id) ? ('supplemented' as const) : undefined }))
        : [],
    })
  }

  // 流れ
  if (b.steps.length) {
    const content = new Map([...b.decided, ...b.supplemented].map(c => [c.id, c.content] as const))
    out.push({
      key: 'flow', title: '流れ',
      items: b.steps.map((st, i) => {
        const basis = st.from.map(f => (f === 'goal' ? null : content.get(f))).filter((x): x is string => !!x).map(x => `「${x}」`)
        return { key: `p:${i}`, text: `${i + 1}. ${st.text}`, sub: [...(st.why ? [st.why] : []), ...(basis.length ? [`← ${basis.join('・')}`] : [])] }
      }),
    })
  }

  // 置き換わったこと（履歴）
  if (b.replaced.length) {
    const open = isOpen('replaced', false)
    const content = new Map([...b.decided, ...b.supplemented].map(c => [c.id, c.content] as const))
    out.push({
      key: 'replaced', title: `置き換わったこと（${b.replaced.length}）`, tone: 'dim', collapsible: { open },
      items: open
        ? b.replaced.map(r => ({
            key: `x:${r.id}`, text: r.content, tone: 'dim' as const,
            sub: [r.replaced_by ? `→ ${content.get(r.replaced_by) ?? '（その後さらに変わった）'}` : '→ 取り消し'],
          }))
        : [],
    })
  }
  return out
}
