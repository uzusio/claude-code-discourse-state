# discourse-state

会話の中で、Claude がユーザーの意図をどう汲み取っているかを見えるようにする仕組み。

- `poc/` — 会話の状態（開いている問い・有効なコミットメント）を差分ログから導出・検証する純粋関数とテスト（`python -m unittest test_discourse_state`）
- `mod/` — Claude Code の画面拡張（意図ボード：プロンプト上の帯＋ペイン）。未着手

設計ノートは非公開の Obsidian vault 側にある。
