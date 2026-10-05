"""Python 版の結果を mod のテスト用に書き出す（TypeScript 版と同じ結果になるかの突き合わせ用）。

使い方（poc/ で）: python export_fixture.py
出力: ../mod/discourse-state/tests/fixtures.ts
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from discourse_state import board, read_diffs, render, replay  # noqa: E402

diffs = read_diffs(os.path.join(HERE, "examples", "audit_job.jsonl"))
state = replay(diffs, "audit")
out = os.path.join(HERE, "..", "mod", "discourse-state", "tests", "fixtures.ts")
with open(out, "w", encoding="utf-8", newline="\n") as f:
    f.write("// poc/export_fixture.py が書き出す。手で編集しない\n")
    f.write(f"export const AUDIT_DIFFS = {json.dumps(diffs, ensure_ascii=False, indent=2)} as const\n\n")
    f.write(f"export const AUDIT_BOARD = {json.dumps(board(state), ensure_ascii=False, indent=2)}\n")
print(out)
