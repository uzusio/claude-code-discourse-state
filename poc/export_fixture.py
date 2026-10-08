"""Python 版の結果を mod のテスト用に書き出す（TypeScript 版と同じ結果になるかの突き合わせ用）。

使い方（poc/ で）: python export_fixture.py
出力: ../mod/discourse-state/tests/fixtures.ts
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from discourse_state import board, read_diffs, render, replay, unregistered, validate  # noqa: E402

diffs = read_diffs(os.path.join(HERE, "examples", "audit_job.jsonl"))
state = replay(diffs, "audit")
out = os.path.join(HERE, "..", "mod", "discourse-state", "tests", "fixtures.ts")
with open(out, "w", encoding="utf-8", newline="\n") as f:
    f.write("// poc/export_fixture.py が書き出す。手で編集しない\n")
    f.write(f"export const AUDIT_DIFFS = {json.dumps(diffs, ensure_ascii=False, indent=2)} as const\n\n")
    f.write(f"export const AUDIT_BOARD = {json.dumps(board(state), ensure_ascii=False, indent=2)}\n")
    # 作業ごとの意図と関係ラベルを含む例（README の画像にも使う）
    self_diffs = read_diffs(os.path.join(HERE, "examples", "self.jsonl"))
    f.write(f"\nexport const SELF_DIFFS = {json.dumps(self_diffs, ensure_ascii=False, indent=2)} as const\n\n")
    f.write(f"export const SELF_BOARD = {json.dumps(board(replay(self_diffs, 'self')), ensure_ascii=False, indent=2)}\n")
    # 作業に参照を付ける例（#19）。参照の定義あり・なしのボード、未登録の作業、参照まわりの検証の文面
    with open(os.path.join(HERE, "examples", "refs.defs.json"), encoding="utf-8") as g:
        defs = json.load(g)["refs"]
    refs_diffs = read_diffs(os.path.join(HERE, "examples", "refs.jsonl"))
    refs_state = replay(refs_diffs, "refs")

    def case(ops, with_defs):
        diff = {"turn": 5, "utterance_id": "π5", "relation": "Elaboration", "ops": ops}
        return {"diff": diff, "withDefs": with_defs, "problems": validate(refs_state, diff, defs if with_defs else None)}

    cases = [
        case([{"op": "ref", "question": "Q2", "refs": ["#20"]}], True),
        case([{"op": "ref", "question": "Q2", "refs": ["PROJ-1", "#20"]}], True),
        case([{"op": "ref", "question": "Q2", "refs": ["PROJ-1"]}], False),
        case([{"op": "ref", "question": "Q2"}], True),
        case([{"op": "ref", "question": "Q9", "local": True}], True),
        case([{"op": "ref", "question": "Q2", "refs": ["#20", "#20"], "local": "yes"}], True),
        case([{"op": "ref", "question": "Q2", "refs": ["", 3]}], True),
        case([{"op": "open", "id": "Q5", "question": "x", "refs": ["docs/x.md", "x"], "local": False}], True),
    ]
    f.write(f"\nexport const REFS_DEFS = {json.dumps(defs, ensure_ascii=False, indent=2)}\n\n")
    f.write(f"export const REFS_DIFFS = {json.dumps(refs_diffs, ensure_ascii=False, indent=2)} as const\n\n")
    f.write(f"export const REFS_BOARD = {json.dumps(board(refs_state, refdefs=defs), ensure_ascii=False, indent=2)}\n\n")
    f.write(f"export const REFS_BOARD_NO_DEFS = {json.dumps(board(refs_state), ensure_ascii=False, indent=2)}\n\n")
    f.write(f"export const REFS_UNREGISTERED = {json.dumps(unregistered(refs_state, defs), ensure_ascii=False)}\n\n")
    f.write(f"export const REFS_VALIDATION = {json.dumps(cases, ensure_ascii=False, indent=2)}\n")
print(out)
