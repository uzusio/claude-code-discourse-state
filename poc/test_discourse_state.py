"""discourse_state のテスト。ハンドオーバー §1 の A/B 例をそのまま使う。

実行: python -m unittest D:\\private\\.claude\\hooks\\discourse\\test_discourse_state.py
"""
import copy
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from discourse_state import apply, dependents, empty_state, next_ids, render, replay, validate  # noqa: E402

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
        self.assertEqual(s2["questions"], [], "complete で問いが降りる")

    def test_render_shape(self):
        out = render(apply(after_pi2(), D3_CORRECT))
        self.assertIn("Q0: 公開する製品の仕様は何か  回答: C2, C3", out)
        self.assertIn("C3: Aを含める  ← π3", out)
        self.assertNotIn("C1", out.split("### 有効なコミットメント")[1])
        self.assertIn("次の ID: C4 / Q1", out)


if __name__ == "__main__":
    unittest.main(verbosity=2)
