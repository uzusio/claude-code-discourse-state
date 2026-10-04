// poc/discourse_state.py の board() が書き出す形
export type BoardItem = { id: string; content: string; source: string | null; reason?: string }
export type Replaced = { id: string; content: string; turn: number; source: string | null; replaced_by: string | null }
export type Step = { text: string; from: string[] }
export type OpenQuestion = { id: string; question: string; owner: 'user' | 'claude'; parent: string | null }
export type Board = {
  turn: number
  goal: { quote: string[]; reading: string; source: string | null } | null
  decided: BoardItem[]
  replaced: Replaced[]
  supplemented: BoardItem[]
  steps: Step[]
  open: OpenQuestion[]
}
// changed：直前のターンの終わりで、ボードの中身が変わったか
export type Seen = { board: Board | null; changed: boolean; note: string | null }

declare module 'claude-code' {
  interface PluginState {
    'intent-board': { seen: Seen; opened: boolean }
  }
}
