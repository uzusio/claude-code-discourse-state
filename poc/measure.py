"""意図ボードの差分ログ（diffs.jsonl）から、Claude が補った前提（④）のうちユーザーが止めたものを数える。

Issue #9（実測：④に出た推測のうち、ユーザーが止めたものを数える）の道具。
数えるのは数だけで、会話の文面は出さない。

  python poc/measure.py [セッションのフォルダ ...] [--json]

引数なしなら Claude の設定フォルダ（環境変数 CLAUDE_CONFIG_DIR、無ければ USERPROFILE か HOME の下の .claude）の
discourse-state/*/diffs.jsonl をすべて読む。設定フォルダが決められなければ、エラーを出して終了コード 1。
壊れた行（JSON として読めない）があれば、ファイル名と行番号を出して終了コード 1（Fail Fast）。
"""
from __future__ import annotations

import glob
import json
import os
import sys
from typing import Any

KEYS = ("supplements", "confirmed", "stopped", "withdrawn", "pending", "readings", "readings_corrected")


def measure(diffs: list[dict]) -> dict:
    """差分の列から数を出す純粋関数。入力は変更しない。

    - supplements        by="claude" の add の数（補った前提）
    - confirmed          それらのうち confirm されたもの（ユーザーが認めた）
    - stopped            それらのうち、Correction の差分で retract / amend されたもの（ユーザーが止めた）
    - withdrawn          それらのうち、Correction 以外の差分で retract されたもの（Claude が自分で取り下げた）。
                         すでに stopped に数えた id は数えない
    - pending            confirm も retract もされていないもの
    - readings           意図の読みが置かれた数（open の intent に reading があるもの + intent op）
    - readings_corrected Correction の差分に入っていた intent op の数
    同じ id は 1 度しか数えない。
    """
    tracked: set[str] = set()
    confirmed: set[str] = set()
    stopped: set[str] = set()
    withdrawn: set[str] = set()
    retracted: set[str] = set()
    readings = 0
    readings_corrected = 0

    for diff in diffs:
        correction = diff.get("relation") == "Correction"
        for op in diff.get("ops") or []:
            kind = op.get("op")
            cid = op.get("id")
            if kind == "add" and op.get("by") == "claude" and cid:
                tracked.add(cid)
            elif kind == "confirm" and cid in tracked:
                confirmed.add(cid)
            elif kind == "retract" and cid in tracked:
                retracted.add(cid)
                if correction:
                    stopped.add(cid)
                else:
                    withdrawn.add(cid)
            elif kind == "amend" and cid in tracked and correction:
                stopped.add(cid)
            elif kind == "open":
                it = op.get("intent")
                if isinstance(it, dict) and it.get("reading"):
                    readings += 1
            elif kind == "intent":
                readings += 1
                if correction:
                    readings_corrected += 1

    withdrawn -= stopped
    return {
        "supplements": len(tracked),
        "confirmed": len(confirmed),
        "stopped": len(stopped),
        "withdrawn": len(withdrawn),
        "pending": len(tracked - confirmed - retracted),
        "readings": readings,
        "readings_corrected": readings_corrected,
    }


# ---------------------------------------------------------------- CLI（ファイル入出力。純粋関数ではないので末尾に隔離）

def _ratio(stopped: int, supplements: int) -> str:
    return "-" if supplements == 0 else f"{stopped / supplements:.0%}"


def _records_base(env: dict) -> str:
    """Claude の設定フォルダ。決められなければ ValueError（一時フォルダには落ちない）。"""
    if env.get("CLAUDE_CONFIG_DIR"):
        return env["CLAUDE_CONFIG_DIR"]
    home = env.get("USERPROFILE") or env.get("HOME")
    if home:
        return os.path.join(home, ".claude")
    raise ValueError("記録の置き場を決められない：CLAUDE_CONFIG_DIR・USERPROFILE・HOME のどれも無い")


def _default_files(env: dict) -> list[str]:
    base = _records_base(env)
    return sorted(glob.glob(os.path.join(base, "discourse-state", "*", "diffs.jsonl")))


def _resolve(args: list[str]) -> list[str]:
    return [a if os.path.isfile(a) else os.path.join(a, "diffs.jsonl") for a in args]


def main(argv: list[str] | None = None, env: dict | None = None, out=None, err=None) -> int:
    out = out or sys.stdout
    err = err or sys.stderr
    env = os.environ if env is None else env
    args = list(sys.argv[1:] if argv is None else argv)
    as_json = "--json" in args
    args = [a for a in args if a != "--json"]
    try:
        files = _resolve(args) if args else _default_files(env)
    except ValueError as e:
        print(str(e), file=err)
        return 1
    files = [f for f in files if os.path.isfile(f)]
    if not files:
        print("記録が無い", file=out)
        return 0

    failed = False
    rows: list[tuple[str, dict]] = []
    for path in files:
        diffs: list[dict] = []
        with open(path, encoding="utf-8") as f:
            for n, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    diffs.append(json.loads(line))
                except json.JSONDecodeError:
                    print(f"{path}:{n}: JSON として読めない", file=err)
                    failed = True
        session = os.path.basename(os.path.dirname(os.path.abspath(path)))[:8]
        rows.append((session, measure(diffs)))
    if failed:
        return 1

    total = {k: sum(r[k] for _, r in rows) for k in KEYS}
    ratio = _ratio(total["stopped"], total["supplements"])
    if as_json:
        json.dump({"sessions": [{"session": s, **r} for s, r in rows], "total": total, "stopped_ratio": ratio},
                  out, ensure_ascii=False, indent=2)
        print(file=out)
        return 0

    def line(label: str, r: dict) -> str:
        return (f"{label}  補った前提 {r['supplements']}  認めた {r['confirmed']}  止めた {r['stopped']}"
                f"  自分で取り下げ {r['withdrawn']}  未決 {r['pending']}"
                f"  読み {r['readings']}  読みの訂正 {r['readings_corrected']}")

    for s, r in rows:
        print(line(s, r), file=out)
    print(line("合計", total) + f"  止めた/補った {ratio}", file=out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
