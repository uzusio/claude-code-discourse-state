import { expect, test } from 'claude-code/testing'

import { sections } from '../hooks/board'
import { apply, board, emptyState, replay, validate } from '../hooks/state'
import type { Diff } from '../hooks/state'
import { AUDIT_BOARD, AUDIT_DIFFS } from './fixtures'

const diffs = AUDIT_DIFFS as unknown as Diff[]

test('Python 版と同じボードになる（監査ジョブの例）', async () => {
  expect(board(replay(diffs, 'audit'))).toEqual(AUDIT_BOARD)
})

test('補った前提に理由が無いと弾く', async () => {
  const s = replay(diffs, 'audit')
  const p = validate(s, { turn: 4, utterance_id: 'σ4', relation: 'Continuation', ops: [{ op: 'add', id: 'C6', content: 'x', by: 'claude' }] })
  expect(p.some(x => x.includes('reason'))).toBe(true)
})

test('confirm で ④ から ② に移る', async () => {
  const s = replay(diffs, 'audit')
  const d: Diff = { turn: 4, utterance_id: 'π4', relation: 'Acknowledge', ops: [{ op: 'confirm', id: 'C4' }] }
  expect(validate(s, d)).toEqual([])
  const b = board(apply(s, d))
  expect(b.decided.some(c => c.id === 'C4')).toBe(true)
  expect(b.supplemented.some(c => c.id === 'C4')).toBe(false)
})

test('取り消したものに依存している決定を放置すると弾く', async () => {
  let s = emptyState('t')
  s = apply(s, { turn: 1, utterance_id: 'π1', relation: 'Continuation', ops: [{ op: 'add', id: 'C0', content: 'A' }, { op: 'add', id: 'C1', content: 'B', depends_on: ['C0'] }] })
  const p = validate(s, { turn: 2, utterance_id: 'π2', relation: 'Correction', ops: [{ op: 'retract', id: 'C0' }] })
  expect(p.some(x => x.includes('C1 は C0 に依存'))).toBe(true)
})

test('ペイン：意図の読み → 流れ → あなたが決めること を先に出し、履歴（補った前提を含む）はたたむ', async () => {
  let s = replay(diffs, 'audit')
  s = apply(s, {
    turn: 4, utterance_id: 'σ4', relation: 'Continuation',
    ops: [{ op: 'add', id: 'C6', content: '通知は 4時50分に送る', by: 'claude', reason: '時刻は言われていない' },
          { op: 'open', id: 'Q2', question: '通知先はどこか' }],
  })
  const secs = (flipped: string[]) => sections(board(s), new Set(flipped))
  const byKey = (flipped: string[]) => new Map(secs(flipped).map(x => [x.key, x]))
  expect(secs([]).map(x => x.key)).toEqual(['reading', 'flow', 'mine', 'decided', 'supplemented', 'replaced'])

  const reading = byKey([]).get('reading')!.items
  expect(reading.filter(i => i.tone === 'quote').length).toBe(2)
  expect(reading.find(i => i.tone === 'strong')!.text).toContain('代わりに拾って')
  expect(reading.find(i => i.key === 'focus')!.text).toBe('いま扱っている問い：通知先はどこか')

  // 流れ：なぜ・どの意図から・言われていない前提（黄色）
  const step2 = byKey([]).get('flow')!.items[1]!
  expect(step2.text).toBe('2. 結果を見る前に Claude が全カードを読む')
  expect(step2.sub).toEqual([
    'ルールで拾えない違和感を、ユーザーの代わりに見る（目的の中心）',
    '← 目的・「最後にトップのエージェントが全カードを読む」',
    '言われていない前提：規準監査の結果を見る前に読む（結果に判断を引っぱられないため）',
    '言われていない前提：読むのは Claude 本人（「トップのエージェント」から。別エージェントの可能性は検討していない）',
  ])

  expect(byKey([]).get('mine')!.items.map(i => i.text)).toEqual(['通知先はどこか', '監査ジョブをどう組むか'])
  // 履歴は既定でたたむ。補った前提は見出しに新しい件数を出す
  expect(byKey([]).get('supplemented')!.title).toBe('補った前提（3・うち新しく 1）')
  expect(byKey([]).get('supplemented')!.items).toEqual([])
  expect(byKey(['supplemented']).get('supplemented')!.items[0]!.text).toBe('新 通知は 4時50分に送る')
  expect(byKey(['decided']).get('decided')!.groups!.map(g => g.title)).toEqual(['監査ジョブをどう組むか'])
  expect(byKey(['replaced']).get('replaced')!.items[0]!.sub).toEqual(['→ 実行は 10/5 5時ごろ（日付が変わっていたのを見落としていた）'])
  // id は表に出さない
  const shown = JSON.stringify(secs(['decided', 'supplemented', 'replaced']).map(x => [x.title, x.items.map(i => [i.text, i.sub])]))
  expect(shown).not.toMatch(/\b[CQ]\d+\b/)
})

test('apply は入力を変えない', async () => {
  const s = replay(diffs.slice(0, 3), 'audit')
  const before = JSON.stringify(s)
  apply(s, diffs[3]!)
  expect(JSON.stringify(s)).toBe(before)
})
