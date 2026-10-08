import { expect, test } from 'claude-code/testing'

import { bandLine, boardPath, parseBoard, recordsBase, sections, view } from '../hooks/board'
import type { Board } from '../types'
import { board, replay } from '../hooks/state'
import type { Diff } from '../hooks/state'
import { SELF_BOARD } from './fixtures'

const BOARD = {
  turn: 3,
  goal: { quote: ['全カードを読むべき'], reading: 'ルールで拾えない違和感を代わりに拾って納品判断する', source: 'π1' },
  decided: [{ id: 'C1', content: '監査は指示したときだけ', source: 'π2' }],
  replaced: [{ id: 'C2', content: '実行は 10/6 5時', turn: 3, source: 'π3', replaced_by: 'C5' }],
  supplemented: [{ id: 'C3', content: '結果を見る前に読む', source: 'σ2', reason: '引っぱられ防止' }],
  steps: [{ text: '規準監査', from: ['C1'] }],
  open: [{ id: 'Q1', question: '範囲', owner: 'claude', parent: 'Q0' }],
}

test('board.json を読めて、壊れていたら null', async () => {
  expect(parseBoard(JSON.stringify(BOARD))?.turn).toBe(3)
  expect(parseBoard('{"turn": 1')).toBe(null)
  expect(parseBoard(undefined)).toBe(null)
  expect(parseBoard('{"turn": 1}')).toBe(null)
})

test('帯の1行は目的の読み・補った前提・問いの数', async () => {
  const board = parseBoard(JSON.stringify(BOARD))
  expect(board).not.toBe(null)
  const line = bandLine(board!, 10)
  expect(line.goal).toBe('ルールで…')
  expect(line.supplemented).toBe(1)
  expect(line.open).toBe(1)
})

test('置き場は<Claude の設定フォルダ>/discourse-state/セッション id/board.json', async () => {
  expect(boardPath('C:\\cfg\\', 'abc')).toBe('C:\\cfg/discourse-state/abc/board.json')
})

test('設定フォルダは CLAUDE_CONFIG_DIR が優先', async () => {
  expect(recordsBase({ CLAUDE_CONFIG_DIR: 'D:\\cfg', USERPROFILE: 'C:\\Users\\u', HOME: '/home/u' })).toBe('D:\\cfg')
})

test('設定フォルダは CLAUDE_CONFIG_DIR が無ければ USERPROFILE/.claude、その次に HOME/.claude', async () => {
  expect(recordsBase({ USERPROFILE: 'C:\\Users\\u\\', HOME: '/home/u' })).toBe('C:\\Users\\u/.claude')
  expect(recordsBase({ HOME: '/home/u' })).toBe('/home/u/.claude')
  expect(recordsBase({ CLAUDE_CONFIG_DIR: '', USERPROFILE: '', HOME: '/home/u' })).toBe('/home/u/.claude')
})

test('設定フォルダが決められないときはエラー（一時フォルダに落ちない）', async () => {
  expect(() => recordsBase({})).toThrow('記録の置き場を決められない')
})

// テスト環境には fs が無いので board.json は読めない。ボードなしの描画が両方の面で通ることだけ確かめる
// （ボードありの描画は実機で確認する）
test('ボードが無いとき、帯は出さずペインは案内を出す（terminal・vscode）', async ($, on) => {
  // 帯を譲ったときにエンジンが描く分の代わり
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { key: 'engine' }, 'engine') as any
  })
  for (const surface of ['terminal', 'vscode'] as const) {
    const pane = await $.ui.mount({
      plugin: 'discourse-state', surface, component: 'Pane', requestId: 'discourse-state',
      props: { title: '意図ボード', isFocused: true, bodyColumns: 80, placement: 'dock' } as any,
    })
    expect(await pane.find({ type: 'Text', text: /まだボードがない/ })).toBeDefined()
    await pane.unmount()
    const band = await $.ui.mount({
      plugin: 'discourse-state', surface, component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120 } as any,
    })
    expect(await band.find({ key: 'supplemented' })).toBeUndefined()
    await band.unmount()
  }
})

// ---------------------------------------------------------------- full（view.json 用）と view()
// 作業を全部片付けた板（片付いた作業は既定でたたまれる）
const closedBoard = (): Board => {
  const b = structuredClone(SELF_BOARD) as unknown as Board
  b.tasks = b.tasks.map(t => ({ ...t, closed: true }))
  b.open = []
  return b
}
const texts = (secs: ReturnType<typeof sections>) => secs.flatMap(s => s.items.map(i => i.text))

test('full=false は今までどおり：片付いた作業の中身は入らない', async () => {
  const b = closedBoard()
  const archive = sections(b, new Set()).find(s => s.key === 'archive')
  expect(archive?.items).toEqual([])
  expect(sections(b, new Set(), [], false)).toEqual(sections(b, new Set()))
})

test('full=true は片付いた作業の中身も入り、開閉の既定は変わらない', async () => {
  const b = closedBoard()
  const archive = sections(b, new Set(), [], true).find(s => s.key === 'archive')!
  expect(archive.collapsible?.open).toBe(false)
  expect(archive.items.length).toBeGreaterThan(0)
  const head = archive.items.find(i => i.toggle)!
  expect(head.toggle?.open).toBe(false)
  expect(archive.items.some(i => i.text.startsWith('意図：'))).toBe(true)
})

test('full=true でも開いている作業の出力は full=false と同じ', async () => {
  const b = parseBoard(JSON.stringify(SELF_BOARD))!
  expect(sections(b, new Set(), [], true)).toEqual(sections(b, new Set()))
})

test('view() は version 1・meta・帯をそのまま持ち、sections は full 版で goal は切らない', async () => {
  const b = closedBoard()
  b.tasks[0]!.intent = { quote: ['q'], source: null, reading: 'あ'.repeat(200) }
  b.open = [{ id: b.tasks[0]!.id, question: b.tasks[0]!.question, owner: 'claude' } as Board['open'][number]]
  const meta = { updatedAt: '2026-10-08T00:00:00.000Z', session: 's', cwd: 'C:/x', turn: 7, note: 'ボード未更新' }
  const v = view(b, meta)
  expect(v.version).toBe(1)
  expect(v).toMatchObject({ updatedAt: meta.updatedAt, session: 's', cwd: 'C:/x', turn: 7 })
  expect(v.band.goal).toBe('あ'.repeat(200))
  expect(v.band.note).toBe('ボード未更新')
  expect(v.sections).toEqual(sections(b, new Set(), [], true))
  expect(texts(v.sections).length).toBeGreaterThan(0)
})
