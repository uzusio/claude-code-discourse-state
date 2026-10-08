// poc/discourse_state.py の board() が書き出す形
export type BoardItem = { id: string; content: string; source: string | null; turn: number; reason?: string }
export type Replaced = { id: string; content: string; turn: number; source: string | null; replaced_by: string | null }
export type Step = { text: string; from: string[]; why?: string }
export type OpenQuestion = { id: string; question: string; owner: 'user' | 'claude'; parent: string | null }
export type TreeNode = { id: string; question: string; owner: 'user' | 'claude'; closed: boolean; parent: string | null; items: string[] }
export type Board = {
  turn: number
  goal: { quote: string[]; reading: string; source: string | null } | null
  decided: BoardItem[]
  replaced: Replaced[]
  supplemented: BoardItem[]
  steps: Step[]
  open: OpenQuestion[]
  tree: { nodes: TreeNode[]; loose: string[] }
  tasks: Task[]
  unregistered?: string[]  // 未登録の作業の id（#19）。古い board.json には無い
}
// 作業の参照。name・url は参照の定義に合ったときだけ
export type TaskRef = { ref: string; name?: string; url?: string }
// 作業の木（board.tasks）。rel は親との線：answer＝作業への答え、ほかは決まったこと同士
export type TaskItem = {
  id: string; content: string; by: 'user' | 'claude'; turn: number; parent: string | null
  rel: 'answer' | 'elaboration' | 'explanation' | 'contrast' | 'result' | 'condition'
  reason?: string; replaces?: string
}
export type Task = {
  id: string; question: string; owner: 'user' | 'claude'; closed: boolean; parent: string | null
  intent: { quote: string[]; reading: string; source: string | null } | null
  intent_history: { quote: string[]; reading: string; source: string | null }[]
  steps: Step[]
  items: TaskItem[]
  refs?: TaskRef[]  // プロジェクトの管理の単位（Issue など）への参照。古い board.json には無い
  local?: boolean   // その場で終わる問いの印
}
// changed：直前のターンの終わりで、ボードの中身が変わったか
// audit：直近のターンの監査役の指摘（ボードは書き換えない）
export type Flag = { kind: 'attribution' | 'deviation' | 'relevance' | 'unclosed'; text: string }
export type Seen = { board: Board | null; changed: boolean; note: string | null; audit: Flag[] }

declare module 'claude-code' {
  interface PluginState {
    'discourse-state': { seen: Seen; opened: boolean; expanded: string[] }
  }
}
