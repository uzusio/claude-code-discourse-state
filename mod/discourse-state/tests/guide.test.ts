import { expect, test } from 'claude-code/testing'

import { GUIDE_SECTION } from '../hooks/register'

test('システムプロンプトの最後に、意図ボードの案内（いつ board_update を呼ぶか）が入る', async ($, on) => {
  // エンジンが組み立てる分の代わり
  on('prompt.compose', () => ({ sections: [{ id: 'engine', text: 'engine', scope: 'shared' as const }] }))
  const { sections } = await $.prompt.compose({
    model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [],
  })
  expect(sections.map(s => s.id)).toEqual(['engine', 'discourse-state:guide'])
  const guide = sections[1]!
  expect(guide.scope).toBe('session')
  expect(guide.text).toBe(GUIDE_SECTION.text)
  expect(guide.text).toContain('mcp__discourse-state__board_update')
})
