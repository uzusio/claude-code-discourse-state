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

test('move：補完を片付いた作業へ付け替えると、作業と意図の欄から消えて片付いた作業の欄に移る', async () => {
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
  const archive = sections(b, new Set()).find(x => x.key === 'archive')!
  expect(archive.title).toBe('片付いた作業（1）')
  expect(archive.items).toEqual([])
  const opened = sections(b, new Set(['archive'])).find(x => x.key === 'archive')!.items
  expect(opened.map(i => i.key)).toEqual(['t:Q2'])
  expect(opened[0]!.toggle).toEqual({ open: false })
  const full = sections(b, new Set(['archive', 't:Q2'])).find(x => x.key === 'archive')!.items.map(i => i.key)
  expect(full.includes('c:C0')).toBe(true)
  expect(full.some(k => k.includes(':flow'))).toBe(false)
})

test('親が片付いても、開いている子は作業と意図の欄に根として残り、親は片付いた作業の欄に出る', async () => {
  const s = replay([{ utterance_id: 'τ1', relation: 'Open', ops: [
    { op: 'open', id: 'Q0', question: '親', owner: 'user' },
    { op: 'open', id: 'Q1', question: '子', owner: 'user', parent: 'Q0' },
    { op: 'answer', question: 'Q0', complete: true },
  ] }] as unknown as Diff[], 'orphan')
  const b = board(s)
  const rows = sections(b, new Set()).find(x => x.key === 'tasks')!.items
  expect(rows.find(r => r.key === 't:Q1')).toMatchObject({ indent: 0 })
  expect(rows.some(r => r.key === 't:Q0')).toBe(false)
  const arch = sections(b, new Set(['archive'])).find(x => x.key === 'archive')!.items
  expect(arch.map(r => r.key)).toEqual(['t:Q0'])
})

test('片付いた作業の欄は、新しく片付けた方（後に開いた方）が先に並ぶ', async () => {
  const s = replay([{ utterance_id: 'τ1', relation: 'Open', ops: [
    { op: 'open', id: 'Q0', question: '先', owner: 'user' },
    { op: 'open', id: 'Q1', question: '後', owner: 'user' },
    { op: 'answer', question: 'Q0', complete: true },
    { op: 'answer', question: 'Q1', complete: true },
  ] }] as unknown as Diff[], 'order')
  const arch = sections(board(s), new Set(['archive'])).find(x => x.key === 'archive')!.items
  expect(arch.map(r => r.key)).toEqual(['t:Q1', 't:Q0'])
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

test('ペイン：作業ごとに 意図・文脈の補完・流れ の3つだけ。作業は木、片付いた作業は別の欄', async () => {
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

test('board_update の結果の手順には、作業ごとの流れ（plan {question}）が出る', async () => {
  // 作業を開くのと流れを置くのを1回の差分でまとめても、手順が「なし」にならない
  const s = replay([{ utterance_id: 'τ1', relation: 'Open', ops: [
    { op: 'open', id: 'Q0', question: '切り替える', owner: 'user', intent: { quote: ['切り替える'], reading: '作業場だけに入れる' } },
    { op: 'plan', question: 'Q0', steps: [{ text: '開き直す', why: '起動時に読む' }, { text: '編集を確かめる', why: '目的の確認' }] },
  ] }] as unknown as Diff[], 'plan')
  expect(renderCompact(s).includes('手順: Q0 1. 開き直す ／ 2. 編集を確かめる')).toBe(true)
  // 片付いた作業の流れは出さない
  const done = apply(s, { utterance_id: 'τ2', relation: 'Result', ops: [{ op: 'answer', question: 'Q0', complete: true }] } as unknown as Diff)
  expect(renderCompact(done).includes('手順: なし')).toBe(true)
})

test('作業が全部片付いたら、帯とペインは「開いている作業はない」と片付いた件数を出す', async () => {
  const opened = replay([{ utterance_id: 'τ1', relation: 'Open', ops: [
    { op: 'open', id: 'Q0', question: '切り替える', owner: 'user', intent: { quote: ['切り替える'], reading: '作業場だけに入れる' } },
  ] }] as unknown as Diff[], 'empty')
  const done = board(apply(opened, { utterance_id: 'τ2', relation: 'Result', ops: [{ op: 'answer', question: 'Q0', complete: true }] } as unknown as Diff))
  expect(bandLine(done, 200).goal).toBe('開いている作業はない（片付いた作業 1 件）')
  expect(sections(done, new Set()).map(x => x.key)).toEqual(['tasks', 'archive'])
  expect(sections(done, new Set()).find(x => x.key === 'tasks')!.items.map(i => i.text)).toEqual(['開いている作業はない（片付いた作業 1 件）'])
  // 何も書かれていないときは「まだ読めていない」（「意図：」は描く側が付けるので、ここには付けない）
  expect(bandLine(board(emptyState('none')), 200).goal).toBe('まだ読めていない')
})

test('apply は入力を変えない', async () => {
  const s = replay(diffs.slice(0, 3), 'audit')
  const before = JSON.stringify(s)
  apply(s, diffs[3]!)
  expect(JSON.stringify(s)).toBe(before)
})
