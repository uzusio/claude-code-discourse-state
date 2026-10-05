import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteResult, Register } from 'claude-code'

import type { Seen } from '../types'
import { bandLine, boardPath, nextStep, parseBoard, sections } from './board'
import type { Item } from './board'
import { apply, board, RELATIONS, renderCompact, renderIds, replay, validate } from './state'
import { buildDeviationPrompt, DEVIATION_SYSTEM, lastExchange, parseDeviation } from './audit'
import type { Audit, Flag } from './audit'
import type { Diff } from './state'

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

// Esc で閉じる。入力欄の上に出るときは高さを抑える
async function openPane($: EngineInterface) {
  await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true, rows: 14 })
  await update($, opened, () => true)
}

async function closePane($: EngineInterface) {
  await $.ui.close({ id: PANE }).catch(() => undefined)
  await update($, opened, () => false)
}

async function togglePane($: EngineInterface) {
  if (await read($, opened)) await closePane($)
  else await openPane($)
}

async function boardDir($: EngineInterface) {
  if (dir === null) {
    const tmp = (await $.env.get('TEMP')) ?? (await $.env.get('TMPDIR')) ?? '/tmp'
    dir = boardPath(tmp, await $.session.id()).replace(/\/board\.json$/, '')
  }
  return dir
}

async function readText($: EngineInterface, path: string) {
  return $.fs.read(path).then((t: unknown) => (typeof t === 'string' ? t : undefined)).catch(() => undefined)
}

// 差分ログ（diffs.jsonl）が正本。状態はそこから作り直し、board.json は見え方の写し
async function readDiffs($: EngineInterface): Promise<Diff[]> {
  const text = await readText($, `${await boardDir($)}/diffs.jsonl`)
  if (!text) return []
  return text.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l) as Diff)
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

  const audit: Audit = { turn: n, flags }
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
ユーザーの発言を受けて意図の読み・決まったこと・流れが変わったターンでは、返信の終わりに必ず1回呼ぶ。変化が無ければ呼ばなくてよい。
ボードはあなたの頭の中をそのまま見せるもの。あなた自身の理解を書く。

渡すのは差分1つ：{"relation": 関係, "ops": [操作, ...]}
関係：Correction（前の決定を取り消す・置き換える）／Contrast（「でも」で並べるだけ。取り消さない）／Elaboration（詳しくする）／Explanation（「〜だから」。理由づけ。target か depends_on で対象を示す）／Continuation（足す）／Result／Condition／Answer（問いに答える）／Open（問いを開く）／Clarification（言葉の意味・範囲を確かめる問い）／Acknowledge（受け取るだけ）
操作：
- intent {question:"Q番号", quote:[ユーザーの言葉そのまま], reading:"あなたの読み（40字以内）"} … その作業（問い）の意図の読みができた・変わったとき。意図は会話全体ではなく作業ごとに持つ。読み手・調子・範囲など、自分が無意識に置いている前提も読みに含める
- plan {steps:[{text, from:["goal" か C の id], why:"なぜこの手順か（30字以内）"}]} … これからの流れ。全体を置き換える。終わった手順は外す
- add {id:"C番号", content, by:"user"|"claude", reason?, depends_on?, rel?} … 決まったこと。作業への答えなら answer で作業につなぐ。別の決まったことへの補足・理由・対比・結果・条件なら depends_on:[その id] と rel:"elaboration"|"explanation"|"contrast"|"result"|"condition"。by=user はユーザーが言った・認めたことだけ。あなたが補ったもの（範囲・順番・理由・言葉の意味の推測、自分で決めたやり方）は by=claude と reason
- confirm {id} … ユーザーがあなたの補完を認めた
- retract {id, replaced_by?} / amend {id, content} / recheck {id}
- open {id:"Q番号", question, parent?, owner:"user"|"claude", intent?:{quote, reading}} … 作業（問い）を開く。作業は木：大きな作業を分けた下位の作業は parent に親の作業。新しい作業を始めるときは intent も置く
- answer {question, by?, complete}
規則：意図の読みと by=user の決まったことは、ユーザーの発言を根拠にしか変えない。答えの出た問いは complete で閉じる。id は結果に出る「次の ID」から振る。
結果として、検証の結果と、更新後のボードの状態（id つき）が返る。`

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
  const diff: Diff = {
    relation: input.relation as string, target: (input.target as string | null) ?? null,
    markers: (input.markers as string[]) ?? [], ops: input.ops as Diff['ops'],
    turn: n, utterance_id: `τ${n}`, text: '（本体が書いた）',
  }
  const problems = validate(state, diff)
  if (problems.length) {
    const ids = [...new Set(problems.join(' ').match(/\b[CQ]\d+\b/g) ?? [])]
    const related = ids.length ? `\n\n問題に出た id:\n${renderIds(state, ids)}` : ''
    return { text: `ボードを更新できなかった。直して呼び直すこと：\n${problems.map(p => `- ${p}`).join('\n')}${related}\n\n${renderCompact(state)}`, isError: true }
  }
  const next = apply(state, diff)
  await $.fs.write(`${d}/diffs.jsonl`, [...diffs, diff].map(x => JSON.stringify(x)).join('\n') + '\n')
  await $.fs.write(`${d}/board.json`, JSON.stringify(board(next), null, 2))
  await load($, (diff.ops ?? []).some(o => o.op !== 'none'))
  return { text: `ボードを更新した。\n\n${renderCompact(next)}`, isError: false }
}

export const register: Register = on => {

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
    const context = [
      ...(remind ? ['意図ボード：前のターンで作業をしたのに board_update を呼んでいない。意図の読み・決まったこと・流れに変化があったなら、この返信の終わりに更新すること。'] : []),
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
    const tail = [changed ? '更新あり' : '', note ?? ''].filter(Boolean).join(' ｜ ')

    return (
      <Box flexDirection="column">
        <Text wrap="wrap" color="white">意図：{line.goal}</Text>
        <Box>
          <Box flexShrink={1}>
            <Text dimColor wrap="truncate-end">{step ?? '流れ：まだ無い'}</Text>
          </Box>
          <Text dimColor>{tail ? ` ｜ ${tail}` : ''}  </Text>
          <Button key="open" label={isOpen ? 'ボードを閉じる' : 'ボードを開く'} onPress={() => void togglePane($)} />
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
            <Text wrap="wrap" bold={it.tone === 'strong'} color={color(it.tone)} dimColor={dim(it.tone)}>{it.text}</Text>
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
