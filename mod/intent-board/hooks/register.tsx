import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Board, Seen } from '../types'
import { bandLine, boardPath, parseBoard, who } from './board'

const PANE = 'intent-board'
const TITLE = '意図ボード'
const SUPPLEMENTED = 'yellow'
const seen = atom({ plugin: 'intent-board', key: 'seen' } as const, { board: null, changed: false } as Seen)

let path: string | null = null
let lastText: string | undefined

// board.json を読み直す。読めない・壊れているときはボードなし
async function load($: EngineInterface) {
  if (path === null) {
    const tmp = (await $.env.get('TEMP')) ?? (await $.env.get('TMPDIR')) ?? '/tmp'
    path = boardPath(tmp, await $.session.id())
  }
  const text = await $.fs.read(path).then((t: unknown) => (typeof t === 'string' ? t : undefined)).catch(() => undefined)
  const board = parseBoard(text)
  const changed = board !== null && text !== lastText
  lastText = text
  await update($, seen, () => ({ board, changed }))
}

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'intent-board', description: '意図ボードをペインで開く' })
    await load($)
    return next(e)
  })

  on('command.run', { command: 'intent-board' }, async $ => {
    await load($)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: '意図ボードを開いた' }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await load($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { board, changed } = await read($, seen)
    if (e.props.hasSurvey || board === null) {
      return next(e)
    }

    const { Box, Text, Button } = $.ui.resolve(e)
    // 1段目に目的、2段目に数とボタン。目的は画面幅で切る（全角は2桁）
    const line = bandLine(board, Math.max(10, (e.props.bodyColumns ?? 80) - 8))

    return (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate-end">意図：{line.goal}</Text>
        <Box>
          <Text key="supplemented" color={line.supplemented > 0 ? SUPPLEMENTED : undefined} dimColor={line.supplemented === 0}>
            補った前提 {line.supplemented}件
          </Text>
          <Text dimColor> ｜ 問い {line.open}件{changed ? ' ｜ 更新あり' : ''}  </Text>
          <Button key="open" label="ボードを開く" onPress={() => void $.ui.open({ id: PANE, title: TITLE })} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const { board } = await read($, seen)
    const close = <Button key="close" label="閉じる" onPress={() => void $.ui.close({ id: PANE })} />
    if (board === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>まだボードがない（board.json が見つからない）</Text>
          {close}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {close}
        {sections(board, Text, Box)}
      </Box>
    )
  })
}

// ①〜⑥。④は色を変える
const sections = (b: Board, Text: any, Box: any) => {
  const head = (s: string) => <Text bold>{s}</Text>
  const none = <Text dimColor>  なし</Text>
  const out: RenderChildren[] = []

  out.push(head('① 目的'))
  if (b.goal) {
    for (const q of b.goal.quote) out.push(<Text wrap="wrap">  「{q}」</Text>)
    out.push(<Text wrap="wrap">  読み：{b.goal.reading}</Text>)
  } else out.push(none)

  out.push(head('② 決まっていること'))
  if (b.decided.length) for (const c of b.decided) out.push(<Text wrap="wrap">  {c.id} {c.content} <Text dimColor>← {c.source}</Text></Text>)
  else out.push(none)

  out.push(head('③ 置き換わったこと'))
  if (b.replaced.length)
    for (const r of b.replaced)
      out.push(<Text wrap="wrap">  {r.id} {r.content}{r.replaced_by ? ` → ${r.replaced_by}` : ' → 取り消し'} <Text dimColor>← {r.source}</Text></Text>)
  else out.push(none)

  out.push(<Text bold color={SUPPLEMENTED}>④ 補ったこと（言われていない）</Text>)
  if (b.supplemented.length)
    for (const c of b.supplemented)
      out.push(
        <Box flexDirection="column">
          <Text wrap="wrap" color={SUPPLEMENTED}>  {c.id} {c.content}</Text>
          {c.reason ? <Text wrap="wrap" dimColor>     理由：{c.reason}</Text> : null}
        </Box>,
      )
  else out.push(none)

  out.push(head('⑤ 意図 → いまの手順'))
  if (b.steps.length)
    b.steps.forEach((s, i) => out.push(<Text wrap="wrap">  {i + 1}. {s.text} <Text dimColor>← {s.from.join('・')}</Text></Text>))
  else out.push(none)

  out.push(head('⑥ 開いている問い'))
  if (b.open.length) for (const q of b.open) out.push(<Text wrap="wrap">  {q.id} {q.question} <Text dimColor>決める人：{who(q.owner)}</Text></Text>)
  else out.push(none)

  return out
}
