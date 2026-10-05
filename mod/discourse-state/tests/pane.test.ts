import { expect, test } from 'claude-code/testing'

import { SELF_BOARD } from './fixtures'

test('帯の「ボードを開く」は押すとペインを開き、もう一度押すと閉じる', async ($, on) => {
  const calls: string[] = []
  on('session.id', () => ({ value: 'test' }))
  on('env.get', () => ({ value: '/cfg' }))
  const reads: string[] = []
  on('fs.read', (_, e) => {
    reads.push(e.path)
    return /[\\/]board\.json$/.test(e.path) ?{ value: JSON.stringify(SELF_BOARD) } : { deny: 'no file' }
  })
  on('ui.render', () => {
    throw new Error(`帯がボードを描かなかった。読んだもの: ${reads.join(', ')}`)
  })
  on('fs.write', () => ({ value: undefined }))
  on('ui.open', () => {
    calls.push('open')
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', () => {
    calls.push('close')
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('command.run', () => ({ text: '' }))
  // ボードを読み込ませる（/discourse-state は開くので、いったん閉じる）
  await $.command.run({ command: 'discourse-state', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  for (const surface of ['terminal', 'vscode'] as const) {
    calls.length = 0
    const ui = await $.ui.mount({
      plugin: 'discourse-state', surface, component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} },
    })
    await ui.press({ key: 'open' })
    await ui.press({ key: 'open' })
    await ui.unmount()
    // 開いた状態から始まれば 閉じる→開く、閉じた状態からなら 開く→閉じる
    expect(calls.length).toBe(2)
    expect(new Set(calls)).toEqual(new Set(['open', 'close']))
  }
})

// /discourse-state で開いたとき、エンジンがペインを置けたか（幅が足りるか）で知らせ方が変わる
const cases = [
  { name: 'ペインを置けないとき（端末が狭いなど）は、理由をトーストで出す', placed: { isPlaced: false as const, reason: 'narrow: 80 columns' }, toasts: ['意図ボードをまだ表示できない：narrow: 80 columns'] },
  { name: 'ペインを置けたときは、トーストを出さない', placed: { isPlaced: true as const }, toasts: [] },
]

for (const c of cases) {
  test(c.name, async ($, on) => {
    // エンジンの代わり
    const toasts: string[] = []
    on('session.id', () => ({ value: 'test' }))
    on('env.get', () => ({ value: '/cfg' }))
    on('fs.read', () => ({ deny: 'no file' }))
    on('fs.write', () => ({ value: undefined }))
    on('ui.open', () => ({ value: c.placed }))
    on('ui.close', () => ({ value: undefined }))
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('command.run', () => ({ text: '' }))
    await $.command.run({ command: 'discourse-state', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
    expect(toasts).toEqual(c.toasts)
  })
}
