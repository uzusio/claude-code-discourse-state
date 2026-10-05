import { expect, test } from 'claude-code/testing'

import { bandLine, nextStep, sections } from '../hooks/board'
import { apply, board, emptyState, renderCompact, renderIds, replay, validate } from '../hooks/state'
import type { Diff } from '../hooks/state'
import { AUDIT_BOARD, AUDIT_DIFFS, SELF_BOARD, SELF_DIFFS } from './fixtures'

const diffs = AUDIT_DIFFS as unknown as Diff[]

test('Python 版と同じボードになる（監査ジョブの例）', async () => {
  expect(board(replay(diffs, 'audit'))).toEqual(AUDIT_BOARD)
})

test('Python 版と同じボードになる（作業ごとの意図・補完・流れの例）', async () => {
  const b = board(replay(SELF_DIFFS as unknown as Diff[], 'self'))
  expect(b).toEqual(SELF_BOARD)
  const q0 = b.tasks.find(t => t.id === 'Q0')!
  // 訂正で読みが書き換わり、前の読みは履歴に
  expect(q0.intent?.reading).toBe('非同期のやりとりの中で、Claude の読みとずれをいつでも見られるようにする')
  expect(q0.intent_history.map(h => h.reading)).toEqual(['作業を始める前に、Claude の読みを確かめられるようにする'])
  expect(q0.steps.map(st => st.text)).toEqual(['帯に意図の読みと次の一歩を出す', 'ボードに作業ごとの意図・補完・流れを並べる', '話しかけて読みを直せるようにする'])
  expect(b.tasks.find(t => t.id === 'Q1')!.items.find(i => i.id === 'C2')!.rel).toBe('condition')
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

test('move：補完を片付いた作業へ付け替えるとボードから消える', async () => {
  const s = replay(SELF_DIFFS as unknown as Diff[], 'self')
  const d: Diff = {
    turn: 3, utterance_id: 't', relation: 'Continuation',
    ops: [{ op: 'open', id: 'Q2', question: '進め方', owner: 'user' }, { op: 'move', id: 'C0', question: 'Q2' }, { op: 'answer', question: 'Q2', complete: true }],
  }
  expect(validate(s, d)).toEqual([])
  const b = board(apply(s, d))
  expect(b.tasks.find(t => t.id === 'Q0')!.items.some(i => i.id === 'C0')).toBe(false)
  const shown = sections(b, new Set()).find(x => x.key === 'tasks')!.items.map(i => i.key)
  expect(shown.includes('c:C0')).toBe(false)
  expect(shown.includes('t:Q2')).toBe(false)
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

test('ペイン：作業ごとに 意図・文脈の補完・流れ の3つだけ。作業は木、片付いた作業は出さない', async () => {
  const b = board(replay(SELF_DIFFS as unknown as Diff[], 'self'))
  const secs = (flipped: string[]) => sections(b, new Set(flipped))
  expect(secs([]).map(x => x.key)).toEqual(['tasks'])
  const rows = secs([]).find(x => x.key === 'tasks')!.items
  const row = (key: string) => rows.find(r => r.key === key)!
  // 作業の見出し（決める人は出さない）と、意図・ユーザーの言葉・前の読み
  expect(row('t:Q0')).toMatchObject({ indent: 0, tone: 'task', toggle: { open: true }, text: 'Claude の意図の読みをどう見せるか' })
  expect(row('t:Q0:reading')).toMatchObject({ indent: 1, tone: 'strong', text: '意図：非同期のやりとりの中で、Claude の読みとずれをいつでも見られるようにする' })
  expect(row('t:Q0:quote:2').text).toBe('「作業の前か後かは関係ない。やりとりは非同期に進めたい」')
  expect(row('t:Q0:prev')).toMatchObject({ tone: 'dim', text: '前の読み：作業を始める前に、Claude の読みを確かめられるようにする' })
  // 文脈の補完（黄色・理由つき）。補完どうしの線にはラベル
  expect(row('c:C0')).toMatchObject({ indent: 1, tone: 'supplemented', text: '補完：読みはボタンで開くボードに、要点は帯に出す', sub: ['補った理由：どこに出すかは言われていない。会話を邪魔しない場所を選んだ'] })
  expect(row('c:C2')).toMatchObject({ indent: 3, tone: 'supplemented', text: '補完（条件）：帯は2行まで' })
  // 流れ（作業ごと）
  expect(row('t:Q0:flow').text).toBe('流れ')
  expect(row('t:Q0:p:0')).toMatchObject({ indent: 2, text: '1. 帯に意図の読みと次の一歩を出す', sub: ['会話を止めずに読みのずれに気づける'] })
  // 下位の作業
  expect(row('t:Q1').indent).toBe(1)
  // 作業を押すとたたむ
  expect(secs(['t:Q0']).find(x => x.key === 'tasks')!.items.map(r => r.key)).toEqual(['t:Q0'])
  // id は表に出さない
  expect(JSON.stringify(rows.map(i => [i.text, i.sub]))).not.toMatch(/\b[CQ]\d+\b/)
})

test('帯：いま扱っている作業の意図と、その作業の流れの次の一歩', async () => {
  const b = board(replay(SELF_DIFFS as unknown as Diff[], 'self'))
  // いちばん新しい開いた作業は「帯に何を出すか」
  expect(bandLine(b, 200).goal).toBe('会話の邪魔をせずに、いまの読みが目に入るようにする')
  expect(nextStep(b)).toBe('次：1行目に意図の読み、2行目に次の一歩')
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
