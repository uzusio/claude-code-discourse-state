import type { Register } from 'claude-code'

// リンク経由のホットリロードと、描かれる面（terminal / vscode など）を確かめるための最小の帯
export const register: Register = on => {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text dimColor>意図ボード（動作テスト） 面: {e.surface}</Text>
      </Box>
    )
  })
}
