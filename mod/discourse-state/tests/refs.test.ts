// 作業をプロジェクトの管理の単位（Issue など）に結び付ける参照と、未登録の作業（#19）
import { expect, test } from 'claude-code/testing'

import { refDefsPaths, sections, view } from '../hooks/board'
import { board, parseRefDefs, renderCompact, replay, unregistered, validate } from '../hooks/state'
import type { Diff, RefDef } from '../hooks/state'
import type { Board } from '../types'
import { REFS_BOARD, REFS_BOARD_NO_DEFS, REFS_DEFS, REFS_DIFFS, REFS_UNREGISTERED, REFS_VALIDATION } from './fixtures'

const diffs = REFS_DIFFS as unknown as Diff[]
const defs = REFS_DEFS as RefDef[]
const DEFS_TEXT = JSON.stringify({ refs: REFS_DEFS })
const TOOL = 'mcp__discourse-state__board_update'

// ---------------------------------------------------------------- 純粋関数（Python 版と同じ結果）

test('Python 版と同じボードになる（参照の例。定義あり・なし）', async () => {
  expect(board(replay(diffs, 'refs'), 3, defs)).toEqual(REFS_BOARD)
  expect(board(replay(diffs, 'refs'))).toEqual(REFS_BOARD_NO_DEFS)
})

test('Python 版と同じ未登録の作業になる（track を持つ参照なし・local でない・閉じていない）', async () => {
  const s = replay(diffs, 'refs')
  expect(unregistered(s, defs)).toEqual(REFS_UNREGISTERED)
  expect(unregistered(s, null)).toEqual([])
  expect(unregistered(s, defs.map(d => ({ ...d, track: false })))).toEqual([])
})

test('Python 版と同じ検証の文面になる（形の誤り・重複・定義に合わない参照・定義なしなら何でも可）', async () => {
  const s = replay(diffs, 'refs')
  for (const c of REFS_VALIDATION) expect(validate(s, c.diff as unknown as Diff, c.withDefs ? defs : null)).toEqual(c.problems)
})

test('board_update の結果：作業に参照を並べ、未登録なら〔未登録〕。定義も参照も無ければ今までどおり', async () => {
  const s = replay(diffs, 'refs')
  const text = renderCompact(s, 8, defs)
  expect(text).toContain('Q0 ログインできない不具合を直す〔参照：#12 docs/login.md〕〔意図：')
  expect(text).toContain('Q2 設定画面を作る〔未登録〕〔意図：')
  expect(text).toContain('Q1 ビルドが遅い理由を調べる〔意図：')
  expect(renderCompact(s)).not.toContain('未登録')
})

test('定義ファイルの読み方：壊れていれば定義なしと、何が壊れているか', async () => {
  expect(parseRefDefs(DEFS_TEXT)).toEqual({ defs, problem: null })
  const broken = (text: string) => parseRefDefs(text)
  expect(broken('{').defs).toBeNull()
  expect(broken('{').problem).toContain('JSON として読めない')
  expect(broken('{}').problem).toBe('refs（定義の配列）が無い')
  expect(broken('{"refs":[{"pattern":"^x$"}]}').problem).toBe('refs[0] に name が無い')
  expect(broken('{"refs":[{"name":"x"}]}').problem).toBe('refs[0] に pattern が無い')
  expect(broken('{"refs":[{"name":"x","pattern":"("}]}').problem).toContain('refs[0] の pattern が正規表現として不正')
  expect(broken('{"refs":[{"name":"x","pattern":"x","track":"yes"}]}').problem).toBe('refs[0] の track が真偽値でない')
})

test('定義ファイルを探す場所：作業フォルダから上へ、根まで', async () => {
  expect(refDefsPaths('/work/repo/sub')).toEqual([
    '/work/repo/sub/.claude/discourse-state.json', '/work/repo/.claude/discourse-state.json', '/work/.claude/discourse-state.json', '/.claude/discourse-state.json',
  ])
  expect(refDefsPaths('C:\\work\\repo\\')).toEqual(['C:/work/repo/.claude/discourse-state.json', 'C:/work/.claude/discourse-state.json', 'C:/.claude/discourse-state.json'])
})

test('ペインの見出し：<最初の参照> <作業名>、未登録なら末尾に「（未登録）」。参照の無い作業は今までどおり', async () => {
  const rows = sections(REFS_BOARD as unknown as Board, new Set()).find(x => x.key === 'tasks')!.items
  const row = (key: string) => rows.find(r => r.key === key)!
  expect(row('t:Q0').text).toBe('#12 ログインできない不具合を直す')
  expect(row('t:Q0').refs).toEqual([
    { ref: '#12', name: 'Issue', url: 'https://github.com/owner/repo/issues/12' },
    { ref: 'docs/login.md', name: '文書', url: 'https://github.com/owner/repo/blob/main/docs/login.md' },
  ])
  expect(row('t:Q2')).toMatchObject({ text: '設定画面を作る（未登録）', unregistered: true })
  expect(row('t:Q1').text).toBe('ビルドが遅い理由を調べる')
  expect('refs' in row('t:Q1') || 'unregistered' in row('t:Q1')).toBe(false)
  // 定義が無ければ未登録は出ない（参照は出る）
  const plain = sections(REFS_BOARD_NO_DEFS as unknown as Board, new Set()).find(x => x.key === 'tasks')!.items
  expect(plain.find(r => r.key === 't:Q2')!.text).toBe('設定画面を作る')
  expect(plain.find(r => r.key === 't:Q0')!.refs).toEqual([{ ref: '#12' }, { ref: 'docs/login.md' }])
})

test('view：見出しの行に refs と unregistered、band に unregistered（1 件以上のときだけ）', async () => {
  const meta = { updatedAt: '2026-10-08T00:00:00.000Z', session: 's', cwd: 'C:/x', turn: 4, note: null }
  const v = view(REFS_BOARD as unknown as Board, meta)
  expect(v.band.unregistered).toBe(1)
  const heads = v.sections.flatMap(s => s.items).filter(i => i.toggle)
  expect(heads.find(i => i.key === 't:Q2')!.unregistered).toBe(true)
  expect(heads.find(i => i.key === 't:Q3')!.refs!.map(r => r.ref)).toEqual(['#15', 'docs/setup.md'])
  expect('unregistered' in view(REFS_BOARD_NO_DEFS as unknown as Board, meta).band).toBe(false)
})

// ---------------------------------------------------------------- mod（定義ファイルを読んで純粋関数に渡す）

// エンジンの代わり。files は path → 中身（無いものは読めない）。書かれたファイル・トーストを集める
function engine(on: (event: any, hook: any) => void, cwd: string, files: Record<string, string>) {
  const written: Record<string, string> = {}
  const toasts: string[] = []
  on('session.id', () => ({ value: 'test' }))
  on('session.cwd', () => ({ value: cwd }))
  on('session.turns', () => ({ value: 3 }))
  on('env.get', () => ({ value: '/cfg' }))
  on('fs.read', (_: unknown, e: { path: string }) => {
    // エンジンは絶対パスにして渡す（Windows ではドライブが付く）ので、ドライブを外して比べる
    const p = e.path.split('\\').join('/').replace(/^[A-Za-z]:/, '')
    const hit = Object.keys(files).find(k => p === k || (k.startsWith('*') && p.endsWith(k.slice(1))))
    return hit !== undefined ? { value: files[hit] } : { deny: 'no file' }
  })
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    written[e.path.split('\\').join('/')] = e.text
    return { value: undefined }
  })
  on('ui.toast', (_: unknown, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return { written, toasts }
}

const OPEN = (refs?: string[]) => ({
  relation: 'Open',
  ops: [{ op: 'open', id: 'Q0', question: '試す', ...(refs ? { refs } : {}), intent: { quote: ['試して'], reading: '参照を確かめる' } }],
})

test('定義ファイルを作業フォルダから上へたどって見つけ、定義に合わない参照を突き返す', async ($, on) => {
  const { written } = engine(on as any, '/up/repo/sub', { '/up/.claude/discourse-state.json': DEFS_TEXT })
  const bad = JSON.stringify(await $.tool.call({ tool: TOOL, ...OPEN(['PROJ-1']) } as any))
  expect(bad).toContain('参照 \\"PROJ-1\\" はこのプロジェクトの参照の形に合わない')
  expect(Object.keys(written).some(p => p.endsWith('/board.json'))).toBe(false)
  await $.tool.call({ tool: TOOL, ...OPEN(['#3']) } as any)
  const b = JSON.parse(written[Object.keys(written).find(p => p.endsWith('/board.json'))!]!)
  expect(b.tasks[0].refs).toEqual([{ ref: '#3', name: 'Issue', url: 'https://github.com/owner/repo/issues/3' }])
  expect(b.unregistered).toEqual([])
})

test('壊れた定義ファイルは定義なしとして動き、トーストと board_update の結果で一度だけ知らせる', async ($, on) => {
  const { toasts } = engine(on as any, '/broken/repo', { '/broken/repo/.claude/discourse-state.json': '{' })
  const first = JSON.stringify(await $.tool.call({ tool: TOOL, ...OPEN(['なんでも']) } as any))
  expect(first).toContain('ボードを更新した')
  expect(first).toContain('参照の定義 /broken/repo/.claude/discourse-state.json を読めなかった')
  expect(first).toContain('定義なしとして動いている')
  const second = JSON.stringify(await $.tool.call({ tool: TOOL, ...OPEN(['なんでも']) } as any))
  expect(second).not.toContain('参照の定義')
  expect(toasts.filter(t => t.includes('参照の定義')).length).toBe(1)
})

test('ターンの頭に、未登録の作業を Claude に知らせる（管理の単位の定義があるときだけ）', async ($, on) => {
  const jsonl = REFS_DIFFS.map(d => JSON.stringify(d)).join('\n') + '\n'
  const files: Record<string, string> = { '*diffs.jsonl': jsonl }
  engine(on as any, '/turn/repo', files)
  on('prompt.submit', (_: unknown, e: { text: string; context?: readonly string[] }) => ({ text: e.text, context: e.context }))
  const without = await $.prompt.submit({ text: '次' } as any)
  expect(JSON.stringify(without)).not.toContain('未登録の作業')
  files['/turn/repo/.claude/discourse-state.json'] = DEFS_TEXT
  const r = (await $.prompt.submit({ text: '次' } as any)) as { context?: string[] }
  expect(r.context).toContain('意図ボード：未登録の作業：Q2 設定画面を作る。管理すべき作業なら登録して ref で参照を付ける。その場で終わる問いなら local を付ける。')
})

test('案内：定義があれば参照の種類と、登録して参照を付けること・その場で終わる問いの印を足す', async ($, on) => {
  engine(on as any, '/guide/repo', { '/guide/repo/.claude/discourse-state.json': DEFS_TEXT })
  on('prompt.compose', () => ({ sections: [] }))
  const { sections: secs } = await $.prompt.compose({
    model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [],
  })
  const text = secs.find(s => s.id === 'discourse-state:guide')!.text
  expect(text).toContain('- Issue：形 ^#\\d+$（管理の単位）')
  expect(text).toContain('- 文書：形 ^docs/.+\\.md$\n')
  expect(text).toContain('その場で終わる問いには local: true を付ける')
})

test('帯の末尾に「未登録 N」、ペインの見出しに参照と（未登録）', async ($, on) => {
  engine(on as any, '/band/repo', { '*board.json': JSON.stringify(REFS_BOARD) })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.close', () => ({ value: undefined }))
  on('command.run', () => ({ text: '' }))
  // ボードを読み込ませる
  await $.command.run({ command: 'discourse-state', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const band = await $.ui.mount({
    plugin: 'discourse-state', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} } as any,
  })
  expect(await band.find({ type: 'Text', text: /未登録 1/ })).toBeDefined()
  await band.unmount()
  const pane = await $.ui.mount({
    plugin: 'discourse-state', surface: 'terminal', component: 'Pane', requestId: 'discourse-state',
    props: { title: '意図ボード', isFocused: true, bodyColumns: 80, placement: 'dock' } as any,
  })
  expect(await pane.find({ type: 'Text', text: /#12 ログインできない不具合を直す/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /設定画面を作る（未登録）/ })).toBeDefined()
  await pane.unmount()
})

test('exportView: true のとき、view.json の見出しに refs・unregistered、band に unregistered', { options: { exportView: true } }, async ($, on) => {
  const { written } = engine(on as any, '/view/repo', { '/view/repo/.claude/discourse-state.json': DEFS_TEXT })
  await $.tool.call({
    tool: TOOL, relation: 'Open',
    ops: [{ op: 'open', id: 'Q0', question: '登録した作業', refs: ['#3'] }, { op: 'open', id: 'Q1', question: '登録していない作業' }],
  } as any)
  const v = JSON.parse(written[Object.keys(written).find(p => p.endsWith('/view.json'))!]!)
  expect(v.version).toBe(1)
  expect(v.band.unregistered).toBe(1)
  const heads = v.sections.flatMap((s: any) => s.items).filter((i: any) => i.toggle)
  expect(heads.find((i: any) => i.key === 't:Q0').refs).toEqual([{ ref: '#3', name: 'Issue', url: 'https://github.com/owner/repo/issues/3' }])
  expect(heads.find((i: any) => i.key === 't:Q1')).toMatchObject({ text: '登録していない作業（未登録）', unregistered: true })
})
