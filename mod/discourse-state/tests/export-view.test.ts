import { expect, test } from 'claude-code/testing'

import { SELF_DIFFS } from './fixtures'

const TOOL = 'mcp__discourse-state__board_update'
const OPEN = {
  relation: 'Open',
  ops: [{ op: 'open', id: 'Q0', question: '試す', intent: { quote: ['試して'], reading: 'view.json の書き出しを確かめる' } }],
}

// エンジンの代わり。書かれたファイルを path → 中身で集める
function engine(on: (event: any, hook: any) => void, diffsText?: string) {
  const written: Record<string, string> = {}
  on('session.id', () => ({ value: 'test' }))
  on('session.cwd', () => ({ value: '/work/x' }))
  on('session.turns', () => ({ value: 3 }))
  on('env.get', () => ({ value: '/cfg' }))
  on('fs.read', (_: unknown, e: { path: string }) => (diffsText !== undefined && /diffs\.jsonl$/.test(e.path) ? { value: diffsText } : { deny: 'no file' }))
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    written[e.path.split('\\').join('/')] = e.text
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  return written
}

const viewPath = (written: Record<string, string>) => Object.keys(written).find(p => p.endsWith('/view.json'))

test('exportView を指定しない（既定）とき、board_update を呼んでも view.json を書かない', async ($, on) => {
  const written = engine(on as any)
  const r = await $.tool.call({ tool: TOOL, ...OPEN } as any)
  expect(Object.keys(written).some(p => p.endsWith('/board.json'))).toBe(true)
  expect(viewPath(written)).toBeUndefined()
  // 結果の文面にも view.json は出ない
  expect(JSON.stringify(r)).not.toContain('view.json を書けなかった')
})

test('exportView: true のとき、board_update を呼ぶと view.json を書く（version 1・session・cwd・band）', { options: { exportView: true } }, async ($, on) => {
  const written = engine(on as any)
  await $.tool.call({ tool: TOOL, ...OPEN } as any)
  const p = viewPath(written)
  expect(p).toBeDefined()
  const v = JSON.parse(written[p!]!)
  expect(v.version).toBe(1)
  expect(v.session).toBe('test')
  expect(v.cwd).toBe('/work/x')
  expect(v.turn).toBe(3)
  expect(v.band.note).toBeNull()
  expect(typeof v.band.goal).toBe('string')
})

// ボードを更新しなかったターンの経路（turn.complete）
for (const enabled of [true, false]) {
  test(`作業をしたのにボードを更新しなかったターン：exportView が ${enabled} のとき view.json を${enabled ? '書き、note が「ボード未更新」になる' : '書かない'}`, { options: { exportView: enabled } }, async ($, on) => {
    const written = engine(on as any, SELF_DIFFS.map(d => JSON.stringify(d)).join('\n') + '\n')
    on('tool.call', () => ({ result: 'ok' }))
    on('turn.complete', () => ({ text: '' }))
    on('model.complete', () => ({ deny: 'no model' }) as any)
    // 作業（ボード更新以外のツール）をしたターン
    await $.tool.call({ tool: 'Read', file_path: '/x' } as any)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as any)
    const p = viewPath(written)
    if (enabled) {
      expect(p).toBeDefined()
      expect(JSON.parse(written[p!]!).band.note).toBe('ボード未更新')
    } else {
      expect(p).toBeUndefined()
    }
  })
}
