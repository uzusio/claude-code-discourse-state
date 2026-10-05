import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteResult, Register } from 'claude-code'

import type { Seen } from '../types'
import { bandLine, boardPath, nextStep, parseBoard, sections } from './board'
import type { Item } from './board'
import { apply, board, RELATIONS, renderCompact, renderIds, replay, validate } from './state'
import { ATTRIBUTION_SYSTEM, attributionTargets, buildAttributionPrompt, buildDeviationPrompt, DEVIATION_SYSTEM, lastExchange, parseAttribution, parseDeviation } from './audit'
import type { Audit, Flag } from './audit'
import type { Diff } from './state'

const PANE = 'discourse-state'
const TITLE = '意図ボード'
const SUPPLEMENTED = 'yellow'
const FLAGGED = 'red'
const ATTRIBUTION_MODEL = 'haiku'
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
  const x = lastExchange(messages as any)
  if (x === null) return
  const state = replay(await readDiffs($), d)
  const n = await $.session.turns()
  const flags: Flag[] = []
  const usage: Record<string, unknown> = { turn: n }
  const used = (r: ModelCompleteResult) => ({ input: r.usage.input_tokens, cached: r.usage.cache_read_input_tokens, output: r.usage.output_tokens })

  const items = attributionTargets(state, n)
  if (items.length) {
    const r = await $.model.complete({ model: ATTRIBUTION_MODEL, system: ATTRIBUTION_SYSTEM, prompt: buildAttributionPrompt(x, items), maxTokens: 1000 })
    usage.attribution = used(r)
    if (r.isAnswered) flags.push(...(parseAttribution(r.text, items) ?? []))
  }
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
- goal {quote:[ユーザーの言葉そのまま], reading:"あなたの読み（40字以内）"} … 意図の読みができた・変わったとき
- plan {steps:[{text, from:["goal" か C の id], why:"なぜこの手順か（30字以内）"}]} … これからの流れ。全体を置き換える。終わった手順は外す
- add {id:"C番号", content, by:"user"|"claude", reason?, depends_on?} … 決まったこと。by=user はユーザーが言った・認めたことだけ。あなたが補ったもの（範囲・順番・理由・言葉の意味の推測、自分で決めたやり方）は by=claude と reason
- confirm {id} … ユーザーがあなたの補完を認めた
- retract {id, replaced_by?} / amend {id, content} / recheck {id}
- open {id:"Q番号", question, parent?, owner:"user"|"claude"} / answer {question, by?, complete}
規則：意図の読みと by=user の決まったことは、ユーザーの発言を根拠にしか変えない。答えの出た問いは complete で閉じる。id は結果に出る「次の ID」から振る。
結果として、検証の結果と、更新後のボードの状態（id つき）が返る。`

let updatedThisTurn = false
let workedThisTurn = false
let missedLastTurn = false

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
  on('prompt.submit', async ($, e, next) => {
    const remind = missedLastTurn
    missedLastTurn = false
    updatedThisTurn = false
    workedThisTurn = false
    if (!remind) return next(e)
    return next({ ...e, context: [...(e.context ?? []), '意図ボード：前のターンで作業をしたのに board_update を呼んでいない。意図の読み・決まったこと・流れに変化があったなら、この返信の終わりに更新すること。'] })
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
    const { board, changed, note, audit } = await read($, seen)
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
          {audit.length ? <Text color={FLAGGED}> ｜ 監査の指摘 {audit.length}</Text> : null}
          <Text dimColor>{tail ? ` ｜ ${tail}` : ''}  </Text>
          <Button key="open" label={isOpen ? 'ボードを閉じる' : 'ボードを開く'} onPress={() => void togglePane($)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const { board, audit } = await read($, seen)
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
    const color = (tone?: string) => (tone === 'supplemented' ? SUPPLEMENTED : tone === 'flagged' ? FLAGGED : tone === 'new' ? 'cyan' : undefined)
    const item = (it: Item, indent: number) => (
      <Box key={it.key} flexDirection="column" paddingLeft={indent}>
        <Box>
          {it.tone === 'quote' || it.tone === 'strong' ? null : (
            <Text color={color(it.tone)} dimColor={it.tone === 'dim'}>{it.tone === 'new' ? '新 ' : '・'}</Text>
          )}
          <Box flexShrink={1}>
            <Text wrap="wrap" bold={it.tone === 'strong'} color={color(it.tone) ?? (it.tone === 'dim' || it.tone === 'quote' ? undefined : 'white')} dimColor={it.tone === 'dim' || it.tone === 'quote'}>{it.text}</Text>
          </Box>
        </Box>
        {(it.sub ?? []).map((line, i) => (
          <Box key={`${it.key}:${i}`} paddingLeft={2}>
            <Text wrap="wrap" color={line.startsWith('文脈の補完') ? SUPPLEMENTED : undefined} dimColor={!line.startsWith('文脈の補完')}>{line}</Text>
          </Box>
        ))}
      </Box>
    )
    return (
      <Box flexDirection="column">
        <Box justifyContent="flex-end">{close}</Box>
        {sections(board, flipped, audit).map(sec => (
          <Box key={sec.key} flexDirection="column" marginBottom={1}>
            {sec.collapsible
              ? <Button key={`h:${sec.key}`} plain label={`${sec.collapsible.open ? '▾' : '▸'} ${sec.title}`} onPress={() => flip(sec.key)} />
              : <Text bold color={sec.tone === 'supplemented' ? SUPPLEMENTED : sec.tone === 'flagged' ? FLAGGED : 'white'}>{sec.title}</Text>}
            {sec.items.map(it => item(it, 1))}
            {(sec.groups ?? []).map(g => (
              <Box key={g.key} flexDirection="column" paddingLeft={1} marginTop={1}>
                <Text dimColor={g.closed} wrap="wrap">{g.closed ? '✓ ' : ''}{g.title}</Text>
                {g.items.map(it => item(it, 1))}
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}
