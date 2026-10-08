"""Python 版（poc）と mod のテストを回し、結果を JUnit XML 1つにまとめる。

使い方（リポジトリの直下で）: python tools/test.py
出力: test-results/junit.xml（進捗ダッシュボードの test-results が読む）。どちらかが失敗すれば終了コード 1。
"""
import os
import re
import subprocess
import sys
import time
import unittest
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "test-results", "junit.xml")


def python_suite() -> ET.Element:
    """poc の unittest を回し、testsuite 要素にする。"""
    poc = os.path.join(ROOT, "poc")
    sys.path.insert(0, poc)
    suite = unittest.defaultTestLoader.discover(poc, pattern="test_*.py")
    cases: list[tuple[str, str, float, str | None, str | None]] = []

    class Result(unittest.TextTestResult):
        def startTest(self, test):
            self._t = time.perf_counter()
            super().startTest(test)

        def _record(self, test, kind=None, err=None):
            cls, name = test.id().rsplit(".", 1)
            cases.append((cls, name, time.perf_counter() - self._t, kind, self._exc_info_to_string(err, test) if err else None))

        def addSuccess(self, test):
            super().addSuccess(test)
            self._record(test)

        def addFailure(self, test, err):
            super().addFailure(test, err)
            self._record(test, "failure", err)

        def addError(self, test, err):
            super().addError(test, err)
            self._record(test, "error", err)

    with open(os.devnull, "w") as devnull:
        unittest.TextTestRunner(stream=devnull, resultclass=Result).run(suite)
    return _suite("poc (Python)", cases)


def mod_suite() -> ET.Element:
    """claude plugin test の出力（ファイル見出しと (pass)/(fail) 行）を読み、testsuite 要素にする。"""
    mod = os.path.join(ROOT, "mod", "discourse-state")
    p = subprocess.run(["claude", "plugin", "test", "."], cwd=mod, capture_output=True, text=True, encoding="utf-8", shell=os.name == "nt")
    cases: list[tuple[str, str, float, str | None, str | None]] = []
    current = "mod"
    lines = (p.stdout + p.stderr).splitlines()
    for i, line in enumerate(lines):
        if line.rstrip().endswith(".ts:") and not line.startswith("("):
            current = line.strip().rstrip(":").replace("\\", "/")
            continue
        m = re.match(r"^\((pass|fail)\) (.+?)(?: \[([\d.]+)ms\])?$", line.strip())
        if not m:
            continue
        status, name, ms = m.group(1), m.group(2), float(m.group(3) or 0) / 1000
        detail = None
        if status == "fail":
            tail = []
            for nxt in lines[i + 1:]:
                if nxt.startswith("(") or nxt.rstrip().endswith(".ts:"):
                    break
                tail.append(nxt)
            detail = "\n".join(tail).strip()
        cases.append((current, name, ms, "failure" if status == "fail" else None, detail))
    if not cases:
        cases.append(("mod", "claude plugin test を実行できなかった", 0.0, "error", (p.stdout + p.stderr)[-2000:]))
    return _suite("mod (TypeScript)", cases)


def _suite(name: str, cases) -> ET.Element:
    s = ET.Element("testsuite", name=name, tests=str(len(cases)),
                   failures=str(sum(1 for c in cases if c[3] == "failure")),
                   errors=str(sum(1 for c in cases if c[3] == "error")),
                   time=f"{sum(c[2] for c in cases):.3f}")
    for cls, test, t, kind, detail in cases:
        tc = ET.SubElement(s, "testcase", classname=cls, name=test, time=f"{t:.3f}")
        if kind:
            ET.SubElement(tc, kind, message=(detail or "").splitlines()[0] if detail else kind).text = detail
    return s


def main() -> int:
    root = ET.Element("testsuites")
    suites = [python_suite(), mod_suite()]
    root.extend(suites)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    ET.ElementTree(root).write(OUT, encoding="utf-8", xml_declaration=True)
    bad = 0
    for s in suites:
        f, e = int(s.get("failures")), int(s.get("errors"))
        bad += f + e
        print(f"{s.get('name')}: {s.get('tests')} 件、失敗 {f}、エラー {e}")
    print(OUT)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
