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
// このツールの中心は「Claude がユーザーの意図をどう読み、それをどんな流れに落としているか」。
// 上から：
//   1. 意図の読み … ユーザーの言葉（引用）と Claude の読み、いま扱っている問い
//   2. 流れ       … 手順ごとに「なぜこの手順か」と、どの意図から出たか。
//                    言われていない前提に乗っている手順には、その前提を黄色で添える
//   3. あなたが決めること
//   4. 履歴（決まったこと・補った前提・置き換わったこと）… 参照用。たたんでおく
// 補った前提は読みがずれる原因の1つとして黄色で管理するが、中心には置かない。
// id（C12 など）は人が使わないので出さない。

export type Item = { key: string; text: string; sub?: string[]; tone?: 'supplemented' | 'dim' | 'new' | 'quote' | 'strong' }
export type Section = {
  key: string
  title: string
  tone?: 'supplemented' | 'dim'
  collapsible?: { open: boolean }   // 見出しを押すと開閉する
  items: Item[]
  groups?: { key: string; title: string; closed: boolean; items: Item[] }[]  // 決まったことの問いごとのまとまり
}

// flipped は「既定の開閉から反転させた見出し」のキー
export const sections = (b: Board, flipped: ReadonlySet<string>): Section[] => {
  const isOpen = (key: string, byDefault: boolean) => (flipped.has(key) ? !byDefault : byDefault)
  const decided = new Map(b.decided.map(c => [c.id, c] as const))
  const supplemented = new Map(b.supplemented.map(c => [c.id, c] as const))
  const isNew = (c: { turn: number }) => c.turn === b.turn
  const out: Section[] = []

  // 1. 意図の読み
  const focus = b.open[0]
  out.push({
    key: 'reading',
    title: '意図の読み',
    items: b.goal
      ? [
          ...b.goal.quote.map((q, i) => ({ key: `quote:${i}`, text: `「${q}」`, tone: 'quote' as const })),
          { key: 'reading', text: b.goal.reading, tone: 'strong' as const },
          ...(focus ? [{ key: 'focus', text: `いま扱っている問い：${focus.question}`, tone: 'dim' as const }] : []),
        ]
      : [{ key: 'reading-none', text: 'まだ読めていない', tone: 'dim' as const }],
  })

  // 2. 流れ
  if (b.steps.length) {
    out.push({
      key: 'flow',
      title: '流れ',
      items: b.steps.map((st, i) => {
        const basis = st.from
          .map(f => (f === 'goal' ? '目的' : decided.has(f) ? `「${decided.get(f)!.content}」` : null))
          .filter((x): x is string => x !== null)
        const premises = st.from.map(f => supplemented.get(f)).filter(c => c !== undefined)
        const sub = [
          ...(st.why ? [st.why] : []),
          ...(basis.length ? [`← ${basis.join('・')}`] : []),
          ...premises.map(c => `言われていない前提：${c!.content}${c!.reason ? `（${c!.reason}）` : ''}`),
        ]
        return { key: `p:${i}`, text: `${i + 1}. ${st.text}`, sub }
      }),
    })
  }

  // 3. あなたが決めること
  const mine = b.open.filter(q => q.owner === 'user')
  if (mine.length)
    out.push({ key: 'mine', title: `あなたが決めること（${mine.length}）`, items: mine.map(q => ({ key: `q:${q.id}`, text: q.question })) })

  // 4. 履歴
  if (b.decided.length) {
    const open = isOpen('decided', false)
    const item = (id: string): Item => {
      const c = decided.get(id)!
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

  if (b.supplemented.length) {
    const open = isOpen('supplemented', false)
    const fresh = b.supplemented.filter(isNew).length
    out.push({
      key: 'supplemented',
      title: `補った前提（${b.supplemented.length}${fresh ? `・うち新しく ${fresh}` : ''}）`,
      tone: 'supplemented',
      collapsible: { open },
      items: open
        ? [...b.supplemented].reverse().map(c => ({
            key: `s:${c.id}`, text: `${isNew(c) ? '新 ' : ''}${c.content}`, sub: c.reason ? [c.reason] : [], tone: 'supplemented' as const,
          }))
        : [],
    })
  }

  if (b.replaced.length) {
    const open = isOpen('replaced', false)
    out.push({
      key: 'replaced', title: `置き換わったこと（${b.replaced.length}）`, tone: 'dim', collapsible: { open },
      items: open
        ? b.replaced.map(r => ({
            key: `x:${r.id}`,
            text: r.content,
            sub: [r.replaced_by ? `→ ${decided.get(r.replaced_by)?.content ?? supplemented.get(r.replaced_by)?.content ?? '（その後さらに変わった）'}` : '→ 取り消し'],
            tone: 'dim' as const,
          }))
        : [],
    })
  }
  return out
}

// 帯の2行目：流れの次の一歩
export const nextStep = (b: Board) => (b.steps.length ? `次：${b.steps[0]!.text}${b.steps.length > 1 ? `（ほか ${b.steps.length - 1}）` : ''}` : null)

export const who =(owner: 'user' | 'claude') => (owner === 'user' ? 'ユーザー' : 'Claude が決めて事後報告')
