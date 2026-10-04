import { expect, test } from 'claude-code/testing'

import { outline } from '../hooks/board'
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

test('ペインの木：開いた問いは開き、片付いた問いはたたむ。補った前提は木に入れず上にまとめる', async () => {
  let s = replay(diffs, 'audit')
  s = apply(s, { turn: 4, utterance_id: 'π4', relation: 'Answer', ops: [{ op: 'answer', question: 'Q1', by: 'C5', complete: true }] })
  const keys = (flipped: string[]) => outline(board(s), new Set(flipped)).map(r => r.key)
  const rows = outline(board(s), new Set())
  expect(rows[0]!.text.startsWith('目的：')).toBe(true)
  expect(rows.some(r => r.key === 's:C3')).toBe(true)
  expect(rows.some(r => r.key === 'c:C3')).toBe(false)
  const q1 = rows.find(r => r.key === 'q:Q1')!
  expect(q1.text.startsWith('✓ Q1')).toBe(true)
  expect(q1.toggle?.open).toBe(false)
  expect(keys([]).includes('c:C0')).toBe(true)
  expect(keys(['q:Q0']).includes('c:C0')).toBe(false)
  expect(keys(['replaced']).includes('x:C2')).toBe(true)
  expect(keys([]).includes('x:C2')).toBe(false)
})

test('apply は入力を変えない', async () => {
  const s = replay(diffs.slice(0, 3), 'audit')
  const before = JSON.stringify(s)
  apply(s, diffs[3]!)
  expect(JSON.stringify(s)).toBe(before)
})
