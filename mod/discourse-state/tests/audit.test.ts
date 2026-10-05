import { expect, test } from 'claude-code/testing'

import { attributionTargets, buildDeviationPrompt, lastExchange, parseAttribution, parseDeviation } from '../hooks/audit'
import { apply, replay } from '../hooks/state'
import type { Diff } from '../hooks/state'
import { AUDIT_DIFFS } from './fixtures'

const diffs = AUDIT_DIFFS as unknown as Diff[]

test('最後の発言と、その後の返信・作業、直近の発言を取る。スラッシュコマンドは読まない', async () => {
  const msgs = [
    { role: 'user' as const, text: '前の発言', toolUses: [] },
    { role: 'assistant' as const, text: '前の返信', toolUses: [] },
    { role: 'user' as const, text: 'Issue を進めて', toolUses: [] },
    { role: 'assistant' as const, text: '', toolUses: [{ tool: 'Bash', input: { description: 'テストを回す' } }] },
    { role: 'user' as const, text: '', toolUses: [], toolResults: [{}] },
    { role: 'assistant' as const, text: '進めたよ', toolUses: [] },
  ]
  expect(lastExchange(msgs)).toEqual({ user: 'Issue を進めて', recentUser: ['前の発言', 'Issue を進めて'], prevAssistant: '前の返信', assistant: '進めたよ', tools: ['Bash テストを回す'] })
  expect(lastExchange([...msgs, { role: 'user', text: '/loop 進めて', toolUses: [] }])).toBe(null)
})

test('作業中に届いた発言（prompt.submit で集めたもの）を、そのターンの発言に足す', async () => {
  const msgs = [
    { role: 'assistant' as const, text: '前のターンの返信', toolUses: [] },
    { role: 'user' as const, text: 'ボードを直して', toolUses: [] },
    { role: 'assistant' as const, text: '', toolUses: [{ tool: 'Edit', input: { file_path: 'board.ts' } }] },
    { role: 'user' as const, text: '', toolUses: [], toolResults: [{}] },
    { role: 'assistant' as const, text: '直したよ', toolUses: [] },
  ]
  const x = lastExchange(msgs, 3, ['片付いた作業は見せなくていい', '/loop 進めて'])
  expect(x?.user).toBe('ボードを直して\n\n片付いた作業は見せなくていい')
  expect(x?.recentUser).toEqual(['ボードを直して', '片付いた作業は見せなくていい'])
  expect(x?.prevAssistant).toBe('前のターンの返信')
  expect(x?.tools).toEqual(['Edit board.ts'])
})

test('出どころ：このターンに by=user で足した、まだ認められていない決定だけを確かめ、書かれていないものを指摘にする', async () => {
  let s = replay(diffs, 'audit')
  s = apply(s, { turn: 4, utterance_id: 'τ4', relation: 'Elaboration', ops: [{ op: 'add', id: 'C6', content: '通知は Slack に送る' }] })
  const items = attributionTargets(s, 4)
  expect(items).toEqual([{ id: 'C6', content: '通知は Slack に送る' }])
  const flags = parseAttribution('{"verdicts": [{"id": "C6", "grounded": false, "why": "Slack とは言っていない"}]}', items)
  expect(flags).toEqual([{ kind: 'attribution', text: '「通知は Slack に送る」はユーザーの発言に書かれていない（Slack とは言っていない）。文脈の補完では？' }])
  expect(parseAttribution('だめ', items)).toBe(null)
})

test('食い違い：ボードと作業をプロンプトに入れ、指摘だけを返す。ボードは書き換えない', async () => {
  const s = replay(diffs, 'audit')
  const p = buildDeviationPrompt(s, { user: '進めて', recentUser: ['進めて'], prevAssistant: '', assistant: '規準監査を飛ばしてカードを読んだ', tools: [] })
  expect(p.includes('1. 規準監査（sonnet）')).toBe(true)
  expect(p.includes('監査はユーザーが指示したときだけ')).toBe(true)
  expect(parseDeviation('{"flags": [{"text": "流れでは規準監査が先なのに飛ばした"}, {"kind": "relevance", "text": "範囲を聞かれたのに時刻に答えている"}]}')).toEqual([{ kind: 'deviation', text: '流れでは規準監査が先なのに飛ばした' }, { kind: 'relevance', text: '範囲を聞かれたのに時刻に答えている' }])
  expect(parseDeviation('{"flags": []}')).toEqual([])
})
