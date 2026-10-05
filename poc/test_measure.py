"""measure のテスト。数えるデータはすべて作ったもの（実際の会話ではない）。

実行（poc/ で）: python -m unittest test_measure
"""
import copy
import io
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from measure import main, measure  # noqa: E402


def add_claude(cid: str) -> dict:
    return {"relation": "Continuation", "ops": [{"op": "add", "id": cid, "content": "x", "by": "claude", "reason": "r"}]}


def d(relation: str, *ops: dict) -> dict:
    return {"relation": relation, "ops": list(ops)}


class MeasureTest(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(measure([]), {"supplements": 0, "confirmed": 0, "stopped": 0, "withdrawn": 0,
                                       "pending": 0, "readings": 0, "readings_corrected": 0})

    def test_user_add_not_counted(self):
        r = measure([d("Continuation", {"op": "add", "id": "C0", "content": "x"}),
                     d("Continuation", {"op": "add", "id": "C1", "content": "x", "by": "user"})])
        self.assertEqual(r["supplements"], 0)

    def test_confirm(self):
        r = measure([add_claude("C0"), d("Acknowledge", {"op": "confirm", "id": "C0"})])
        self.assertEqual((r["supplements"], r["confirmed"], r["stopped"], r["pending"]), (1, 1, 0, 0))

    def test_pending(self):
        r = measure([add_claude("C0"), add_claude("C1"), d("Acknowledge", {"op": "confirm", "id": "C1"})])
        self.assertEqual((r["supplements"], r["pending"]), (2, 1))

    def test_correction_retract_is_stopped(self):
        r = measure([add_claude("C0"), d("Correction", {"op": "retract", "id": "C0"})])
        self.assertEqual((r["stopped"], r["withdrawn"], r["pending"]), (1, 0, 0))

    def test_correction_amend_is_stopped_but_still_pending(self):
        r = measure([add_claude("C0"), d("Correction", {"op": "amend", "id": "C0", "content": "y"})])
        self.assertEqual((r["stopped"], r["pending"]), (1, 1))

    def test_amend_then_retract_counts_once(self):
        r = measure([add_claude("C0"),
                     d("Correction", {"op": "amend", "id": "C0", "content": "y"}),
                     d("Correction", {"op": "retract", "id": "C0"})])
        self.assertEqual((r["stopped"], r["withdrawn"]), (1, 0))

    def test_amend_in_correction_then_retract_by_claude_counts_once(self):
        r = measure([add_claude("C0"),
                     d("Correction", {"op": "amend", "id": "C0", "content": "y"}),
                     d("Continuation", {"op": "retract", "id": "C0"})])
        self.assertEqual((r["stopped"], r["withdrawn"]), (1, 0))

    def test_non_correction_retract_is_withdrawn(self):
        r = measure([add_claude("C0"), d("Continuation", {"op": "retract", "id": "C0"})])
        self.assertEqual((r["stopped"], r["withdrawn"], r["pending"]), (0, 1, 0))

    def test_non_correction_amend_not_stopped(self):
        r = measure([add_claude("C0"), d("Elaboration", {"op": "amend", "id": "C0", "content": "y"})])
        self.assertEqual(r["stopped"], 0)

    def test_retract_of_user_commitment_not_counted(self):
        r = measure([d("Continuation", {"op": "add", "id": "C0", "content": "x"}),
                     d("Correction", {"op": "retract", "id": "C0"})])
        self.assertEqual((r["stopped"], r["withdrawn"]), (0, 0))

    def test_open_intent_and_intent_correction(self):
        r = measure([
            d("Open", {"op": "open", "id": "Q0", "question": "q", "intent": {"quote": ["a"], "reading": "r"}}),
            d("Open", {"op": "open", "id": "Q1", "question": "q"}),  # 読み無し
            d("Elaboration", {"op": "intent", "question": "Q0", "quote": ["a"], "reading": "r2"}),
            d("Correction", {"op": "intent", "question": "Q0", "quote": ["a"], "reading": "r3"}),
        ])
        self.assertEqual((r["readings"], r["readings_corrected"]), (3, 1))

    def test_does_not_mutate_input(self):
        diffs = [add_claude("C0"), d("Correction", {"op": "retract", "id": "C0"})]
        before = copy.deepcopy(diffs)
        measure(diffs)
        self.assertEqual(diffs, before)


class CliTest(unittest.TestCase):
    def run_main(self, argv, env=None):
        out, err = io.StringIO(), io.StringIO()
        code = main(argv, env or {}, out, err)
        return code, out.getvalue(), err.getvalue()

    def make_session(self, base: str, name: str, lines: list[str]) -> str:
        folder = os.path.join(base, name)
        os.makedirs(folder)
        with open(os.path.join(folder, "diffs.jsonl"), "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        return folder

    def test_broken_line_exits_1_with_location(self):
        with tempfile.TemporaryDirectory() as base:
            folder = self.make_session(base, "abcdef123456", [json.dumps(add_claude("C0")), "{broken"])
            code, _, err = self.run_main([folder])
            self.assertEqual(code, 1)
            self.assertIn("diffs.jsonl:2", err)

    def test_no_records(self):
        with tempfile.TemporaryDirectory() as base:
            code, out, _ = self.run_main([], {"TEMP": base})
            self.assertEqual(code, 0)
            self.assertIn("記録が無い", out)

    def test_default_dir_and_total(self):
        with tempfile.TemporaryDirectory() as base:
            ds = os.path.join(base, "discourse-state")
            os.makedirs(ds)
            self.make_session(ds, "aaaaaaaa1111", [json.dumps(add_claude("C0")),
                                                   json.dumps(d("Correction", {"op": "retract", "id": "C0"}))])
            self.make_session(ds, "bbbbbbbb2222", [json.dumps(add_claude("C0")),
                                                   json.dumps(d("Acknowledge", {"op": "confirm", "id": "C0"}))])
            code, out, _ = self.run_main([], {"TEMP": base})
            self.assertEqual(code, 0)
            lines = out.strip().splitlines()
            self.assertEqual(len(lines), 3)
            self.assertTrue(lines[0].startswith("aaaaaaaa"))
            self.assertTrue(lines[2].startswith("合計"))
            self.assertIn("50%", lines[2])

    def test_json_and_zero_supplements_ratio(self):
        with tempfile.TemporaryDirectory() as base:
            folder = self.make_session(base, "cccccccc3333", [json.dumps(d("Acknowledge", {"op": "none"}))])
            code, out, _ = self.run_main([folder, "--json"])
            self.assertEqual(code, 0)
            data = json.loads(out)
            self.assertEqual(data["total"]["supplements"], 0)
            self.assertEqual(data["stopped_ratio"], "-")
            self.assertEqual(data["sessions"][0]["session"], "cccccccc")


if __name__ == "__main__":
    unittest.main()
