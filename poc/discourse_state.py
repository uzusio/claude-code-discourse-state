"""discourse-state PoC: 状態の更新・導出を行う純粋関数群。

状態（state）と差分（diff）を受け取り、新しい状態を返す。副作用なし。入力は変更しない。
LLM が書くのは diff だけ。state を書くのはこのモジュールを呼ぶ hook だけ。
意図ボード（6項目）は state の見え方として board() で導出する。ボード用の別の状態は持たない。

state（JSON）:
  {"session": str, "turn": int,
   "goal":        {"quote": [str, ...], "reading": str, "source": "π1"} | None,       # 問いの木の根（ボード①）
   "questions":   [{"id": "Q0", "question": str, "opened_by": "π1", "answers": ["C2", ...],
                    "parent": "Q0" | None, "owner": "user" | "claude", "closed": bool}, ...],  # 末尾が最上位（⑥）
                                                                                     # 片付いた問いも消さずに残す（QUD の木）
   "commitments": [{"id": "C2", "content": str, "source": "π2", "depends_on": ["C1", ...],
                    "by": "user" | "claude", "reason": str?, "turn": int}, ...],      # by=user が②、by=claude が④
   "retracted":   [{"id": "C1", "content": str, "turn": 3, "source": "π3", "replaced_by": "C3" | None}, ...],  # ③
   "steps":       [{"text": str, "from": ["goal", "C2", ...]}, ...],                  # ⑤ 意図→いまの手順
   "counters": {"C": 3, "Q": 0}}                                                     # 採番用

diff（JSON、1発言単位。LLM が diffs.jsonl に1行で追記する）:
  {"turn": 3, "utterance_id": "π3", "text": str,
   "relation": "Correction", "target": "C1", "markers": ["でも", "やっぱ"],
   "ops": [{"op": "retract", "id": "C1", "replaced_by": "C3"},
           {"op": "add", "id": "C3", "content": "Aを含める", "depends_on": []},
           {"op": "recheck", "id": "C2", "note": "維持。意味は B に加えて A"},
           {"op": "answer", "question": "Q0", "by": "C3", "complete": false}]}

ops の種類:
  add      コミットメントを足す           (id, content, depends_on?, by?, reason?)
                                          by="claude" は相手が言っていない前提を補ったもの（accommodation）。reason 必須
  confirm  補った前提をユーザーが認めた   (id)          ← by を claude から user に移す（④→②）
  retract  コミットメントを消す           (id, replaced_by?)  ← 依存しているものは recheck か retract が必須
  amend    コミットメントの内容を書き直す (id, content)  ← Elaboration 用。content は書き直し後の全文
  recheck  依存先が消えたものを見直した、という宣言。状態は変えない (id, note?)
  open     問いを積む                     (id, question, parent?, owner?)  ← owner は決める人（既定 user）
  answer   問いに答える                   (question, by?, complete?)  ← complete なら問いを閉じる（消さない）
  goal     目的を置く・置き換える         (quote, reading)  ← quote はユーザーの言葉の引用、reading はその読み
  plan     手順を置き換える               (steps: [{text, from}])  ← from は "goal" かコミットメントの id
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
OPS = frozenset({"add", "confirm", "retract", "amend", "recheck", "open", "answer", "goal", "plan", "none"})
BY = frozenset({"user", "claude"})

_ID_RE = re.compile(r"^([CQ])(\d+)$")


# ---------------------------------------------------------------- 基本

def empty_state(session: str) -> dict:
    return {"session": session, "turn": 0, "goal": None, "questions": [], "commitments": [],
            "retracted": [], "steps": [], "counters": {"C": -1, "Q": -1}}


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

    ここで見るのは構造だけ。「その差分が発言の正しい読みか」は見ない（それは判定機の仕事）。
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
    added: set[str] = {o.get("id") for o in ops if o.get("op") == "add" and o.get("id")}
    seen_added: set[str] = set()
    opened: set[str] = set()
    retracted: list[str] = []
    rechecked: set[str] = set()
    has_goal = state.get("goal") is not None or any(o.get("op") == "goal" for o in ops)

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
            if cid in cids or cid in seen_added:
                problems.append(f"{where}: {cid} は既にある")
            elif not _ID_RE.match(cid) or cid[0] != "C":
                problems.append(f"{where}: コミットメントの id は C+数字: {cid!r}")
            else:
                seen_added.add(cid)
            for d in op.get("depends_on", []) or []:
                if d not in cids and d not in seen_added:
                    problems.append(f"{where}: 依存先 {d} が存在しない")
            by = op.get("by", "user")
            if by not in BY:
                problems.append(f"{where}: by は user か claude: {by!r}")
            elif by == "claude" and not op.get("reason"):
                problems.append(f"{where}: 補った前提（by=claude）には reason が要る")
        elif kind == "confirm":
            c = _find(state["commitments"], op.get("id"))
            if c is None:
                problems.append(f"{where}: confirm の対象 {op.get('id')!r} が存在しない")
            elif c.get("by", "user") != "claude":
                problems.append(f"{where}: {c['id']} は補った前提ではない")
        elif kind in ("retract", "amend", "recheck"):
            cid = op.get("id")
            if cid not in cids:
                problems.append(f"{where}: {kind} の対象 {cid!r} が存在しない")
                continue
            if kind == "retract":
                retracted.append(cid)
                rb = op.get("replaced_by")
                if rb and rb not in cids and rb not in added:
                    problems.append(f"{where}: replaced_by {rb!r} が存在しない")
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
            parent = op.get("parent")
            if parent and parent not in qids and parent not in opened:
                problems.append(f"{where}: 親の問い {parent!r} が存在しない")
            if op.get("owner", "user") not in BY:
                problems.append(f"{where}: owner は user か claude: {op.get('owner')!r}")
        elif kind == "answer":
            qid, by = op.get("question"), op.get("by")
            if qid not in qids and qid not in opened:
                problems.append(f"{where}: answer の対象 {qid!r} が存在しない")
            if by and by not in cids and by not in seen_added:
                problems.append(f"{where}: answer の by {by!r} が存在しない")
        elif kind == "goal":
            if not op.get("quote") or not op.get("reading"):
                problems.append(f"{where}: goal には quote（引用）と reading（読み）が要る")
        elif kind == "plan":
            steps = op.get("steps")
            if not isinstance(steps, list) or not steps:
                problems.append(f"{where}: plan には steps が要る")
                continue
            for j, st in enumerate(steps):
                if not st.get("text"):
                    problems.append(f"{where}.steps[{j}]: text が要る")
                srcs = st.get("from") or []
                if not srcs:
                    problems.append(f"{where}.steps[{j}]: from（どの意図から出た手順か）が要る")
                for f in srcs:
                    if f == "goal":
                        if not has_goal:
                            problems.append(f"{where}.steps[{j}]: 目的がまだ置かれていない")
                    elif f not in cids and f not in added:
                        problems.append(f"{where}.steps[{j}]: from {f!r} が存在しない")
                    elif f in retracted:
                        problems.append(f"{where}.steps[{j}]: from {f!r} は取り消されている")

    # 取り消したものに依存していたコミットメントは、見直すか一緒に消すかのどちらか
    for cid in retracted:
        for d in dependents(state, cid):
            if d not in rechecked and d not in retracted:
                problems.append(f"{d} は {cid} に依存しているが recheck も retract もされていない")

    # 関係ラベルと ops の整合（緩い検査）
    kinds = [op.get("op") for op in ops]
    if rel == "Correction" and not any(k in ("retract", "amend") for k in kinds):
        problems.append("Correction なのに retract / amend が無い")
    if rel == "Acknowledge" and any(k not in ("none", "confirm") for k in kinds):
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
    for k, v in (("goal", None), ("retracted", []), ("steps", [])):
        new.setdefault(k, v)
    new["turn"] = int(diff.get("turn", new.get("turn", 0) + 1))
    src = diff.get("utterance_id")

    for op in diff.get("ops", []):
        kind = op["op"]
        if kind == "add":
            c = {"id": op["id"], "content": op["content"], "source": src,
                 "depends_on": list(op.get("depends_on", []) or []), "by": op.get("by", "user"),
                 "turn": new["turn"]}
            if c["by"] == "claude":
                c["reason"] = op["reason"]
            new["commitments"].append(c)
            _bump(new["counters"], op["id"])
        elif kind == "confirm":
            c = _find(new["commitments"], op["id"])
            if c is not None:
                c["by"] = "user"
                c["confirmed_by"] = src
        elif kind == "retract":
            gone = op["id"]
            old = _find(new["commitments"], gone)
            if old is not None:
                new["retracted"].append({"id": gone, "content": old["content"], "turn": new["turn"],
                                         "source": src, "replaced_by": op.get("replaced_by")})
            new["commitments"] = [c for c in new["commitments"] if c["id"] != gone]
            for c in new["commitments"]:
                c["depends_on"] = [d for d in c.get("depends_on", []) if d != gone]
            for q in new["questions"]:
                q["answers"] = [a for a in q.get("answers", []) if a != gone]
            for st in new["steps"]:
                st["from"] = [f for f in st["from"] if f != gone]
        elif kind == "amend":
            c = _find(new["commitments"], op["id"])
            if c is not None:
                c["content"] = op["content"]
        elif kind == "recheck":
            pass  # 宣言だけ。意味を変えるなら amend を使う
        elif kind == "open":
            new["questions"].append({"id": op["id"], "question": op["question"], "opened_by": src, "answers": [],
                                     "parent": op.get("parent"), "owner": op.get("owner", "user"), "closed": False})
            _bump(new["counters"], op["id"])
        elif kind == "answer":
            q = _find(new["questions"], op["question"])
            if q is None:
                continue
            by = op.get("by")
            if by and by not in q["answers"]:
                q["answers"].append(by)
            if op.get("complete"):
                q["closed"] = True
        elif kind == "goal":
            new["goal"] = {"quote": list(op["quote"]), "reading": op["reading"], "source": src}
        elif kind == "plan":
            new["steps"] = [{"text": st["text"], "from": list(st["from"])} for st in op["steps"]]
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


# ---------------------------------------------------------------- render / board

def render(state: dict) -> str:
    """LLM に渡す文面。ここに無い決定・問いは存在しない、と読ませる。"""
    lines = ["## 現在の状態（コードが差分ログから導出。ここに無い決定・問いは存在しない）"]
    open_qs = [q for q in state["questions"] if not q.get("closed")]
    closed_qs = [q for q in state["questions"] if q.get("closed")]
    lines.append("### 開いている問い（上が最上位）")
    if open_qs:
        for q in reversed(open_qs):
            ans = f"  回答: {', '.join(q['answers'])}" if q.get("answers") else "  回答: なし"
            lines.append(f"- {q['id']}: {q['question']}{ans}")
    else:
        lines.append("- なし")
    if closed_qs:
        lines.append("### 片付いた問い")
        for q in closed_qs:
            lines.append(f"- {q['id']}: {q['question']}")
    lines.append("### 有効なコミットメント")
    if state["commitments"]:
        for c in state["commitments"]:
            dep = f"  依存: {', '.join(c['depends_on'])}" if c.get("depends_on") else ""
            mark = "  【補った前提】" if c.get("by") == "claude" else ""
            lines.append(f"- {c['id']}: {c['content']}  ← {c.get('source', '?')}{dep}{mark}")
    else:
        lines.append("- なし")
    nx = next_ids(state)
    lines.append(f"次の ID: {nx['C']} / {nx['Q']}")
    return "\n".join(lines)


def board(state: dict, recent: int = 3) -> dict:
    """意図ボード（6項目）を state から導出する。mod はこれを描くだけ。

    ② と ④ は同じコミットメントの by で分けるので、同じ中身が両方に載ることはない。
    """
    def item(c: dict) -> dict:
        out = {"id": c["id"], "content": c["content"], "source": c.get("source"), "turn": c.get("turn", 0)}
        if c.get("reason"):
            out["reason"] = c["reason"]
        return out

    goal = state.get("goal")
    return {
        "turn": state.get("turn", 0),
        "goal": goal,                                                                         # ①
        "decided": [item(c) for c in state["commitments"] if c.get("by", "user") == "user"],  # ②
        "replaced": list(state.get("retracted", []))[-recent:],                               # ③
        "supplemented": [item(c) for c in state["commitments"] if c.get("by") == "claude"],   # ④
        "steps": [dict(st) for st in state.get("steps", [])],                                 # ⑤
        "open": [{"id": q["id"], "question": q["question"], "owner": q.get("owner", "user"),
                  "parent": q.get("parent")} for q in reversed(state["questions"])
                 if not q.get("closed")],                                                    # ⑥
        "tree": tree(state),
    }


def tree(state: dict) -> dict:
    """目的 → 問い → 決定 の木（QUD の木）。

    決定は、答えている問いにぶら下げる。答えていない決定は、依存先がぶら下がっている問いに付ける。
    どこにも付かない決定は loose（目的の直下）。問いの並びは開いた順。
    """
    attach: dict[str, str] = {}
    for q in state["questions"]:
        for a in q.get("answers", []):
            attach.setdefault(a, q["id"])
    changed = True
    while changed:
        changed = False
        for c in state["commitments"]:
            if c["id"] in attach:
                continue
            for d in c.get("depends_on", []):
                if d in attach:
                    attach[c["id"]] = attach[d]
                    changed = True
                    break
    qids = {q["id"] for q in state["questions"]}
    nodes = [{"id": q["id"], "question": q["question"], "owner": q.get("owner", "user"),
              "closed": bool(q.get("closed")),
              "parent": q.get("parent") if q.get("parent") in qids else None,
              "items": [c["id"] for c in state["commitments"] if attach.get(c["id"]) == q["id"]]}
             for q in state["questions"]]
    loose = [c["id"] for c in state["commitments"] if c["id"] not in attach]
    return {"nodes": nodes, "loose": loose}


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
