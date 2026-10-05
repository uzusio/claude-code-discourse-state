// 会話の状態（SDRT の関係ラベル＋QUD の問いのスタック）を差分で更新する純粋関数。
// poc/discourse_state.py の移植。両者は poc/examples/audit_job.jsonl で同じ結果になることをテストで確かめる。
import type { Board } from '../types'

export type By = 'user' | 'claude'
export type Commitment = {
  id: string; content: string; source: string | null; depends_on: string[]; by: By
  reason?: string; confirmed_by?: string | null; turn: number
  rel?: EdgeRel                              // 親（depends_on の先頭）との線の種類
  replaces?: { id: string; content: string } // 訂正で置き換えた古い決定
}
export type EdgeRel = 'elaboration' | 'explanation' | 'contrast' | 'result' | 'condition'
export type Intent = { quote: string[]; reading: string; source: string | null }
export type Question = {
  id: string; question: string; opened_by: string | null; answers: string[]; parent: string | null; owner: By
  closed: boolean  // 片付いた問いも消さずに残す（QUD の木）
  intent?: Intent | null  // この作業の意図（ユーザーの言葉と Claude の読み）
}
export type State = {
  session: string; turn: number
  goal: { quote: string[]; reading: string; source: string | null } | null
  questions: Question[]; commitments: Commitment[]
  retracted: { id: string; content: string; turn: number; source: string | null; replaced_by: string | null }[]
  steps: { text: string; from: string[]; why?: string }[]
  counters: { C: number; Q: number }
}
export type Op = { op: string; [k: string]: any }
export type Diff = {
  turn?: number; utterance_id?: string; text?: string; relation?: string
  target?: string | null; markers?: string[]; ops?: Op[]
}

// Contrast（並べるだけ・取り消さない）・Explanation（理由づけ）・Clarification（確かめる問い）は 2026-10-05 に SDRT から追加
export const RELATIONS = ['Correction', 'Elaboration', 'Continuation', 'Result', 'Condition', 'Answer', 'Open', 'Acknowledge', 'Contrast', 'Explanation', 'Clarification']
export const OPS = ['add', 'confirm', 'retract', 'amend', 'recheck', 'open', 'answer', 'move', 'intent', 'goal', 'plan', 'none']
// 決まったこと同士の線の種類。作業への「答え」と、置き換えの「訂正」は別の仕組みで表す
export const EDGE_RELS: EdgeRel[] = ['elaboration', 'explanation', 'contrast', 'result', 'condition']
const BY = ['user', 'claude']
const ID_RE = /^([CQ])(\d+)$/

export const emptyState = (session: string): State => ({
  session, turn: 0, goal: null, questions: [], commitments: [], retracted: [], steps: [], counters: { C: -1, Q: -1 },
})

const find = <T extends { id: string }>(items: T[], id: string) => items.find(it => it.id === id)

export const dependents = (s: State, cid: string) =>
  s.commitments.filter(c => (c.depends_on ?? []).includes(cid)).map(c => c.id)

export const nextIds = (s: State) => ({ C: `C${s.counters.C + 1}`, Q: `Q${s.counters.Q + 1}` })

const bump = (counters: State['counters'], id: string) => {
  const m = ID_RE.exec(id)
  if (m) counters[m[1] as 'C' | 'Q'] = Math.max(counters[m[1] as 'C' | 'Q'], Number(m[2]))
}

// 構造だけを見る。「その差分が発言の正しい読みか」は判定機の仕事
export const validate = (s: State, diff: Diff): string[] => {
  const problems: string[] = []
  const rel = diff.relation
  if (!rel || !RELATIONS.includes(rel)) problems.push(`relation が不正: ${JSON.stringify(rel)}`)
  const ops = diff.ops
  if (!Array.isArray(ops)) return [...problems, 'ops がリストでない']

  const cids = new Set(s.commitments.map(c => c.id))
  const qids = new Set(s.questions.map(q => q.id))
  const added = new Set(ops.filter(o => o.op === 'add' && o.id).map(o => o.id as string))
  const seenAdded = new Set<string>()
  const opened = new Set<string>()
  const retracted: string[] = []
  const rechecked = new Set<string>()
  const hasGoal = s.goal !== null || ops.some(o => o.op === 'goal')

  ops.forEach((op, i) => {
    const where = `ops[${i}]`
    const kind = op.op
    if (!OPS.includes(kind)) return void problems.push(`${where}: op が不正: ${JSON.stringify(kind)}`)
    if (kind === 'add') {
      const { id, content } = op
      if (!id || !content) return void problems.push(`${where}: add には id と content が要る`)
      if (cids.has(id) || seenAdded.has(id)) problems.push(`${where}: ${id} は既にある`)
      else if (!ID_RE.test(id) || id[0] !== 'C') problems.push(`${where}: コミットメントの id は C+数字: ${JSON.stringify(id)}`)
      else seenAdded.add(id)
      for (const d of op.depends_on ?? []) if (!cids.has(d) && !seenAdded.has(d)) problems.push(`${where}: 依存先 ${d} が存在しない`)
      if (op.rel !== undefined) {
        if (!EDGE_RELS.includes(op.rel)) problems.push(`${where}: rel は ${EDGE_RELS.join('/')} のどれか: ${JSON.stringify(op.rel)}`)
        else if (!(op.depends_on ?? []).length) problems.push(`${where}: rel を付けるなら depends_on（親）が要る`)
      }
      const by = op.by ?? 'user'
      if (!BY.includes(by)) problems.push(`${where}: by は user か claude: ${JSON.stringify(by)}`)
      else if (by === 'claude' && !op.reason) problems.push(`${where}: 補った前提（by=claude）には reason が要る`)
    } else if (kind === 'confirm') {
      const c = find(s.commitments, op.id)
      if (!c) problems.push(`${where}: confirm の対象 ${JSON.stringify(op.id)} が存在しない`)
      else if ((c.by ?? 'user') !== 'claude') problems.push(`${where}: ${c.id} は補った前提ではない`)
    } else if (kind === 'retract' || kind === 'amend' || kind === 'recheck') {
      const cid = op.id
      if (!cids.has(cid)) return void problems.push(`${where}: ${kind} の対象 ${JSON.stringify(cid)} が存在しない`)
      if (kind === 'retract') {
        retracted.push(cid)
        const rb = op.replaced_by
        if (rb && !cids.has(rb) && !added.has(rb)) problems.push(`${where}: replaced_by ${JSON.stringify(rb)} が存在しない`)
      } else if (kind === 'recheck') rechecked.add(cid)
      else if (!op.content) problems.push(`${where}: amend には content（書き直し後の全文）が要る`)
    } else if (kind === 'open') {
      const { id, question } = op
      if (!id || !question) return void problems.push(`${where}: open には id と question が要る`)
      if (qids.has(id) || opened.has(id)) problems.push(`${where}: ${id} は既にある`)
      else if (!ID_RE.test(id) || id[0] !== 'Q') problems.push(`${where}: 問いの id は Q+数字: ${JSON.stringify(id)}`)
      else opened.add(id)
      if (op.parent && !qids.has(op.parent) && !opened.has(op.parent)) problems.push(`${where}: 親の問い ${JSON.stringify(op.parent)} が存在しない`)
      if (!BY.includes(op.owner ?? 'user')) problems.push(`${where}: owner は user か claude: ${JSON.stringify(op.owner)}`)
      if (op.intent !== undefined && (typeof op.intent !== 'object' || !op.intent?.reading)) problems.push(`${where}: open の intent には reading（読み）が要る`)
    } else if (kind === 'answer') {
      if (!qids.has(op.question) && !opened.has(op.question)) problems.push(`${where}: answer の対象 ${JSON.stringify(op.question)} が存在しない`)
      if (op.by && !cids.has(op.by) && !seenAdded.has(op.by)) problems.push(`${where}: answer の by ${JSON.stringify(op.by)} が存在しない`)
    } else if (kind === 'move') {
      // 決まったことを別の作業へ付け替える：ほかの作業の答えから外し、その作業の答えにする
      if (!cids.has(op.id) && !seenAdded.has(op.id)) problems.push(`${where}: move の対象 ${JSON.stringify(op.id)} が存在しない`)
      if (!qids.has(op.question) && !opened.has(op.question)) problems.push(`${where}: move の行き先 ${JSON.stringify(op.question)} が存在しない`)
    } else if (kind === 'intent') {
      if (!qids.has(op.question) && !opened.has(op.question)) problems.push(`${where}: intent の対象 ${JSON.stringify(op.question)} が存在しない`)
      if (!op.reading) problems.push(`${where}: intent には reading（読み）が要る`)
    } else if (kind === 'goal') {
      if (!op.quote?.length || !op.reading) problems.push(`${where}: goal には quote（引用）と reading（読み）が要る`)
    } else if (kind === 'plan') {
      const steps = op.steps
      if (!Array.isArray(steps) || !steps.length) return void problems.push(`${where}: plan には steps が要る`)
      steps.forEach((st: any, j: number) => {
        if (!st.text) problems.push(`${where}.steps[${j}]: text が要る`)
        const srcs: string[] = st.from ?? []
        if (!srcs.length) problems.push(`${where}.steps[${j}]: from（どの意図から出た手順か）が要る`)
        for (const f of srcs) {
          if (f === 'goal') { if (!hasGoal) problems.push(`${where}.steps[${j}]: 目的がまだ置かれていない`) }
          else if (!cids.has(f) && !added.has(f)) problems.push(`${where}.steps[${j}]: from ${JSON.stringify(f)} が存在しない`)
          else if (retracted.includes(f)) problems.push(`${where}.steps[${j}]: from ${JSON.stringify(f)} は取り消されている`)
        }
      })
    }
  })

  for (const cid of retracted)
    for (const d of dependents(s, cid))
      if (!rechecked.has(d) && !retracted.includes(d)) problems.push(`${d} は ${cid} に依存しているが recheck も retract もされていない`)

  const kinds = ops.map(o => o.op)
  if (rel === 'Correction' && !kinds.some(k => k === 'retract' || k === 'amend')) problems.push('Correction なのに retract / amend が無い')
  if (rel === 'Acknowledge' && kinds.some(k => k !== 'none' && k !== 'confirm')) problems.push('Acknowledge なのに状態を変える op がある')
  if (rel === 'Open' && !kinds.includes('open')) problems.push('Open なのに open が無い')
  if (rel === 'Answer' && !kinds.includes('answer')) problems.push('Answer なのに answer が無い')
  if (rel === 'Contrast' && kinds.includes('retract')) problems.push('Contrast は取り消さない（取り消すなら Correction）')
  if (rel === 'Explanation' && !diff.target && !ops.some(o => o.op === 'add' && (o.depends_on ?? []).length))
    problems.push('Explanation には理由づけの対象（target か depends_on）が要る')
  if (rel === 'Clarification' && !kinds.includes('open')) problems.push('Clarification なのに open が無い')
  return problems
}

// validate 済みを前提に、新しい状態を返す。入力は変えない
export const apply = (state: State, diff: Diff): State => {
  const s: State = structuredClone(state)
  s.turn = Number(diff.turn ?? s.turn + 1)
  const src = diff.utterance_id ?? null
  for (const op of diff.ops ?? []) {
    switch (op.op) {
      case 'add': {
        const c: Commitment = { id: op.id, content: op.content, source: src, depends_on: [...(op.depends_on ?? [])], by: op.by ?? 'user', turn: s.turn }
        if (op.rel) c.rel = op.rel
        if (c.by === 'claude') c.reason = op.reason
        s.commitments.push(c)
        bump(s.counters, op.id)
        break
      }
      case 'confirm': {
        const c = find(s.commitments, op.id)
        if (c) { c.by = 'user'; c.confirmed_by = src }
        break
      }
      case 'retract': {
        const gone = op.id
        const old = find(s.commitments, gone)
        if (old) s.retracted.push({ id: gone, content: old.content, turn: s.turn, source: src, replaced_by: op.replaced_by ?? null })
        s.commitments = s.commitments.filter(c => c.id !== gone)
        for (const c of s.commitments) c.depends_on = c.depends_on.filter(d => d !== gone)
        for (const q of s.questions) q.answers = q.answers.filter(a => a !== gone)
        for (const st of s.steps) st.from = st.from.filter(f => f !== gone)
        break
      }
      case 'amend': {
        const c = find(s.commitments, op.id)
        if (c) c.content = op.content
        break
      }
      case 'open':
        s.questions.push({ id: op.id, question: op.question, opened_by: src, answers: [], parent: op.parent ?? null, owner: op.owner ?? 'user', closed: false, intent: toIntent(op.intent, src) })
        bump(s.counters, op.id)
        break
      case 'answer': {
        const q = find(s.questions, op.question)
        if (!q) break
        if (op.by && !q.answers.includes(op.by)) q.answers.push(op.by)
        if (op.complete) q.closed = true
        break
      }
      case 'move': {
        for (const q of s.questions) q.answers = q.answers.filter(a => a !== op.id)
        const q = find(s.questions, op.question)
        if (q) q.answers.push(op.id)
        break
      }
      case 'intent': {
        const q = find(s.questions, op.question)
        if (q) q.intent = toIntent(op, src)
        break
      }
      case 'goal':
        s.goal = { quote: [...op.quote], reading: op.reading, source: src }
        break
      case 'plan':
        s.steps = op.steps.map((st: any) => ({ text: st.text, from: [...st.from], ...(st.why ? { why: st.why } : {}) }))
        break
    }
  }
  // 訂正で置き換えたものは、新しい方に「何を置き換えたか」を残す（add と retract の順番によらない）
  for (const op of diff.ops ?? []) {
    if (op.op !== 'retract' || !op.replaced_by) continue
    const c = find(s.commitments, op.replaced_by)
    const old = s.retracted.find(r => r.id === op.id)
    if (c && old) c.replaces = { id: old.id, content: old.content }
  }
  return s
}

const toIntent = (it: any, src: string | null): Intent | null =>
  it && it.reading ? { quote: [...(it.quote ?? [])], reading: it.reading, source: src } : null

export const replay = (diffs: Diff[], session: string): State => {
  let s = emptyState(session)
  diffs.forEach((d, n) => {
    const p = validate(s, d)
    if (p.length) throw new Error(`diff #${n} (${d.utterance_id}): ${p.join('; ')}`)
    s = apply(s, d)
  })
  return s
}

// board_update の結果に返す短い要約。全体を返すと毎ターン数千トークンになるので、
// 次の差分を書くのに要るもの（読み・開いている問い・最近の決定・手順・次の ID）だけにする
export const renderCompact = (s: State, recent = 8): string => {
  const lines: string[] = []
  const open = s.questions.filter(q => !q.closed)
  lines.push(`開いている作業: ${open.length ? open.map(q => `${q.id} ${q.question}${q.intent ? `〔意図：${q.intent.reading}〕` : '〔意図なし〕'}`).join(' ／ ') : 'なし'}`)
  const tail = s.commitments.slice(-recent)
  lines.push(`最近の決定（全 ${s.commitments.length} 件中 ${tail.length} 件）:`)
  for (const c of tail) lines.push(`- ${c.id}${c.by === 'claude' ? '（補完）' : ''} ${c.content}`)
  lines.push(`手順: ${s.steps.length ? s.steps.map((st, i) => `${i + 1}. ${st.text}`).join(' ／ ') : 'なし'}`)
  const nx = nextIds(s)
  lines.push(`次の ID: ${nx.C} / ${nx.Q}`)
  return lines.join('\n')
}

// 指定した id の決定・問いだけを1行ずつ（検証で弾かれたとき、問題に出た id を見せる）
export const renderIds = (s: State, ids: string[]): string =>
  ids
    .map(id => {
      const c = s.commitments.find(x => x.id === id)
      if (c) return `- ${c.id} ${c.content}`
      const q = s.questions.find(x => x.id === id)
      return q ? `- ${q.id} ${q.question}${q.closed ? '（片付き）' : ''}` : `- ${id}（存在しない）`
    })
    .join('\n')

// 全体の文面（デバッグ用）
export const render = (s: State): string => {
  const lines = ['## 現在の状態（コードが差分ログから導出。ここに無い決定・問いは存在しない）']
  lines.push(s.goal ? `### 目的\n- 引用: ${s.goal.quote.map(q => `「${q}」`).join(' ')}\n- 読み: ${s.goal.reading}` : '### 目的\n- 未設定')
  const openQs = s.questions.filter(q => !q.closed)
  const closedQs = s.questions.filter(q => q.closed)
  lines.push('### 開いている問い（上が最上位）')
  if (openQs.length)
    for (const q of [...openQs].reverse())
      lines.push(`- ${q.id}: ${q.question}  回答: ${q.answers.length ? q.answers.join(', ') : 'なし'}  決める人: ${q.owner}`)
  else lines.push('- なし')
  if (closedQs.length) {
    lines.push('### 片付いた問い')
    for (const q of closedQs) lines.push(`- ${q.id}: ${q.question}`)
  }
  lines.push('### 有効なコミットメント')
  if (s.commitments.length)
    for (const c of s.commitments)
      lines.push(`- ${c.id}: ${c.content}  ← ${c.source ?? '?'}${c.depends_on.length ? `  依存: ${c.depends_on.join(', ')}` : ''}${c.by === 'claude' ? `  【補った前提】理由: ${c.reason}` : ''}`)
  else lines.push('- なし')
  lines.push('### 手順')
  if (s.steps.length) s.steps.forEach((st, i) => lines.push(`${i + 1}. ${st.text}  ← ${st.from.join(', ')}`))
  else lines.push('- なし')
  const nx = nextIds(s)
  lines.push(`次の ID: ${nx.C} / ${nx.Q}`)
  return lines.join('\n')
}

export const board = (s: State, recent = 3): Board => {
  const item = (c: Commitment) => ({ id: c.id, content: c.content, source: c.source, turn: c.turn ?? 0, ...(c.reason ? { reason: c.reason } : {}) })
  return {
    turn: s.turn,
    goal: s.goal,
    decided: s.commitments.filter(c => (c.by ?? 'user') === 'user').map(item),
    replaced: s.retracted.slice(-recent),
    supplemented: s.commitments.filter(c => c.by === 'claude').map(item),
    steps: s.steps.map(st => ({ ...st })),
    open: [...s.questions].reverse().filter(q => !q.closed).map(q => ({ id: q.id, question: q.question, owner: q.owner, parent: q.parent })),
    tree: tree(s),
    tasks: tasks(s),
  }
}

// 作業（問い）の木。各作業に意図と、ぶら下がる決まったこと（親との線の種類つき）を持つ。
// 決まったことの親：同じ作業の中で depends_on の先頭に当たるものがあればその下（線は rel、無ければ「補足」）、
// 無ければ作業の直下（線は「答え」）。並びは開いた順・足した順。
export const tasks = (s: State): Board['tasks'] => {
  const t = tree(s)
  const where = new Map(t.nodes.flatMap(n => n.items.map(id => [id, n.id] as const)))
  return t.nodes.map((n, i) => ({
    id: n.id, question: n.question, owner: n.owner, closed: n.closed, parent: n.parent,
    intent: s.questions[i]!.intent ?? null,
    items: n.items.map(id => {
      const c = find(s.commitments, id)!
      const parent = c.depends_on.find(d => where.get(d) === n.id) ?? null
      return {
        id: c.id, content: c.content, by: c.by, turn: c.turn ?? 0, parent,
        rel: parent ? (c.rel ?? 'elaboration') : ('answer' as const),
        ...(c.reason ? { reason: c.reason } : {}),
        ...(c.replaces ? { replaces: c.replaces.content } : {}),
      }
    }),
  }))
}

// 目的 → 問い → 決定 の木（QUD の木）。決定は答えている問いに、答えていなければ依存先の問いに付ける。
// どこにも付かない決定は loose（目的の直下）。問いの並びは開いた順
export const tree = (s: State): Board['tree'] => {
  const attach = new Map<string, string>()
  for (const q of s.questions) for (const a of q.answers) if (!attach.has(a)) attach.set(a, q.id)
  let changed = true
  while (changed) {
    changed = false
    for (const c of s.commitments) {
      if (attach.has(c.id)) continue
      const d = c.depends_on.find(x => attach.has(x))
      if (d !== undefined) { attach.set(c.id, attach.get(d)!); changed = true }
    }
  }
  const qids = new Set(s.questions.map(q => q.id))
  return {
    nodes: s.questions.map(q => ({
      id: q.id, question: q.question, owner: q.owner, closed: !!q.closed,
      parent: q.parent && qids.has(q.parent) ? q.parent : null,
      items: s.commitments.filter(c => attach.get(c.id) === q.id).map(c => c.id),
    })),
    loose: s.commitments.filter(c => !attach.has(c.id)).map(c => c.id),
  }
}
