"""discourse_state のテスト。ハンドオーバー §1 の A/B 例をそのまま使う。

実行（poc/ で）: python -m unittest test_discourse_state
"""
import copy
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from discourse_state import (  # noqa: E402
    apply, board, dependents, empty_state, next_ids, read_diffs, render, replay, validate)

# --- A/B 例の正しい読み（3発言分の差分） ---------------------------------
D1 = {
    "turn": 1, "utterance_id": "π1", "text": "いや、Aはないわ。",
    "relation": "Open", "target": None, "markers": ["いや"],
    "ops": [
        {"op": "open", "id": "Q0", "question": "公開する製品の仕様は何か"},
        {"op": "add", "id": "C1", "content": "Aを含めない"},
        {"op": "answer", "question": "Q0", "by": "C1"},
    ],
}
D2 = {
    "turn": 2, "utterance_id": "π2", "text": "Bにしよう。",
    "relation": "Result", "target": "C1", "markers": [],
    "ops": [
        {"op": "add", "id": "C2", "content": "Bを含める", "depends_on": ["C1"]},
        {"op": "answer", "question": "Q0", "by": "C2"},
    ],
}
D3_CORRECT = {
    "turn": 3, "utterance_id": "π3", "text": "ああ、でもやっぱAも入れて公開したいな。",
    "relation": "Correction", "target": "C1", "markers": ["でも", "やっぱ"],
    "ops": [
        {"op": "retract", "id": "C1"},
        {"op": "add", "id": "C3", "content": "Aを含める"},
        {"op": "recheck", "id": "C2", "note": "維持。意味は B に加えて A"},
        {"op": "answer", "question": "Q0", "by": "C3"},
    ],
}
# --- AI の誤読（構造としては成立してしまう。ここを止めるのは Jev の仕事） ---
D3_WRONG = {
    "turn": 3, "utterance_id": "π3", "text": "ああ、でもやっぱAも入れて公開したいな。",
    "relation": "Continuation", "target": "C2", "markers": [],
    "ops": [
        {"op": "add", "id": "C3", "content": "公開用には A も含める"},
        {"op": "open", "id": "Q1", "question": "個人用と公開用は別物か"},
        {"op": "answer", "question": "Q1", "by": "C3"},
    ],
}


def after_pi2():
    return replay([D1, D2], "test")


class ABExample(unittest.TestCase):
    def test_state_after_pi2(self):
        s = after_pi2()
        self.assertEqual([c["id"] for c in s["commitments"]], ["C1", "C2"])
        self.assertEqual(s["commitments"][1]["depends_on"], ["C1"])
        self.assertEqual([q["id"] for q in s["questions"]], ["Q0"])
        self.assertEqual(s["questions"][0]["answers"], ["C1", "C2"])
        self.assertEqual(next_ids(s), {"C": "C3", "Q": "Q1"})

    def test_correct_reading_of_pi3(self):
        s = apply(after_pi2(), D3_CORRECT)
        self.assertEqual([c["id"] for c in s["commitments"]], ["C2", "C3"])
        self.assertEqual({c["id"]: c["content"] for c in s["commitments"]}, {"C2": "Bを含める", "C3": "Aを含める"})
        self.assertEqual(s["commitments"][0]["depends_on"], [], "C1 が消えたので依存の参照も消える")
        self.assertEqual(len(s["questions"]), 1, "問いは1段のまま")
        self.assertEqual(s["questions"][0]["answers"], ["C2", "C3"], "C1 の回答は消え、C3 が足される")
        self.assertEqual(s["turn"], 3)

    def test_wrong_reading_is_structurally_valid_but_visible(self):
        s0 = after_pi2()
        self.assertEqual(validate(s0, D3_WRONG), [], "構造検査では止まらない")
        s = apply(s0, D3_WRONG)
        self.assertEqual([c["id"] for c in s["commitments"]], ["C1", "C2", "C3"], "C1 が残る＝訂正の読み落とし")
        self.assertEqual([q["id"] for q in s["questions"]], ["Q0", "Q1"], "ユーザーが開いていない問いが積まれる")
        self.assertIn("Q1", render(s))


class Validate(unittest.TestCase):
    def test_correct_diff_passes(self):
        self.assertEqual(validate(after_pi2(), D3_CORRECT), [])

    def test_unknown_id(self):
        d = {"turn": 3, "utterance_id": "π3", "relation": "Correction", "ops": [{"op": "retract", "id": "C9"}]}
        p = validate(after_pi2(), d)
        self.assertTrue(any("C9" in x for x in p), p)

    def test_retract_without_recheck_of_dependent(self):
        d = {"turn": 3, "utterance_id": "π3", "relation": "Correction",
             "ops": [{"op": "retract", "id": "C1"}, {"op": "add", "id": "C3", "content": "Aを含める"}]}
        p = validate(after_pi2(), d)
        self.assertTrue(any("C2 は C1 に依存" in x for x in p), p)

    def test_correction_without_retract(self):
        d = {"turn": 3, "utterance_id": "π3", "relation": "Correction",
             "ops": [{"op": "add", "id": "C3", "content": "Aを含める"}]}
        p = validate(after_pi2(), d)
        self.assertTrue(any("Correction なのに" in x for x in p), p)

    def test_duplicate_and_bad_ids(self):
        d = {"turn": 3, "utterance_id": "π3", "relation": "Continuation",
             "ops": [{"op": "add", "id": "C2", "content": "x"}, {"op": "add", "id": "Q7", "content": "y"},
                     {"op": "open", "id": "Q0", "question": "z"}]}
        p = validate(after_pi2(), d)
        self.assertEqual(len(p), 3, p)

    def test_acknowledge_must_not_change_state(self):
        d = {"turn": 3, "utterance_id": "π3", "relation": "Acknowledge", "ops": [{"op": "none"}]}
        self.assertEqual(validate(after_pi2(), d), [])
        d2 = {"turn": 3, "utterance_id": "π3", "relation": "Acknowledge", "ops": [{"op": "retract", "id": "C1"}]}
        self.assertTrue(validate(after_pi2(), d2))

    def test_contrast_does_not_retract(self):
        """「でも」で並べるだけなら取り消さない。取り消すなら Correction。"""
        ok = {"turn": 3, "utterance_id": "π3", "relation": "Contrast",
              "ops": [{"op": "add", "id": "C3", "content": "ただし A は後回し", "depends_on": ["C2"]}]}
        self.assertEqual(validate(after_pi2(), ok), [])
        bad = {"turn": 3, "utterance_id": "π3", "relation": "Contrast",
               "ops": [{"op": "retract", "id": "C2"}]}
        self.assertTrue(any("Contrast は取り消さない" in p for p in validate(after_pi2(), bad)))

    def test_explanation_needs_target(self):
        bad = {"turn": 3, "utterance_id": "π3", "relation": "Explanation",
               "ops": [{"op": "add", "id": "C3", "content": "公開するから"}]}
        self.assertTrue(any("理由づけの対象" in p for p in validate(after_pi2(), bad)))
        ok = dict(bad, target="C2")
        self.assertEqual(validate(after_pi2(), ok), [])

    def test_clarification_opens_a_question(self):
        bad = {"turn": 3, "utterance_id": "π3", "relation": "Clarification", "ops": [{"op": "none"}]}
        self.assertTrue(any("Clarification なのに open" in p for p in validate(after_pi2(), bad)))


class Purity(unittest.TestCase):
    def test_apply_does_not_mutate_input(self):
        s0 = after_pi2()
        snapshot = copy.deepcopy(s0)
        apply(s0, D3_CORRECT)
        self.assertEqual(s0, snapshot)

    def test_replay_equals_sequential_apply(self):
        seq = apply(apply(apply(empty_state("test"), D1), D2), D3_CORRECT)
        self.assertEqual(replay([D1, D2, D3_CORRECT], "test"), seq)

    def test_replay_strict_raises_on_bad_diff(self):
        bad = {"turn": 3, "utterance_id": "π3", "relation": "Correction", "ops": [{"op": "retract", "id": "C9"}]}
        with self.assertRaises(ValueError):
            replay([D1, D2, bad], "test")


class Misc(unittest.TestCase):
    def test_dependents(self):
        self.assertEqual(dependents(after_pi2(), "C1"), ["C2"])

    def test_amend_and_complete_answer(self):
        s = after_pi2()
        d = {"turn": 3, "utterance_id": "π3", "relation": "Elaboration", "target": "C2",
             "ops": [{"op": "amend", "id": "C2", "content": "Bを含める（β版から）"},
                     {"op": "answer", "question": "Q0", "by": "C2", "complete": True}]}
        self.assertEqual(validate(s, d), [])
        s2 = apply(s, d)
        self.assertEqual(s2["commitments"][1]["content"], "Bを含める（β版から）")
        self.assertTrue(s2["questions"][0]["closed"], "complete で問いが閉じる（消さない）")
        self.assertEqual(board(s2)["open"], [], "閉じた問いは開いている問いに出ない")

    def test_render_shape(self):
        out = render(apply(after_pi2(), D3_CORRECT))
        self.assertIn("Q0: 公開する製品の仕様は何か  回答: C2, C3", out)
        self.assertIn("C3: Aを含める  ← π3", out)
        self.assertNotIn("C1", out.split("### 有効なコミットメント")[1])
        self.assertIn("次の ID: C4 / Q1", out)


AUDIT_JOB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "examples", "audit_job.jsonl")


class Tree(unittest.TestCase):
    def setUp(self):
        self.state = replay(read_diffs(AUDIT_JOB), "audit")
        self.tree = board(self.state)["tree"]

    def test_commitments_hang_under_questions(self):
        nodes = {n["id"]: n for n in self.tree["nodes"]}
        self.assertEqual(nodes["Q0"]["items"], ["C0", "C1", "C5"])
        self.assertEqual(nodes["Q1"]["parent"], "Q0")
        self.assertEqual(self.tree["loose"], ["C3", "C4"], "どの問いにも答えていない補った前提は目的の直下")

    def test_dependents_follow_their_dependency(self):
        d = {"turn": 4, "utterance_id": "π4", "relation": "Elaboration",
             "ops": [{"op": "add", "id": "C6", "content": "5時の前に通知", "depends_on": ["C5"]}]}
        nodes = {n["id"]: n for n in board(apply(self.state, d))["tree"]["nodes"]}
        self.assertIn("C6", nodes["Q0"]["items"])

    def test_closed_question_keeps_its_branch(self):
        d = {"turn": 4, "utterance_id": "π4", "relation": "Answer",
             "ops": [{"op": "answer", "question": "Q0", "complete": True}]}
        nodes = {n["id"]: n for n in board(apply(self.state, d))["tree"]["nodes"]}
        self.assertTrue(nodes["Q0"]["closed"])
        self.assertEqual(nodes["Q0"]["items"], ["C0", "C1", "C5"])


class Move(unittest.TestCase):
    def test_move_reattaches_to_another_task(self):
        """進め方の決めごとを、意図の作業から片付いた進め方の作業へ付け替える。"""
        s = replay(read_diffs(os.path.join(os.path.dirname(os.path.abspath(__file__)), "examples", "self.jsonl")), "s")
        d = {"turn": 4, "utterance_id": "t", "relation": "Continuation",
             "ops": [{"op": "open", "id": "Q3", "question": "進め方", "owner": "claude"},
                     {"op": "move", "id": "C1", "question": "Q3"},
                     {"op": "answer", "question": "Q3", "complete": True}]}
        self.assertEqual(validate(s, d), [])
        tasks = {t["id"]: t for t in board(apply(s, d))["tasks"]}
        self.assertNotIn("C1", [i["id"] for i in tasks["Q0"]["items"]])
        self.assertEqual([i["id"] for i in tasks["Q3"]["items"]], ["C1"])
        self.assertTrue(tasks["Q3"]["closed"])

    def test_move_rejects_unknown(self):
        s = replay(read_diffs(os.path.join(os.path.dirname(os.path.abspath(__file__)), "examples", "self.jsonl")), "s")
        d = {"turn": 4, "utterance_id": "t", "relation": "Continuation", "ops": [{"op": "move", "id": "C99", "question": "Q9"}]}
        self.assertEqual(len(validate(s, d)), 2)


class IntentBoard(unittest.TestCase):
    """意図ボードは state の見え方。2026-10-05 の監査ジョブを手で書いた差分ログで確かめる。"""

    def setUp(self):
        self.state = replay(read_diffs(AUDIT_JOB), "audit")
        self.board = board(self.state)

    def test_goal_keeps_quote_and_reading_apart(self):
        g = self.board["goal"]
        self.assertEqual(len(g["quote"]), 2)
        self.assertIn("代わりに拾って", g["reading"])

    def test_decided_and_supplemented_never_overlap(self):
        decided = {c["id"] for c in self.board["decided"]}
        supplemented = {c["id"] for c in self.board["supplemented"]}
        self.assertEqual(decided, {"C0", "C1", "C5"})
        self.assertEqual(supplemented, {"C3", "C4"})
        self.assertFalse(decided & supplemented)
        self.assertTrue(all(c.get("reason") for c in self.board["supplemented"]))

    def test_replaced_records_what_became_what(self):
        self.assertEqual(self.board["replaced"], [
            {"id": "C2", "content": "実行は 10/6 5時ごろ", "turn": 3, "source": "π3", "replaced_by": "C5"}])

    def test_steps_point_back_to_intent(self):
        self.assertEqual(self.board["steps"][1]["from"], ["goal", "C0", "C3", "C4"])

    def test_open_question_has_owner(self):
        self.assertEqual(self.board["open"][0], {"id": "Q1", "question": "監査をどの範囲にかけるか",
                                                 "owner": "claude", "parent": "Q0"})

    def test_supplement_without_reason_is_rejected(self):
        d = {"turn": 4, "utterance_id": "σ4", "relation": "Continuation",
             "ops": [{"op": "add", "id": "C6", "content": "x", "by": "claude"}]}
        self.assertTrue(any("reason" in p for p in validate(self.state, d)))

    def test_confirm_moves_supplement_to_decided(self):
        d = {"turn": 4, "utterance_id": "π4", "relation": "Acknowledge", "ops": [{"op": "confirm", "id": "C4"}]}
        self.assertEqual(validate(self.state, d), [])
        b = board(apply(self.state, d))
        self.assertIn("C4", {c["id"] for c in b["decided"]})
        self.assertNotIn("C4", {c["id"] for c in b["supplemented"]})

    def test_confirm_rejects_user_commitment(self):
        d = {"turn": 4, "utterance_id": "π4", "relation": "Acknowledge", "ops": [{"op": "confirm", "id": "C1"}]}
        self.assertTrue(validate(self.state, d))

    def test_retract_drops_step_sources(self):
        d = {"turn": 4, "utterance_id": "π4", "relation": "Correction",
             "ops": [{"op": "retract", "id": "C3"}]}
        self.assertEqual(validate(self.state, d), [])
        b = board(apply(self.state, d))
        self.assertEqual(b["steps"][1]["from"], ["goal", "C0", "C4"])

    def test_plan_from_unknown_or_retracted_is_rejected(self):
        d = {"turn": 4, "utterance_id": "π4", "relation": "Correction",
             "ops": [{"op": "retract", "id": "C3"},
                     {"op": "plan", "steps": [{"text": "a", "from": ["C3"]}, {"text": "b", "from": ["C9"]}]}]}
        p = validate(self.state, d)
        self.assertTrue(any("取り消されている" in x for x in p), p)
        self.assertTrue(any("C9" in x for x in p), p)

    def test_plan_from_goal_requires_goal(self):
        d = {"turn": 1, "utterance_id": "π1", "relation": "Continuation",
             "ops": [{"op": "plan", "steps": [{"text": "a", "from": ["goal"]}]}]}
        self.assertTrue(any("目的" in x for x in validate(empty_state("t"), d)))


if __name__ == "__main__":
    unittest.main(verbosity=2)
