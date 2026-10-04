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

// 表示幅（全角＝2桁）で切る
const cols = (ch: string) => (/[ -~｡-ﾟ]/.test(ch) ? 1 : 2)
export const clip = (s: string, width: number) => {
  let used = 0
  let out = ''
  for (const ch of s) {
    if (used + cols(ch) > width - 1) return `${out}…`
    used += cols(ch)
    out += ch
  }
  return out
}

// 帯：目的の読み（width 桁まで）・補った前提の数・開いている問いの数
export const bandLine = (b: Board, width = 60) => {
  const goal = b.goal ? clip(b.goal.reading, width) : '目的：未設定'
  return { goal, supplemented: b.supplemented.length, open: b.open.length }
}

export const who = (owner: 'user' | 'claude') => (owner === 'user' ? 'ユーザー' : 'Claude が決めて事後報告')
