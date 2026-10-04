"""差分ログ（diffs.jsonl）から状態を作り直し、意図ボード（board.json）を書き出す。

使い方: python make_board.py <diffs.jsonl> <board.json>
差分が構造検査に落ちたら書き出さず、問題を標準エラーに出して終了コード 1。
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from discourse_state import board, read_diffs, replay  # noqa: E402


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    src, dst = argv[1], argv[2]
    try:
        state = replay(read_diffs(src), os.path.basename(src))
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 1
    tmp = dst + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(board(state), f, ensure_ascii=False, indent=2)
    os.replace(tmp, dst)  # mod が書きかけを読まないように
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
