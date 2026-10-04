import { expect, test } from 'claude-code/testing'

import { buildJudgePrompt, buildPrompt, demote, lastExchange, parseReply, parseVerdicts, userAdds } from '../hooks/parse'
import { emptyState } from '../hooks/state'

test('返答の JSON を前置きやコードフェンスごと拾う', async () => {
  const r = parseReply('はい。\n```json\n{"user": {"relation": "Acknowledge", "ops": [{"op": "none"}]}, "claude": null}\n```')
  expect(r?.user?.relation).toBe('Acknowledge')
  expect(r?.claude).toBe(null)
  expect(parseReply('JSON なし')).toBe(null)
  expect(parseReply('{"other": 1}')).toBe(null)
})

test('最後の発言と、その後の返信・作業を1ターンとして取る', async () => {
  const x = lastExchange([
    { role: 'user', text: '前の発言', toolUses: [] },
    { role: 'assistant', text: '前の返信', toolUses: [] },
    { role: 'user', text: 'Issue を進めて', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [{ tool: 'Bash', input: { description: 'テストを回す' } }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{}] },
    { role: 'assistant', text: '進めたよ', toolUses: [] },
  ])
  expect(x).toEqual({ user: 'Issue を進めて', assistant: '進めたよ', tools: ['Bash テストを回す'] })
})

test('判定機：発言に書かれていない「決まったこと」は補った前提に回す', async () => {
  const diff = {
    relation: 'Elaboration',
    ops: [
      { op: 'add', id: 'C1', content: 'Issue で管理する' },
      { op: 'add', id: 'C2', content: 'Issue にはラベルを付ける' },
      { op: 'add', id: 'C3', content: '補った', by: 'claude', reason: 'x' },
    ],
  }
  expect(userAdds(diff).map(a => a.id)).toEqual(['C1', 'C2'])
  expect(buildJudgePrompt('Issue で管理して', userAdds(diff)).includes('- C2: Issue にはラベルを付ける')).toBe(true)
  const ungrounded = parseVerdicts('{"verdicts": [{"id": "C1", "grounded": true}, {"id": "C2", "grounded": false, "why": "ラベルは言っていない"}]}')
  expect(ungrounded?.size).toBe(1)
  const d = demote(diff, ungrounded!)
  expect(d.ops![1]).toEqual({ op: 'add', id: 'C2', content: 'Issue にはラベルを付ける', by: 'claude', reason: '判定機：発言に書かれていない（ラベルは言っていない）' })
  expect(d.ops![0]).toEqual(diff.ops[0])
  expect(parseVerdicts('だめ')).toBe(null)
})

test('プロンプトに状態・次の ID・やり取りが入る', async () => {
  const p = buildPrompt(emptyState('t'), { user: 'こんにちは', assistant: 'やあ', tools: [] })
  expect(p.includes('次の ID: コミットメント C0〜、問い Q0〜')).toBe(true)
  expect(p.includes('こんにちは')).toBe(true)
})
