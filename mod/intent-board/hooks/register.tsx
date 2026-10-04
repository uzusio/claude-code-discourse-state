import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteResult, Register } from 'claude-code'

import type { Seen } from '../types'
import { bandLine, boardPath, nextStep, parseBoard, sections } from './board'
import type { Item } from './board'
import { buildJudgePrompt, buildPrompt, demote, JUDGE_SYSTEM, lastExchange, parseReply, parseVerdicts, SYSTEM, userAdds } from './parse'
import { apply, board, replay, validate } from './state'
import type { Diff } from './state'

const PANE = 'intent-board'
const TITLE = '意図ボード'
const SUPPLEMENTED = 'yellow'
const seen = atom({ plugin: 'intent-board', key: 'seen' } as const, { board: null, changed: false, note: null } as Seen)
// ペインが開いているか。帯のボタンの表示（開く／閉じる）を切り替える
const opened = atom({ plugin: 'intent-board', key: 'opened' } as const, false)
// ペインの木で、既定の開閉から反転させた行のキー
const expanded = atom({ plugin: 'intent-board', key: 'expanded' } as const, [] as string[])

const MODEL = 'sonnet'
const JUDGE_MODEL = 'haiku'

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
  const board = parseBoard(await readText($, `${await boardDir($)}/board.json`))
  await update($, seen, () => ({ board, changed: board !== null && changed, note }))
}

// 1ターン分のやり取りを LLM に読ませて差分を作り、検証して足す
async function ingest($: EngineInterface) {
  const d = await boardDir($)
  const messages = await $.session.messages()
  if (!Array.isArray(messages)) return
  const x = lastExchange(messages as any)
  if (x === null) return

  const diffs = await readDiffs($)
  let state = replay(diffs, d)
  const reply = await $.model.complete({ model: MODEL, system: SYSTEM, prompt: buildPrompt(state, x), maxTokens: 3000 })
  if (!reply.isAnswered) return load($, false, `読み取りに失敗：${reply.reason}`)
  const parsed = parseReply(reply.text)
  if (parsed === null) return load($, false, '読み取りに失敗：返答が JSON でない')

  // 判定機：「言われたこと」に分けたものが発言に書かれているか。書かれていなければ補った前提に回す
  const adds = userAdds(parsed.user)
  let judged: ModelCompleteResult | null = null
  if (parsed.user && adds.length) {
    judged = await $.model.complete({ model: JUDGE_MODEL, system: JUDGE_SYSTEM, prompt: buildJudgePrompt(x.user, adds), maxTokens: 1000 })
    const ungrounded = judged.isAnswered ? parseVerdicts(judged.text) : null
    if (ungrounded?.size) parsed.user = demote(parsed.user, ungrounded)
  }

  const n = await $.session.turns()
  // 消費の記録（1ターンあたりのトークン）
  const usage = (m: string, r: ModelCompleteResult) =>
    r.isAnswered ? { model: m, input: r.usage.input_tokens, cached: r.usage.cache_read_input_tokens, output: r.usage.output_tokens } : null
  const usageLine = JSON.stringify({ turn: n, read: usage(MODEL, reply), judge: judged ? usage(JUDGE_MODEL, judged) : null })
  await $.fs.write(`${d}/usage.jsonl`, `${(await readText($, `${d}/usage.jsonl`)) ?? ''}${usageLine}\n`)

  const added: Diff[] = []
  const problems: string[] = []
  for (const [who, diff] of [['π', parsed.user], ['σ', parsed.claude]] as const) {
    if (!diff) continue
    const full: Diff = { ...diff, turn: n, utterance_id: `${who}${n}`, text: who === 'π' ? x.user.slice(0, 200) : '（Claude の返信と作業）' }
    const p = validate(state, full)
    if (p.length) { problems.push(...p.map(q => `${who}${n}: ${q}`)); continue }
    state = apply(state, full)
    added.push(full)
  }
  const changed = added.some(a => (a.ops ?? []).some(o => o.op !== 'none'))
  if (added.length) {
    await $.fs.write(`${d}/diffs.jsonl`, [...diffs, ...added].map(a => JSON.stringify(a)).join('\n') + '\n')
    await $.fs.write(`${d}/board.json`, JSON.stringify(board(state), null, 2))
  }
  if (problems.length) await $.ui.log(`intent-board: 弾いた差分 ${problems.join(' / ')}`, { to: 'debug' })
  await load($, changed, problems.length ? `弾いた差分 ${problems.length}件` : null)
}

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'intent-board', description: '意図ボードを開く・閉じる（Esc でも閉じる）' })
    // 読み込み直しのたびに閉じた状態から始める（開きっぱなしで入力欄の上を塞がない）
    await closePane($)
    await load($)
    return next(e)
  })

  // /intent-board は開く・閉じるの切り替え
  on('command.run', { command: 'intent-board' }, async $ => {
    if (await read($, opened)) {
      await closePane($)
      return { text: '意図ボードを閉じた' }
    }
    await load($)
    await openPane($)
    return { text: '意図ボードを開いた（帯のボタン・Esc・/intent-board で閉じる）' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await update($, opened, () => false)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // 本体の会話だけ。サブエージェントのターンは読まない
    if (e.agentId === undefined && e.reason === 'answer') {
      await update($, seen, v => ({ ...v, note: '読み取り中…' }))
      await ingest($).catch(async (err: unknown) => load($, false, `読み取りに失敗：${String(err).slice(0, 80)}`))
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
    const color = (tone?: string) => (tone === 'supplemented' ? SUPPLEMENTED : tone === 'new' ? 'cyan' : undefined)
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
        {sections(board, flipped).map(sec => (
          <Box key={sec.key} flexDirection="column" marginBottom={1}>
            {sec.collapsible
              ? <Button key={`h:${sec.key}`} plain label={`${sec.collapsible.open ? '▾' : '▸'} ${sec.title}`} onPress={() => flip(sec.key)} />
              : <Text bold color={sec.tone === 'supplemented' ? SUPPLEMENTED : 'white'}>{sec.title}</Text>}
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
