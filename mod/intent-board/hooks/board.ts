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

// ---------------------------------------------------------------- ペインの木（行の並びとして作る。描画は register.tsx）

const RECENT_SUP = 3

export type Row = {
  key: string
  depth: number
  text: string
  tone?: 'supplemented' | 'dim' | 'head' | 'new'
  toggle?: { open: boolean }  // 押すと開閉する行
}

// 既定の開閉：開いている問い・新しい決定を含む枝は開く。片付いた問い・目的の直下・置き換えはたたむ
// expanded は「既定から反転させた行」のキー
export const outline = (b: Board, flipped: ReadonlySet<string>): Row[] => {
  const rows: Row[] = []
  const items = new Map([...b.decided, ...b.supplemented].map(c => [c.id, c] as const))
  const supplemented = new Set(b.supplemented.map(c => c.id))
  const isNew = (id: string) => (items.get(id)?.turn ?? -1) === b.turn
  const isOpen = (key: string, byDefault: boolean) => (flipped.has(key) ? !byDefault : byDefault)
  const children = (parent: string | null) => b.tree.nodes.filter(n => n.parent === parent)
  const hasNew = (id: string): boolean => {
    const n = b.tree.nodes.find(x => x.id === id)
    return !!n && (n.items.some(isNew) || children(id).some(c => hasNew(c.id)))
  }
  const item = (id: string, depth: number) => {
    const c = items.get(id)
    if (!c) return
    const mark = isNew(id) ? '新 ' : ''
    // 補った前提は上の「要確認」に出すので、木には言われたことだけを置く
    if (supplemented.has(id)) return
    rows.push({ key: `c:${id}`, depth, text: `${mark}${id} ${c.content}`, tone: isNew(id) ? 'new' : undefined })
  }

  rows.push({ key: 'goal', depth: 0, text: `目的：${b.goal?.reading ?? '未設定'}`, tone: 'head' })

  if (b.supplemented.length) {
    rows.push({ key: 'sup', depth: 0, text: `要確認：補った前提 ${b.supplemented.length}件`, tone: 'supplemented' })
    const sup = (c: Board['supplemented'][number]) => {
      rows.push({ key: `s:${c.id}`, depth: 1, text: `${isNew(c.id) ? '新 ' : ''}${c.id} ${c.content}`, tone: 'supplemented' })
      if (c.reason) rows.push({ key: `r:${c.id}`, depth: 2, text: `理由：${c.reason}`, tone: 'dim' })
    }
    // 新しいもの（最大 RECENT_SUP 件）だけ開く。残りはたたむ
    const older = b.supplemented.slice(0, Math.max(0, b.supplemented.length - RECENT_SUP))
    if (older.length) {
      const open = isOpen('sup-older', false)
      rows.push({ key: 'sup-older', depth: 1, text: `それより前 ${older.length}件`, toggle: { open }, tone: 'dim' })
      if (open) older.forEach(sup)
    }
    b.supplemented.slice(older.length).forEach(sup)
  }

  const node = (id: string, depth: number) => {
    const n = b.tree.nodes.find(x => x.id === id)!
    const key = `q:${id}`
    const open = isOpen(key, !n.closed || hasNew(id))
    const decided = n.items.filter(c => !supplemented.has(c)).length
    const label = n.closed ? `✓ ${id} ${n.question}（決定 ${decided}件）` : `○ ${id} ${n.question}（決める人：${who(n.owner)}）`
    rows.push({ key, depth, text: label, toggle: { open }, tone: n.closed ? 'dim' : undefined })
    if (!open) return
    for (const c of n.items) item(c, depth + 1)
    for (const ch of children(id)) node(ch.id, depth + 1)
  }
  if (b.tree.nodes.length) rows.push({ key: 'qs', depth: 0, text: '問い', tone: 'head' })
  for (const r of children(null)) node(r.id, 1)

  const loose = b.tree.loose.filter(id => !supplemented.has(id))
  if (loose.length) {
    const open = isOpen('loose', loose.some(isNew))
    rows.push({ key: 'loose', depth: 0, text: `どの問いにも付いていない決定 ${loose.length}件`, toggle: { open }, tone: 'dim' })
    if (open) for (const id of loose) item(id, 1)
  }

  if (b.replaced.length) {
    const open = isOpen('replaced', false)
    rows.push({ key: 'replaced', depth: 0, text: `置き換わったこと ${b.replaced.length}件`, toggle: { open }, tone: 'dim' })
    if (open)
      for (const r of b.replaced)
        rows.push({ key: `x:${r.id}`, depth: 1, text: `${r.id} ${r.content} → ${r.replaced_by ?? '取り消し'}`, tone: 'dim' })
  }

  if (b.steps.length) {
    rows.push({ key: 'steps', depth: 0, text: 'いまの手順', tone: 'head' })
    b.steps.forEach((s, i) => rows.push({ key: `p:${i}`, depth: 1, text: `${i + 1}. ${s.text}  ← ${s.from.join('・')}` }))
  }
  return rows
}

export const who =(owner: 'user' | 'claude') => (owner === 'user' ? 'ユーザー' : 'Claude が決めて事後報告')
