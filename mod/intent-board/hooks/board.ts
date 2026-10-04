import type { Board } from '../types'

// board.json の置き場：<一時フォルダ>/discourse-state/<セッション id>/board.json
export const boardPath = (tmp: string, sessionId: string) =>
  `${tmp.replace(/[\\/]+$/, '')}/discourse-state/${sessionId}/board.json`

// 書きかけ・壊れたファイルは null（描かない）
export const parseBoard = (text: string | undefined): Board | null => {
  if (!text) return null
  try {
    const b = JSON.parse(text)
    if (!b || !Array.isArray(b.decided) || !Array.isArray(b.supplemented)) return null
    // 木の無い古い形は、全部を目的の直下に置く
    if (!b.tree) b.tree = { nodes: [], loose: [...b.decided, ...b.supplemented].map((c: { id: string }) => c.id) }
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

// 帯：目的の読み（width 桁まで）・補った前提の数・開いている問いの数
export const bandLine = (b: Board, width = 60) => {
  const goal = b.goal ? clip(b.goal.reading, width) : '目的：未設定'
  return { goal, supplemented: b.supplemented.length, open: b.open.length }
}

// ---------------------------------------------------------------- ペインの中身（描画は register.tsx）
//
// ボードを開くのは「Claude の読みがずれていないか」を確かめるとき。だから上から順に：
//   1. このターンで補ったこと … いちばん止めたいもの。理由つきで全部開く
//   2. あなたが決めること     … ユーザーの手番
//   3. いま進めていること     … 手順。読みが手順にどう効いているか
//   4. 履歴（これまでの補完・決まったこと・置き換わったこと）… 参照用。たたんでおく
// id（C12 など）は人が使わないので出さない。

export type Item = { key: string; text: string; sub?: string; tone?: 'supplemented' | 'dim' | 'new' }
export type Section = {
  key: string
  title: string
  tone?: 'supplemented' | 'dim'
  collapsible?: { open: boolean }   // 見出しを押すと開閉する
  items: Item[]
  groups?: { key: string; title: string; closed: boolean; items: Item[] }[]  // 決まったことの問いごとのまとまり
}

const MAX_STEPS = 5

// flipped は「既定の開閉から反転させた見出し」のキー
export const sections = (b: Board, flipped: ReadonlySet<string>): Section[] => {
  const isOpen = (key: string, byDefault: boolean) => (flipped.has(key) ? !byDefault : byDefault)
  const content = new Map([...b.decided, ...b.supplemented].map(c => [c.id, c.content] as const))
  const isNew = (c: { turn: number }) => c.turn === b.turn
  const out: Section[] = []

  // 1. このターンで補ったこと
  const fresh = b.supplemented.filter(isNew)
  out.push({
    key: 'fresh',
    title: fresh.length ? `このターンで補ったこと（${fresh.length}）` : 'このターンで補ったこと',
    tone: 'supplemented',
    items: fresh.length
      ? fresh.map(c => ({ key: `s:${c.id}`, text: c.content, sub: c.reason, tone: 'supplemented' as const }))
      : [{ key: 'fresh-none', text: 'なし', tone: 'dim' }],
  })

  // 2. あなたが決めること
  const mine = b.open.filter(q => q.owner === 'user')
  if (mine.length)
    out.push({ key: 'mine', title: `あなたが決めること（${mine.length}）`, items: mine.map(q => ({ key: `q:${q.id}`, text: q.question })) })

  // 3. いま進めていること
  if (b.steps.length) {
    const key = 'steps'
    const long = b.steps.length > MAX_STEPS
    const open = isOpen(key, false)
    const shown = long && !open ? b.steps.slice(0, MAX_STEPS) : b.steps
    out.push({
      key,
      title: 'いま進めていること',
      ...(long ? { collapsible: { open } } : {}),
      items: [
        ...shown.map((st, i) => ({ key: `p:${i}`, text: `${i + 1}. ${st.text}` })),
        ...(long && !open ? [{ key: 'p-more', text: `ほか ${b.steps.length - MAX_STEPS}件`, tone: 'dim' as const }] : []),
      ],
    })
  }

  // 4. 履歴
  const older = b.supplemented.filter(c => !isNew(c))
  if (older.length) {
    const open = isOpen('older', false)
    out.push({
      key: 'older', title: `これまでの補った前提（${older.length}）`, tone: 'dim', collapsible: { open },
      items: open ? [...older].reverse().map(c => ({ key: `s:${c.id}`, text: c.content, sub: c.reason, tone: 'supplemented' as const })) : [],
    })
  }

  if (b.decided.length) {
    const open = isOpen('decided', false)
    const decided = new Set(b.decided.map(c => c.id))
    const item = (id: string): Item => {
      const c = b.decided.find(x => x.id === id)!
      return { key: `c:${id}`, text: c.content, tone: isNew(c) ? 'new' : undefined }
    }
    const groups = open
      ? [
          ...[...b.tree.nodes].reverse()
            .map(n => ({ key: `g:${n.id}`, title: n.question, closed: n.closed, items: n.items.filter(id => decided.has(id)).map(item) }))
            .filter(g => g.items.length),
          ...(b.tree.loose.some(id => decided.has(id))
            ? [{ key: 'g:loose', title: 'その他', closed: false, items: b.tree.loose.filter(id => decided.has(id)).map(item) }]
            : []),
        ]
      : []
    out.push({ key: 'decided', title: `決まったこと（${b.decided.length}）`, tone: 'dim', collapsible: { open }, items: [], groups })
  }

  if (b.replaced.length) {
    const open = isOpen('replaced', false)
    out.push({
      key: 'replaced', title: `置き換わったこと（${b.replaced.length}）`, tone: 'dim', collapsible: { open },
      items: open
        ? b.replaced.map(r => ({
            key: `x:${r.id}`,
            text: r.content,
            sub: r.replaced_by ? `→ ${content.get(r.replaced_by) ?? '（その後さらに変わった）'}` : '→ 取り消し',
            tone: 'dim' as const,
          }))
        : [],
    })
  }
  return out
}

export const who =(owner: 'user' | 'claude') => (owner === 'user' ? 'ユーザー' : 'Claude が決めて事後報告')
