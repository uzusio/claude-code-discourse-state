import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteResult, Register } from 'claude-code'

import type { Seen } from '../types'
import { bandLine, boardPath, nextStep, parseBoard, recordsBase, refDefsPaths, sections, unregisteredCount, view } from './board'
import type { Item } from './board'
import { apply, board, parseRefDefs, RELATIONS, renderCompact, renderIds, replay, unregistered, validate } from './state'
import { buildDeviationPrompt, DEVIATION_SYSTEM, lastExchange, parseDeviation } from './audit'
import type { Audit, Flag } from './audit'
import type { Diff, RefDef, State } from './state'

const PANE = 'discourse-state'
const TITLE = '意図ボード'
const SUPPLEMENTED = 'yellow'
const FLAGGED = 'red'
// 作業の見出し。補完の黄色と見分けやすい緑
const TASK = 'green'
const DEVIATION_MODEL = 'sonnet'
const seen = atom({ plugin: 'discourse-state', key: 'seen' } as const, { board: null, changed: false, note: null, audit: [] } as Seen)
// ペインが開いているか。帯のボタンの表示（開く／閉じる）を切り替える
const opened = atom({ plugin: 'discourse-state', key: 'opened' } as const, false)
// ペインの木で、既定の開閉から反転させた行のキー
const expanded = atom({ plugin: 'discourse-state', key: 'expanded' } as const, [] as string[])

let dir: string | null = null
// 設定 exportView（既定 false）。true のときだけ view.json を書く。register で options から受け取る
let exportView = false

// Esc で閉じる。入力欄の上に出るときは高さを抑える
// 置けなかったとき（端末の幅など）は理由を出し、pane.jsonl に残す。開いたまま待つので、幅が足りれば後から出る
async function openPane($: EngineInterface) {
  const r = await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true, rows: 14 })
  await update($, opened, () => true)
  const d = await boardDir($)
  await $.fs.write(`${d}/pane.jsonl`, `${(await readText($, `${d}/pane.jsonl`)) ?? ''}${JSON.stringify({ at: new Date().toISOString(), ...r })}\n`).catch(() => undefined)
  if (!r.isPlaced) $.ui.toast(`意図ボードをまだ表示できない：${r.reason}`)
}

async function closePane($: EngineInterface) {
  await $.ui.close({ id: PANE }).catch(() => undefined)
  await update($, opened, () => false)
}

async function boardDir($: EngineInterface) {
  if (dir === null) {
    const base = recordsBase({
      CLAUDE_CONFIG_DIR: await $.env.get('CLAUDE_CONFIG_DIR'),
      USERPROFILE: await $.env.get('USERPROFILE'),
      HOME: await $.env.get('HOME'),
    })
    dir = boardPath(base, await $.session.id()).replace(/\/board\.json$/, '')
  }
  return dir
}

async function readText($: EngineInterface, path: string) {
  return $.fs.read(path).then((t: unknown) => (typeof t === 'string' ? t : undefined)).catch(() => undefined)
}

// ---------------------------------------------------------------- 参照の定義（#19）
// プロジェクトの .claude/discourse-state.json。セッションの作業フォルダから上へたどって最初に見つかったものを使う。
// 無ければ定義なし（今までどおり）。壊れていれば定義なしとして動き、トーストと board_update の結果でそれぞれ一度知らせる
type RefDefs = { defs: RefDef[] | null; problem: string | null; path: string | null }
const toastedRefDefs = new Set<string>()
const reportedRefDefs = new Set<string>()
const refDefsProblem = (r: RefDefs) => `参照の定義 ${r.path} を読めなかった：${r.problem}。定義なしとして動いている`

async function loadRefDefs($: EngineInterface): Promise<RefDefs> {
  for (const path of refDefsPaths(await $.session.cwd())) {
    const text = await readText($, path)
    if (text === undefined) continue
    const { defs, problem } = parseRefDefs(text)
    const r = { defs, problem, path }
    if (problem && !toastedRefDefs.has(refDefsProblem(r))) {
      toastedRefDefs.add(refDefsProblem(r))
      $.ui.toast(refDefsProblem(r))
    }
    return r
  }
  return { defs: null, problem: null, path: null }
}

// board_update の結果に添える知らせ（壊れた定義を、同じ中身なら一度だけ）
function refDefsNotice(r: RefDefs) {
  if (!r.problem || reportedRefDefs.has(refDefsProblem(r))) return ''
  reportedRefDefs.add(refDefsProblem(r))
  return `\n\n${refDefsProblem(r)}`
}

// 差分ログ（diffs.jsonl）が正本。状態はそこから作り直し、board.json は見え方の写し
async function readDiffs($: EngineInterface): Promise<Diff[]> {
  const text = await readText($, `${await boardDir($)}/diffs.jsonl`)
  if (!text) return []
  return text.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l) as Diff)
}

// view.json（外部の表示先が読む見え方の写し）を書く。契約は Issue #16。試験的なので、設定 exportView が true のときだけ呼ぶ
async function writeView($: EngineInterface, state: State, turn: number, note: string | null, defs: RefDef[] | null) {
  const d = await boardDir($)
  const v = view(board(state, 3, defs), {
    updatedAt: new Date().toISOString(), session: await $.session.id(), cwd: await $.session.cwd(), turn, note,
  })
  await $.fs.write(`${d}/view.json`, JSON.stringify(v, null, 2))
}

// board.json を読み直す。読めない・壊れているときはボードなし
async function load($: EngineInterface, changed = false, note: string | null = null) {
  const d = await boardDir($)
  const board = parseBoard(await readText($, `${d}/board.json`))
  const audit = parseAudit(await readText($, `${d}/audit.json`))
  await update($, seen, () => ({ board, changed: board !== null && changed, note, audit }))
}

function parseAudit(text: string | undefined): Flag[] {
  try {
    const a = text ? (JSON.parse(text) as Audit) : null
    return Array.isArray(a?.flags) ? a!.flags : []
  } catch {
    return []
  }
}

// ---------------------------------------------------------------- 監査役（#13）
// ターンの終わりに、出どころ（haiku）と食い違い（sonnet）を確かめる。ボードは書き換えず、指摘を audit.json に置く
async function runAudit($: EngineInterface) {
  const d = await boardDir($)
  const messages = await $.session.messages()
  if (!Array.isArray(messages)) return
  const x = lastExchange(messages as any, 3, midTurn)
  if (x === null) return
  const state = replay(await readDiffs($), d)
  const n = await $.session.turns()
  const flags: Flag[] = []
  const usage: Record<string, unknown> = { turn: n }
  const used = (r: ModelCompleteResult) => ({ input: r.usage.input_tokens, cached: r.usage.cache_read_input_tokens, output: r.usage.output_tokens })

  // 出どころ（言葉の突き合わせ）の確認は 2026-10-05 にやめた：意図の読みの監査ではなく、Claude の判断を縛るだけだったため
  const r = await $.model.complete({ model: DEVIATION_MODEL, system: DEVIATION_SYSTEM, prompt: buildDeviationPrompt(state, x), maxTokens: 1000 })
  usage.deviation = used(r)
  if (r.isAnswered) flags.push(...(parseDeviation(r.text) ?? []))

  // 何を渡したかも残す（作業中に届いた発言が入っているかを後から確かめられるように）
  const audit: Audit & { user?: string } = { turn: n, flags, user: x.user.slice(0, 400) }
  await $.fs.write(`${d}/audit.json`, JSON.stringify(audit, null, 2))
  await $.fs.write(`${d}/audit.jsonl`, `${(await readText($, `${d}/audit.jsonl`)) ?? ''}${JSON.stringify(audit)}\n`)
  await $.fs.write(`${d}/usage.jsonl`, `${(await readText($, `${d}/usage.jsonl`)) ?? ''}${JSON.stringify(usage)}\n`)
  const v = await read($, seen)
  await update($, seen, () => ({ ...v, audit: flags }))
}

// ---------------------------------------------------------------- 本体が書くボード（#12）
// ボードは会話している本体（Claude）が自分で書く。別モデルの読み取りは使わない。
// 本体はターンの終わりに board_update ツールで差分を渡し、mod が検証して足す。崩れていれば突き返す。

const TOOL = 'board_update'
const TOOL_FULL = 'mcp__discourse-state__board_update'

const TOOL_DESCRIPTION = `意図ボード（ユーザーが画面で見ている、あなたの「いまの理解」）を更新する。
作業を始めたターンと、作業の意図の読み・文脈の補完・流れが変わったターンで、返信の終わりに1回呼ぶ。
ボードはあなたの頭の中をそのまま見せるもの。あなた自身の理解を書く。

ボードに書くのは、作業ごとに次の3つ：
- 意図：ユーザーの言葉と、あなたの読み。ユーザーの訂正は読みを書き換えて表す（前の読みは履歴に残る）。読み手・調子・範囲など、自分が無意識に置いている前提も読みに含める
- 文脈の補完：その読みのために、ユーザーが言っていないのにあなたが補った前提（範囲・順番・理由・言葉の意味の推測、自分で決めたやり方）。理由つき
- 流れ：その作業のこれからの手順と、手順ごとの「なぜ」
作業は木：大きな作業を分けた下位の作業は parent で親に付ける。片付いた作業は閉じる。

渡すのは差分1つ：{"relation": 関係, "ops": [操作, ...]}
関係：Correction（読みや前提を訂正された）／Contrast（「でも」で並べるだけ）／Elaboration（詳しくなった）／Explanation（理由づけ。target か depends_on で対象を示す）／Continuation（足す）／Result／Condition／Answer（問いに答える）／Open（新しい作業）／Clarification（言葉の意味・範囲を確かめる問い）／Acknowledge（受け取るだけ）
操作：
- open {id:"Q番号", question:"作業の名前", parent?, owner:"user", intent:{quote:[ユーザーの言葉そのまま], reading:"あなたの読み（40字以内）"}} … 作業を始める
- intent {question:"Q番号", quote:[...], reading:"..."} … その作業の意図の読みが変わったとき（訂正・深まった）
- add {id:"C番号", content, by:"claude", reason, depends_on?, rel?} と answer {question:"Q番号", by:"C番号"} … 文脈の補完をその作業に付ける。別の補完への補足・理由・対比・結果・条件なら depends_on と rel（"elaboration"|"explanation"|"contrast"|"result"|"condition"）
- confirm {id} … ユーザーがあなたの補完を認めた
- retract {id, replaced_by?} … 補完を取り下げた
- plan {question:"Q番号", steps:[{text, why:"なぜこの手順か（30字以内）"}]} … その作業の流れ。作業ごとに全体を置き換える。終わった手順は外す
- answer {question:"Q番号", complete:true} … 作業が片付いた（ボードの「片付いた作業」へ移る）
- move {id, question} … 補完を別の作業へ付け替える
- open に refs:["#19", ...] と local:true を付けられる … refs は作業をプロジェクトの管理の単位（Issue など）に結び付ける参照、local はその場で終わる問いの印
- ref {question:"Q番号", refs?:[...], local?:true|false} … 作業の参照を置き換える（[] で外す）・その場で終わる問いの印を付け外す。関係は Elaboration
id は結果に出る「次の ID」から振る。結果として、検証の結果と、開いている作業と意図、最近の項目、次の ID が返る。`

// システムプロンプトに足す案内。ボードがあることと、いつ書くかだけを伝える（ボードの中身は載せない）
// 参照の定義があれば、参照の種類と、作業を登録して参照を付けること・その場で終わる問いの印を足す
export const guideSection = (defs: readonly RefDef[] | null) => ({
  id: 'discourse-state:guide',
  scope: 'session' as const,
  text: `# 意図ボード
このセッションには意図ボードがある。ユーザーは、あなたが作業ごとに意図をどう読んでいるかを、入力欄の上の帯とボードで見ている。
作業を始めたターンと、意図の読み・補った前提・流れが変わったターンの終わりに、${TOOL_FULL} で差分を書く。${
    defs?.length
      ? `

このプロジェクトの参照（作業をプロジェクトの管理の単位に結び付ける印）：
${defs.map(d => `- ${d.name}：形 ${d.pattern}${d.track ? '（管理の単位）' : ''}`).join('\n')}
管理の単位にすべき作業は登録して、open の refs か ref 操作で参照を付ける。その場で終わる問いには local: true を付ける。`
      : ''
  }`,
})
export const GUIDE_SECTION = guideSection(null)

let updatedThisTurn = false
let workedThisTurn = false
let missedLastTurn = false
// このターンの作業中に届いた発言（turnId つきの prompt.submit）。監査に渡す
let midTurn: string[] = []

// 本体から渡された差分を検証して足す。返すのはツールの結果の文面
async function applyFromAgent($: EngineInterface, input: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const d = await boardDir($)
  const diffs = await readDiffs($)
  const state = replay(diffs, d)
  const n = await $.session.turns()
  const refs = await loadRefDefs($)
  const diff: Diff = {
    relation: input.relation as string, target: (input.target as string | null) ?? null,
    markers: (input.markers as string[]) ?? [], ops: input.ops as Diff['ops'],
    turn: n, utterance_id: `τ${n}`, text: '（本体が書いた）',
  }
  // 参照の形は書くときだけ定義と突き合わせる（差分ログの作り直し replay では見ない。定義を後から変えてもボードが壊れない）
  const problems = validate(state, diff, refs.defs)
  if (problems.length) {
    const ids = [...new Set(problems.join(' ').match(/\b[CQ]\d+\b/g) ?? [])]
    const related = ids.length ? `\n\n問題に出た id:\n${renderIds(state, ids)}` : ''
    return { text: `ボードを更新できなかった。直して呼び直すこと：\n${problems.map(p => `- ${p}`).join('\n')}${related}\n\n${renderCompact(state, 8, refs.defs)}${refDefsNotice(refs)}`, isError: true }
  }
  const next = apply(state, diff)
  await $.fs.write(`${d}/diffs.jsonl`, [...diffs, diff].map(x => JSON.stringify(x)).join('\n') + '\n')
  await $.fs.write(`${d}/board.json`, JSON.stringify(board(next, 3, refs.defs), null, 2))
  await load($, (diff.ops ?? []).some(o => o.op !== 'none'))
  // board.json はもう書けているので、view.json の失敗でツールを失敗にしない（呼び直されると二重に足される）
  const viewFailed = !exportView ? '' : await writeView($, next, n, null, refs.defs).then(() => '', (err: unknown) => `\n\nview.json を書けなかった：${String(err)}`)
  return { text: `ボードを更新した。\n\n${renderCompact(next, 8, refs.defs)}${viewFailed}${refDefsNotice(refs)}`, isError: false }
}

// ターンの頭に Claude に渡す、未登録の作業の知らせ。管理の単位（track）の定義が無ければ出さない
async function unregisteredNotice($: EngineInterface, defs: RefDef[] | null): Promise<string | null> {
  if (!defs?.some(d => d.track)) return null
  const diffs = await readDiffs($)
  if (!diffs.length) return null
  const state = replay(diffs, await boardDir($))
  const ids = unregistered(state, defs)
  if (!ids.length) return null
  const list = ids.map(id => {
    const q = state.questions.find(x => x.id === id)!
    return `${q.refs?.[0] ?? q.id} ${q.question}`
  })
  return `意図ボード：未登録の作業：${list.join(' ／ ')}。管理すべき作業なら登録して ref で参照を付ける。その場で終わる問いなら local を付ける。`
}

export const register: Register = (on, options) => {
  exportView = options.exportView === true

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'discourse-state', description: '意図ボードを開く・閉じる（Esc でも閉じる）' })
    await $.tool.register({
      name: TOOL,
      description: TOOL_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          relation: { type: 'string', enum: [...RELATIONS] },
          target: { type: ['string', 'null'] },
          markers: { type: 'array', items: { type: 'string' } },
          ops: { type: 'array', items: { type: 'object' } },
        },
        required: ['relation', 'ops'],
      },
    })
    // 読み込み直しのたびに閉じた状態から始める（開きっぱなしで入力欄の上を塞がない）
    await closePane($)
    await load($)
    return next(e)
  })

  // board_update を最初から説明つきで見せる（ToolSearch の後ろに置かない）。名前だけでは何のツールか伝わらない
  on('tool.describe', { tool: TOOL_FULL as any }, async (_, e, next) => ({ ...(await next(e)), isDeferred: false }))

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    // 定義を読めなくても（作業フォルダが分からないなど）、案内そのものは落とさない
    const defs = await loadRefDefs($).then(x => x.defs, () => null)
    return { ...r, sections: [...r.sections, guideSection(defs)] }
  })

  // /discourse-state は開く・閉じるの切り替え
  on('command.run', { command: 'discourse-state' }, async $ => {
    if (await read($, opened)) {
      await closePane($)
      return { text: '意図ボードを閉じた' }
    }
    await load($)
    await openPane($)
    return { text: '意図ボードを開いた（帯のボタン・Esc・/discourse-state で閉じる）' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await update($, opened, () => false)
    return next(e)
  })

  // 本体のボード更新
  // 自前のツールは型の一覧に無いので名前で受ける。入力はイベントに直接載る
  on('tool.call', { tool: TOOL_FULL as any }, async ($, e) => {
    updatedThisTurn = true
    const r = await applyFromAgent($, e as unknown as Record<string, unknown>).catch((err: unknown) => ({ text: `ボードの更新で失敗：${String(err)}`, isError: true }))
    return r.isError ? { result: r.text, isError: true as const } : { result: r.text }
  })

  // 作業をしたかどうか（ボード更新以外のツール呼び出し）
  on('tool.call', async ($, e, next) => {
    if ((e.tool as string) !== TOOL_FULL) workedThisTurn = true
    return next(e)
  })

  // 前のターンで作業したのにボードを更新していなければ、このターンの頭で本体に促す（ボードの中身は渡さない）
  // 監査の指摘も、ここで本体にだけ渡す。直すか、そのままでよいかは本体が判断する（ユーザーには出さない）
  on('prompt.submit', async ($, e, next) => {
    // 作業中に届いた発言：ためておくだけ。ターンの区切りの処理（印のリセット・指摘の受け渡し）はしない
    if (e.turnId !== undefined) {
      midTurn.push(e.text)
      return next(e)
    }
    midTurn = []
    const remind = missedLastTurn
    missedLastTurn = false
    updatedThisTurn = false
    workedThisTurn = false
    const { audit } = await read($, seen)
    // 未登録の作業の知らせ。読めない差分ログなどで失敗しても、ユーザーの発言は止めない
    const unreg = await loadRefDefs($).then(r => unregisteredNotice($, r.defs)).catch(() => null)
    const context = [
      ...(remind ? ['意図ボード：前のターンで作業をしたのに board_update を呼んでいない。意図の読み・決まったこと・流れに変化があったなら、この返信の終わりに更新すること。'] : []),
      ...(unreg ? [unreg] : []),
      ...(audit.length
        ? [`意図ボードの監査（前のターン）：意図の読みが外れているかもしれない兆し。当たっていれば読みか作業を直し、外れていればそのままでよい。あなたが判断し、ユーザーの判断が本当に要るときだけ問いとして開く。\n${audit.map(f => `- ${f.text}`).join('\n')}`]
        : []),
    ]
    if (audit.length) await update($, seen, v => ({ ...v, audit: [] }))
    if (!context.length) return next(e)
    return next({ ...e, context: [...(e.context ?? []), ...context] })
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.reason === 'answer') {
      if (workedThisTurn && !updatedThisTurn) {
        missedLastTurn = true
        await update($, seen, v => ({ ...v, note: 'ボード未更新' }))
        // 設定で有効にしたときだけ。ボードがまだ無い（diffs が空）なら書かない
        if (exportView) {
          await (async () => {
            const diffs = await readDiffs($)
            if (diffs.length) await writeView($, replay(diffs, await boardDir($)), await $.session.turns(), 'ボード未更新', (await loadRefDefs($)).defs)
          })().catch((err: unknown) => $.ui.toast(`view.json を書けなかった：${String(err)}`))
        }
      }
      if (workedThisTurn || updatedThisTurn) await runAudit($).catch(() => undefined)
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { board, changed, note } = await read($, seen)
    const isOpen = await read($, opened)
    if (e.props.hasSurvey || board === null) {
      return next(e)
    }

    const { Box, Text, Button } = $.ui.resolve(e)
    // 1段目：意図の読み（2行まで折り返し、超えた分は切る。全角は2桁）
    // 2段目：流れの次の一歩
    const line = bandLine(board, Math.max(20, 2 * ((e.props.bodyColumns ?? 80) - 2) - 6))
    const step = nextStep(board)
    const unreg = unregisteredCount(board)
    const tail = [changed ? '更新あり' : '', note ?? '', unreg ? `未登録 ${unreg}` : ''].filter(Boolean).join(' ｜ ')

    return (
      <Box flexDirection="column">
        <Text wrap="wrap" color="white">意図：{line.goal}</Text>
        <Box>
          <Box flexShrink={1}>
            <Text dimColor wrap="truncate-end">{step ?? '流れ：まだ無い'}</Text>
          </Box>
          <Text dimColor>{tail ? ` ｜ ${tail}` : ''}  </Text>
          {/* 押した直後に ui.open を呼ぶ。先に await を挟むと「押して開いた」扱いが切れ、狭い端末（144 桁未満）で置かれない */}
          <Button key="open" label={isOpen ? 'ボードを閉じる' : 'ボードを開く'} onPress={() => void (isOpen ? closePane($) : openPane($))} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const { board } = await read($, seen)
    const close = <Button key="close" label="閉じる" onPress={() => void closePane($)} />
    if (board === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>まだボードがない（board.json が見つからない）</Text>
          {close}
        </Box>
      )
    }
    const flipped = new Set(await read($, expanded))
    const flip = (key: string) => void update($, expanded, list => (list.includes(key) ? list.filter(k => k !== key) : [...list, key]))
    const color = (tone?: string) =>
      tone === 'supplemented' ? SUPPLEMENTED : tone === 'flagged' ? FLAGGED : tone === 'new' ? 'cyan' : tone === 'dim' || tone === 'quote' ? undefined : 'white'
    const dim = (tone?: string) => tone === 'dim' || tone === 'quote'
    // 1行：作業の見出しは押して開閉。ほかは字下げ（木の深さ）＋本文＋注釈
    const item = (it: Item) => {
      const pad = 1 + (it.indent ?? 0) * 2
      if (it.toggle)
        // 開閉の印だけをボタンに（ボタンの文字には色を付けられない）。作業名は緑で横に並べる
        return (
          <Box key={it.key} paddingLeft={pad}>
            <Button key={it.key} plain label={it.toggle.open ? '▾' : '▸'} onPress={() => flip(it.key)} />
            <Box flexShrink={1}><Text wrap="wrap" bold color={TASK}> {it.text}</Text></Box>
          </Box>
        )
      return (
        <Box key={it.key} flexDirection="column" paddingLeft={pad}>
          <Box flexShrink={1}>
            <Text wrap="wrap" bold={it.tone === 'strong' || it.tone === 'label'} color={color(it.tone)} dimColor={dim(it.tone)}>{it.text}</Text>
          </Box>
          {(it.sub ?? []).map((line, i) => (
            <Box key={`${it.key}:${i}`} paddingLeft={2}>
              <Text wrap="wrap" dimColor>{line}</Text>
            </Box>
          ))}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        <Box justifyContent="flex-end">{close}</Box>
        {sections(board, flipped).map(sec => (
          <Box key={sec.key} flexDirection="column" marginBottom={1}>
            {sec.collapsible
              ? <Button key={`h:${sec.key}`} plain label={`${sec.collapsible.open ? '▾' : '▸'} ${sec.title}`} onPress={() => flip(sec.key)} />
              : <Text bold color={sec.tone === 'supplemented' ? SUPPLEMENTED : sec.tone === 'flagged' ? FLAGGED : 'white'}>{sec.title}</Text>}
            {sec.items.map(item)}
          </Box>
        ))}
      </Box>
    )
  })
}
