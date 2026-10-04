"""discourse-state PoC: 状態の更新・導出を行う純粋関数群。

状態（state）と差分（diff）を受け取り、新しい状態を返す。副作用なし。入力は変更しない。
LLM が書くのは diff だけ。state を書くのはこのモジュールを呼ぶ hook だけ。
設計: notes/開発ノート/discourse-state/discourse-state PoC 進め方 2026-09-22.md §2

state（JSON）:
  {"session": str, "turn": int,
   "questions":   [{"id": "Q0", "question": str, "opened_by": "π1", "answers": ["C2", ...]}, ...],  # 末尾が最上位
   "commitments": [{"id": "C2", "content": str, "source": "π2", "depends_on": ["C1", ...]}, ...],
   "counters": {"C": 3, "Q": 0}}                                                                     # 採番用

diff（JSON、1発言単位。LLM が diffs.jsonl に1行で追記する）:
  {"turn": 3, "utterance_id": "π3", "text": str,
   "relation": "Correction", "target": "C1", "markers": ["でも", "やっぱ"],
   "ops": [{"op": "retract", "id": "C1"},
           {"op": "add", "id": "C3", "content": "Aを含める", "depends_on": []},
           {"op": "recheck", "id": "C2", "note": "維持。意味は B に加えて A"},
           {"op": "answer", "question": "Q0", "by": "C3", "complete": false}]}

ops の種類:
  add      コミットメントを足す           (id, content, depends_on?)
  retract  コミットメントを消す           (id)          ← 依存しているものは recheck か retract が必須
  amend    コミットメントの内容を書き直す (id, content)  ← Elaboration 用。content は書き直し後の全文
  recheck  依存先が消えたものを見直した、という宣言。状態は変えない (id, note?)
  open     問いを積む                     (id, question)
  answer   問いに答える                   (question, by?, complete?)  ← complete なら問いを降ろす
  none     何もしない                     （Acknowledge 用）
"""
from __future__ import annotations

import copy
import json
import re
from typing import Any, Iterable

RELATIONS = frozenset(
    {"Correction", "Elaboration", "Continuation", "Result", "Condition", "Answer", "Open", "Acknowledge"}
)
OPS = frozenset({"add", "retract", "amend", "recheck", "open", "answer", "none"})

_ID_RE = re.compile(r"^([CQ])(\d+)$")


# ---------------------------------------------------------------- 基本

def empty_state(session: str) -> dict:
    return {"session": session, "turn": 0, "questions": [], "commitments": [], "counters": {"C": -1, "Q": -1}}


def _find(items: list[dict], id_: str) -> dict | None:
    for it in items:
        if it.get("id") == id_:
            return it
    return None


def dependents(state: dict, cid: str) -> list[str]:
    """cid に直接依存しているコミットメントの id。"""
    return [c["id"] for c in state["commitments"] if cid in c.get("depends_on", [])]


def next_ids(state: dict) -> dict[str, str]:
    c = state.get("counters", {})
    return {"C": f"C{c.get('C', -1) + 1}", "Q": f"Q{c.get('Q', -1) + 1}"}


def _bump(counters: dict, id_: str) -> None:
    m = _ID_RE.match(id_)
    if m:
        kind, n = m.group(1), int(m.group(2))
        counters[kind] = max(counters.get(kind, -1), n)


# ---------------------------------------------------------------- validate

def validate(state: dict, diff: dict) -> list[str]:
    """diff が state に対して成立するか。問題の一覧を返す（空なら合格）。

    ここで見るのは構造だけ。「その差分が発言の正しい読みか」は見ない（それは Jev の仕事）。
    """
    problems: list[str] = []
    rel = diff.get("relation")
    if rel not in RELATIONS:
        problems.append(f"relation が不正: {rel!r}")

    ops = diff.get("ops")
    if not isinstance(ops, list):
        return problems + ["ops がリストでない"]

    cids = {c["id"] for c in state["commitments"]}
    qids = {q["id"] for q in state["questions"]}
    added: set[str] = set()
    opened: set[str] = set()
    retracted: list[str] = []
    rechecked: set[str] = set()

    for i, op in enumerate(ops):
        kind = op.get("op")
        where = f"ops[{i}]"
        if kind not in OPS:
            problems.append(f"{where}: op が不正: {kind!r}")
            continue
        if kind == "add":
            cid, content = op.get("id"), op.get("content")
            if not cid or not content:
                problems.append(f"{where}: add には id と content が要る")
                continue
            if cid in cids or cid in added:
                problems.append(f"{where}: {cid} は既にある")
            elif not _ID_RE.match(cid) or cid[0] != "C":
                problems.append(f"{where}: コミットメントの id は C+数字: {cid!r}")
            else:
                added.add(cid)
            for d in op.get("depends_on", []) or []:
                if d not in cids and d not in added:
                    problems.append(f"{where}: 依存先 {d} が存在しない")
        elif kind in ("retract", "amend", "recheck"):
            cid = op.get("id")
            if cid not in cids:
                problems.append(f"{where}: {kind} の対象 {cid!r} が存在しない")
                continue
            if kind == "retract":
                retracted.append(cid)
            elif kind == "recheck":
                rechecked.add(cid)
            elif not op.get("content"):
                problems.append(f"{where}: amend には content（書き直し後の全文）が要る")
        elif kind == "open":
            qid, q = op.get("id"), op.get("question")
            if not qid or not q:
                problems.append(f"{where}: open には id と question が要る")
                continue
            if qid in qids or qid in opened:
                problems.append(f"{where}: {qid} は既にある")
            elif not _ID_RE.match(qid) or qid[0] != "Q":
                problems.append(f"{where}: 問いの id は Q+数字: {qid!r}")
            else:
                opened.add(qid)
        elif kind == "answer":
            qid, by = op.get("question"), op.get("by")
            if qid not in qids and qid not in opened:
                problems.append(f"{where}: answer の対象 {qid!r} が存在しない")
            if by and by not in cids and by not in added:
                problems.append(f"{where}: answer の by {by!r} が存在しない")

    # 取り消したものに依存していたコミットメントは、見直すか一緒に消すかのどちらか
    for cid in retracted:
        for d in dependents(state, cid):
            if d not in rechecked and d not in retracted:
                problems.append(f"{d} は {cid} に依存しているが recheck も retract もされていない")

    # 関係ラベルと ops の整合（緩い検査）
    kinds = [op.get("op") for op in ops]
    if rel == "Correction" and not any(k in ("retract", "amend") for k in kinds):
        problems.append("Correction なのに retract / amend が無い")
    if rel == "Acknowledge" and any(k != "none" for k in kinds):
        problems.append("Acknowledge なのに状態を変える op がある")
    if rel == "Open" and "open" not in kinds:
        problems.append("Open なのに open が無い")
    if rel == "Answer" and "answer" not in kinds:
        problems.append("Answer なのに answer が無い")
    return problems


# ---------------------------------------------------------------- apply / replay

def apply(state: dict, diff: dict) -> dict:
    """diff を適用した新しい state を返す。state は変更しない。validate 済みを前提。"""
    new = copy.deepcopy(state)
    new.setdefault("counters", {"C": -1, "Q": -1})
    new["turn"] = int(diff.get("turn", new.get("turn", 0) + 1))
    src = diff.get("utterance_id")

    for op in diff.get("ops", []):
        kind = op["op"]
        if kind == "add":
            new["commitments"].append(
                {"id": op["id"], "content": op["content"], "source": src, "depends_on": list(op.get("depends_on", []) or [])}
            )
            _bump(new["counters"], op["id"])
        elif kind == "retract":
            gone = op["id"]
            new["commitments"] = [c for c in new["commitments"] if c["id"] != gone]
            for c in new["commitments"]:
                c["depends_on"] = [d for d in c.get("depends_on", []) if d != gone]
            for q in new["questions"]:
                q["answers"] = [a for a in q.get("answers", []) if a != gone]
        elif kind == "amend":
            c = _find(new["commitments"], op["id"])
            if c is not None:
                c["content"] = op["content"]
        elif kind == "recheck":
            pass  # 宣言だけ。意味を変えるなら amend を使う
        elif kind == "open":
            new["questions"].append({"id": op["id"], "question": op["question"], "opened_by": src, "answers": []})
            _bump(new["counters"], op["id"])
        elif kind == "answer":
            q = _find(new["questions"], op["question"])
            if q is None:
                continue
            by = op.get("by")
            if by and by not in q["answers"]:
                q["answers"].append(by)
            if op.get("complete"):
                new["questions"] = [x for x in new["questions"] if x["id"] != q["id"]]
        elif kind == "none":
            pass
    return new


def replay(diffs: Iterable[dict], session: str, strict: bool = True) -> dict:
    """差分ログから状態を作り直す。strict なら validate に落ちた時点で ValueError。"""
    state = empty_state(session)
    for n, diff in enumerate(diffs):
        if strict:
            problems = validate(state, diff)
            if problems:
                raise ValueError(f"diff #{n} ({diff.get('utterance_id')}): " + "; ".join(problems))
        state = apply(state, diff)
    return state


# ---------------------------------------------------------------- render

def render(state: dict) -> str:
    """LLM に渡す文面。ここに無い決定・問いは存在しない、と読ませる。"""
    lines = ["## 現在の状態（コードが差分ログから導出。ここに無い決定・問いは存在しない）"]
    lines.append("### 開いている問い（上が最上位）")
    if state["questions"]:
        for q in reversed(state["questions"]):
            ans = f"  回答: {', '.join(q['answers'])}" if q.get("answers") else "  回答: なし"
            lines.append(f"- {q['id']}: {q['question']}{ans}")
    else:
        lines.append("- なし")
    lines.append("### 有効なコミットメント")
    if state["commitments"]:
        for c in state["commitments"]:
            dep = f"  依存: {', '.join(c['depends_on'])}" if c.get("depends_on") else ""
            lines.append(f"- {c['id']}: {c['content']}  ← {c.get('source', '?')}{dep}")
    else:
        lines.append("- なし")
    nx = next_ids(state)
    lines.append(f"次の ID: {nx['C']} / {nx['Q']}")
    return "\n".join(lines)


# ---------------------------------------------------------------- ファイル入出力（薄い。純粋関数ではないので末尾に隔離）

def read_diffs(path: str) -> list[dict]:
    diffs: list[dict] = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                diffs.append(json.loads(line))
    return diffs


def write_state(path: str, state: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def read_state(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)
