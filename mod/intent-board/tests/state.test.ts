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

test('ペイン：このターンの補完・あなたが決めること・手順を先に出し、履歴はたたむ', async () => {
  let s = replay(diffs, 'audit')
  s = apply(s, {
    turn: 4, utterance_id: 'σ4', relation: 'Continuation',
    ops: [{ op: 'add', id: 'C6', content: '通知は 4時50分に送る', by: 'claude', reason: '時刻は言われていない' },
          { op: 'open', id: 'Q2', question: '通知先はどこか' }],
  })
  const secs = (flipped: string[]) => sections(board(s), new Set(flipped))
  const byKey = (flipped: string[]) => new Map(secs(flipped).map(x => [x.key, x]))
  expect(secs([]).map(x => x.key)).toEqual(['fresh', 'mine', 'steps', 'older', 'decided', 'replaced'])
  const fresh = byKey([]).get('fresh')!
  expect(fresh.items).toEqual([{ key: 's:C6', text: '通知は 4時50分に送る', sub: '時刻は言われていない', tone: 'supplemented' }])
  expect(byKey([]).get('mine')!.items.map(i => i.text)).toEqual(['通知先はどこか', '監査ジョブをどう組むか'])
  // 履歴は既定でたたむ。押すと開く
  expect(byKey([]).get('older')!.items).toEqual([])
  expect(byKey(['older']).get('older')!.items.length).toBe(2)
  expect(byKey([]).get('decided')!.groups).toEqual([])
  expect(byKey(['decided']).get('decided')!.groups!.map(g => g.title)).toEqual(['監査ジョブをどう組むか'])
  expect(byKey(['replaced']).get('replaced')!.items[0]!.sub).toBe('→ 実行は 10/5 5時ごろ（日付が変わっていたのを見落としていた）')
  // id は表に出さない
  expect(JSON.stringify(secs(['older', 'decided', 'replaced']).map(x => [x.title, x.items.map(i => i.text)]))).not.toMatch(/\bC\d+\b/)
})

test('apply は入力を変えない', async () => {
  const s = replay(diffs.slice(0, 3), 'audit')
  const before = JSON.stringify(s)
  apply(s, diffs[3]!)
  expect(JSON.stringify(s)).toBe(before)
})
