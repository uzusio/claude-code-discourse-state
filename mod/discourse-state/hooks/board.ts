import type { Board, Flag, Task, TaskItem } from '../types'

// 記録の置き場の元になる Claude の設定フォルダ：CLAUDE_CONFIG_DIR、無ければ <ホーム>/.claude（ホームは USERPROFILE、無ければ HOME）
// 一時フォルダはクリーンアップで消えるので使わない。決められないときは黙って別の場所に落とさず投げる
export const recordsBase = (env: { CLAUDE_CONFIG_DIR?: string; USERPROFILE?: string; HOME?: string }): string => {
  if (env.CLAUDE_CONFIG_DIR) return env.CLAUDE_CONFIG_DIR
  const home = env.USERPROFILE || env.HOME
  if (home) return `${home.replace(/[\\/]+$/, '')}/.claude`
  throw new Error('記録の置き場を決められない：CLAUDE_CONFIG_DIR・USERPROFILE・HOME のどれも無い')
}

// board.json の置き場：<Claude の設定フォルダ>/discourse-state/<セッション id>/board.json
export const boardPath = (base: string, sessionId: string) =>
  `${base.replace(/[\\/]+$/, '')}/discourse-state/${sessionId}/board.json`

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
// 「意図：」は描く側が付ける
export const bandLine = (b: Board, width = 60) => {
  const reading = focusTask(b)?.intent?.reading ?? b.goal?.reading ?? emptyNote(b)
  return { goal: clip(reading, width), supplemented: b.supplemented.length, open: b.open.length }
}

// 開いている作業が無いとき。全部片付いたのか、まだ何も書かれていないのかを分けて言う（片付いた件数はペインの「片付いた作業」の欄に出る）
export const emptyNote = (b: Board) =>
  b.open.length === 0 && b.tasks.some(t => t.closed) ? '開いている作業はない' : 'まだ読めていない'

// 帯の2行目：流れの次の一歩
// 帯の2行目：いま扱っている作業の流れの次の一歩（作業に流れが無ければ全体の流れ）
export const nextStep = (b: Board) => {
  const f = focusTask(b)
  const steps = f && f.steps?.length ? f.steps : b.steps
  return steps.length ? `次：${steps[0]!.text}${steps.length > 1 ? `（ほか ${steps.length - 1}）` : ''}` : null
}

// ---------------------------------------------------------------- ペインの中身（描画は register.tsx）
//
// 作業は木（作業の分解）。各作業が持つのは3つだけ：
//   意図       … ユーザーの言葉と Claude の読み。訂正されたら読みが書き換わり、前の読みを薄く添える
//   文脈の補完 … その読みのために Claude が補った前提（黄色、理由つき）。補完どうしの関係はラベルで
//   流れ       … これからの手順と、手順ごとの「なぜ」
// ユーザーが言った決定の一覧は持たない（ボードは Claude に差し込まないので記憶の助けにならず、見る側には雑音になる）。
// 片付いた作業は「片付いた作業」の欄にたたんで残す（流れは出さない）。監査の指摘も出さない（Claude にだけ渡す）。id は出さない。

export type Item = {
  key: string
  text: string
  sub?: string[]
  tone?: 'supplemented' | 'dim' | 'new' | 'quote' | 'strong' | 'flagged' | 'task' | 'label'
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

// flipped は「既定の開閉から反転させた行」のキー
export const sections = (b: Board, flipped: ReadonlySet<string>, audit: readonly Flag[] = []): Section[] => {
  const isOpen = (key: string, byDefault: boolean) => (flipped.has(key) ? !byDefault : byDefault)
  const out: Section[] = []

  if (audit.length)
    out.push({
      key: 'audit', title: `監査の指摘（${audit.length}）`, tone: 'flagged',
      items: audit.map((f, i) => ({ key: `a:${i}`, text: `${FLAG_LABEL[f.kind]}：${f.text}`, tone: 'flagged' as const })),
    })

  const focus = focusTask(b)
  const items: Item[] = []
  const live = b.tasks.filter(t => !t.closed)
  const done = b.tasks.filter(t => t.closed)
  // 作業を木で並べる：byDefault＝既定で開くか、withFlow＝流れを出すか、kids＝子の選び方
  type Mode = { byDefault: boolean; withFlow: boolean; kids: (id: string) => Task[] }
  const task = (items: Item[], m: Mode, t: Task, depth: number): void => {
    const key = `t:${t.id}`
    const open = isOpen(key, m.byDefault)
    items.push({ key, indent: depth, tone: 'task', toggle: { open }, text: t.question })
    if (!open) return
    const d = depth + 1

    // 意図
    if (t.intent) {
      items.push({ key: `${key}:reading`, indent: d, tone: 'strong', text: `意図：${t.intent.reading}` })
      for (const [i, q] of t.intent.quote.entries()) items.push({ key: `${key}:quote:${i}`, indent: d + 1, tone: 'quote', text: `「${q}」` })
      const prev = t.intent_history[t.intent_history.length - 1]
      if (prev) items.push({ key: `${key}:prev`, indent: d + 1, tone: 'dim', text: `前の読み：${prev.reading}` })
    }

    // 文脈の補完（Claude が補った前提だけ。補完どうしの線にはラベル）
    const sup = t.items.filter(it => it.by === 'claude')
    const supIds = new Set(sup.map(it => it.id))
    const edge = (parent: string | null, dd: number) => {
      for (const it of sup.filter(x => (x.parent && supIds.has(x.parent) ? x.parent : null) === parent)) {
        const label = parent ? `補完（${REL_LABEL[it.rel]}）` : '補完'
        items.push({
          key: `c:${it.id}`, indent: dd, tone: 'supplemented',
          text: `${it.turn === b.turn ? '新 ' : ''}${label}：${it.content}`,
          ...(it.reason ? { sub: [`補った理由：${it.reason}`] } : {}),
        })
        edge(it.id, dd + 1)
      }
    }
    edge(null, d)

    // 流れ（作業の流れ。作業に無ければ、いま扱っている作業にだけ全体の流れを出す）
    const steps = !m.withFlow ? [] : t.steps.length ? t.steps : t.id === focus?.id ? b.steps : []
    if (steps.length) {
      items.push({ key: `${key}:flow`, indent: d, tone: 'label', text: '流れ' })
      steps.forEach((st, i) => items.push({ key: `${key}:p:${i}`, indent: d + 1, text: `${i + 1}. ${st.text}`, ...(st.why ? { sub: [st.why] } : {}) }))
    }

    for (const c of m.kids(t.id)) task(items, m, c, d)
  }

  // 作業と意図：開いている作業。親が片付いていても、開いている子は根として残す
  const liveIds = new Set(live.map(t => t.id))
  const liveMode: Mode = { byDefault: true, withFlow: true, kids: id => live.filter(t => t.parent === id) }
  for (const r of live.filter(t => !t.parent || !liveIds.has(t.parent))) task(items, liveMode, r, 0)
  out.push({ key: 'tasks', title: '作業と意図', items: items.length ? items : [{ key: 'none', tone: 'dim', text: emptyNote(b) }] })

  // 片付いた作業：既定ではたたむ。新しい順。流れは出さない
  if (done.length) {
    const open = isOpen('archive', false)
    const archive: Item[] = []
    if (open) {
      const doneIds = new Set(done.map(t => t.id))
      const doneMode: Mode = { byDefault: false, withFlow: false, kids: id => done.filter(t => t.parent === id) }
      for (const r of done.filter(t => !t.parent || !doneIds.has(t.parent)).reverse()) task(archive, doneMode, r, 0)
    }
    out.push({ key: 'archive', title: `片付いた作業（${done.length}）`, tone: 'dim', collapsible: { open }, items: archive })
  }
  return out
}
