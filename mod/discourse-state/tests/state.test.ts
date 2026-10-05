import { expect, test } from 'claude-code/testing'

import { bandLine, sections } from '../hooks/board'
import { apply, board, emptyState, renderCompact, renderIds, replay, validate } from '../hooks/state'
import type { Diff } from '../hooks/state'
import { AUDIT_BOARD, AUDIT_DIFFS, SELF_BOARD, SELF_DIFFS } from './fixtures'

const diffs = AUDIT_DIFFS as unknown as Diff[]

test('Python 版と同じボードになる（監査ジョブの例）', async () => {
  expect(board(replay(diffs, 'audit'))).toEqual(AUDIT_BOARD)
})

test('Python 版と同じボードになる（作業ごとの意図と関係ラベルの例）', async () => {
  const b = board(replay(SELF_DIFFS as unknown as Diff[], 'self'))
  expect(b).toEqual(SELF_BOARD)
  const q0 = b.tasks.find(t => t.id === 'Q0')!
  expect(q0.intent?.reading).toBe('会話を止めずに、Claude の読みとそのずれが見えるようにする')
  expect(q0.items.find(i => i.id === 'C5')).toEqual({
    id: 'C5', content: '読みは非同期に見られればよい（作業の前後は問わない）', by: 'user', turn: 3, parent: null, rel: 'answer',
    replaces: '作業を始める前に読みを確認してもらう',
  })
  expect(q0.items.find(i => i.id === 'C6')!.rel).toBe('explanation')
  expect(b.tasks.find(t => t.id === 'Q1')!.parent).toBe('Q0')
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

test('足した関係：対比は取り消さない、理由づけには対象、確認の問いは問いを開く', async () => {
  const s = replay(diffs, 'audit')
  const v = (d: Diff) => validate(s, { turn: 4, utterance_id: 'π4', ...d })
  expect(v({ relation: 'Contrast', ops: [{ op: 'add', id: 'C6', content: 'ただし通知は朝', depends_on: ['C5'] }] })).toEqual([])
  expect(v({ relation: 'Contrast', ops: [{ op: 'retract', id: 'C5' }] }).some(x => x.includes('Contrast は取り消さない'))).toBe(true)
  expect(v({ relation: 'Explanation', ops: [{ op: 'add', id: 'C6', content: '寝ている間に終わらせたいから' }] }).some(x => x.includes('理由づけの対象'))).toBe(true)
  expect(v({ relation: 'Explanation', target: 'C5', ops: [{ op: 'add', id: 'C6', content: '寝ている間に終わらせたいから' }] })).toEqual([])
  expect(v({ relation: 'Clarification', ops: [{ op: 'none' }] }).some(x => x.includes('Clarification なのに open'))).toBe(true)
})

test('ペイン：作業の木に意図と、関係ラベル付きの決まったことがぶら下がる。片付いた作業と置き換えはたたむ', async () => {
  const b = board(replay(SELF_DIFFS as unknown as Diff[], 'self'))
  const secs = (flipped: string[], audit = [] as { kind: 'deviation'; text: string }[]) => sections(b, new Set(flipped), audit)
  expect(secs([]).map(x => x.key)).toEqual(['tasks', 'flow', 'replaced'])
  expect(secs([], [{ kind: 'deviation', text: 'x' }]).map(x => x.key)).toEqual(['audit', 'tasks', 'flow', 'replaced'])

  const rows = secs([]).find(x => x.key === 'tasks')!.items
  const row = (key: string) => rows.find(r => r.key === key)!
  // 作業の見出し（押して開閉）と、その意図
  expect(row('t:Q0')).toMatchObject({ indent: 0, tone: 'task', toggle: { open: true }, text: 'Claude の意図の読みをどう見せるか（決める人：あなた）' })
  expect(row('t:Q0:reading')).toMatchObject({ indent: 1, tone: 'strong', text: '意図：会話を止めずに、Claude の読みとそのずれが見えるようにする' })
  expect(row('t:Q0:quote:0').tone).toBe('quote')
  // 決まったことは関係ラベル付きで、親の下に1段下げてぶら下がる
  expect(row('c:C5')).toMatchObject({ indent: 1, tone: 'new', text: '新 答え：読みは非同期に見られればよい（作業の前後は問わない）', sub: ['「作業を始める前に読みを確認してもらう」を置き換え'] })
  expect(row('c:C6')).toMatchObject({ indent: 2, text: '新 理由：やりとりは非同期に進めたい' })
  // 下位の作業と、その中の補完（黄色）
  expect(row('t:Q1').indent).toBe(1)
  expect(row('c:C2')).toMatchObject({ indent: 2, tone: 'supplemented', text: '答え（補完）：プロンプトの上に帯を常に出す', sub: ['補った理由：どこに出すかは言われていない。常に目に入る場所を選んだ'] })
  expect(row('c:C3')).toMatchObject({ indent: 3, tone: 'supplemented', text: '補足（補完）：帯は2行まで' })
  // 作業を押すとたたむ
  expect(secs(['t:Q0']).find(x => x.key === 'tasks')!.items.map(r => r.key)).toEqual(['t:Q0'])
  // 置き換えは既定でたたむ
  expect(secs([]).find(x => x.key === 'replaced')!.items).toEqual([])
  // id は表に出さない
  const shown = JSON.stringify(secs(['replaced']).map(x => [x.title, x.items.map(i => [i.text, i.sub])]))
  expect(shown).not.toMatch(/\b[CQ]\d+\b/)
})

test('帯：いま扱っている作業（意図を持つ作業まで親をたどる）の意図を出す', async () => {
  const b = board(replay(SELF_DIFFS as unknown as Diff[], 'self'))
  // いちばん新しい開いた問いは「帯を常に出してうるさくないか」（意図なし）→ 親の「帯に何を出すか」の意図
  expect(bandLine(b, 200).goal).toBe('会話の邪魔をせずに、いまの読みが目に入るようにする')
})

test('board_update の結果は短い要約（最近の決定・次の ID）と、弾かれた id だけ', async () => {
  const s = replay(diffs, 'audit')
  const text = renderCompact(s, 2)
  expect(text.includes('最近の決定（全 5 件中 2 件）:')).toBe(true)
  expect(text.includes('- C5 実行は 10/5 5時ごろ')).toBe(true)
  expect(text.includes('- C0 ')).toBe(false)
  expect(text.endsWith('次の ID: C6 / Q2')).toBe(true)
  expect(renderIds(s, ['C2', 'Q1'])).toBe('- C2（存在しない）\n- Q1 監査をどの範囲にかけるか')
})

test('apply は入力を変えない', async () => {
  const s = replay(diffs.slice(0, 3), 'audit')
  const before = JSON.stringify(s)
  apply(s, diffs[3]!)
  expect(JSON.stringify(s)).toBe(before)
})
