import type { Board } from '../types'

// board.json の置き場：<一時フォルダ>/discourse-state/<セッション id>/board.json
export const boardPath = (tmp: string, sessionId: string) =>
  `${tmp.replace(/[\\/]+$/, '')}/discourse-state/${sessionId}/board.json`

// 書きかけ・壊れたファイルは null（描かない）
export const parseBoard = (text: string | undefined): Board | null => {
  if (!text) return null
  try {
    const b = JSON.parse(text)
    return b && Array.isArray(b.decided) && Array.isArray(b.supplemented) ? (b as Board) : null
  } catch {
    return null
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// 帯の1行：目的の読み・補った前提の数・開いている問いの数
export const bandLine = (b: Board, width = 60) => {
  const goal = b.goal ? clip(b.goal.reading, width) : '目的：未設定'
  return { goal, supplemented: b.supplemented.length, open: b.open.length }
}

export const who = (owner: 'user' | 'claude') => (owner === 'user' ? 'ユーザー' : 'Claude が決めて事後報告')
