import type { Register } from 'claude-code'

// リンク経由のホットリロードと、描かれる面（terminal / vscode など）を確かめるための最小の帯
const VERSION = 'v2'
const PROBE = '<scratchpad>/intent-board-probe.txt'

export const register: Register = on => {
  let probed = false

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    if (!probed) {
      probed = true
      await $.fs.write(PROBE, `${VERSION} ${e.surface} ${new Date().toISOString()}\n`)
    }

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text dimColor>意図ボード（動作テスト {VERSION}） 面: {e.surface}</Text>
      </Box>
    )
  })
}
