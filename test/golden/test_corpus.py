from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from evals import GoldenTaskCorpus  # noqa: E402


def test_manifest_regenerates_from_task_files():
    corpus = GoldenTaskCorpus(root=ROOT)
    manifest = corpus.generate_manifest(write=False)
    task_ids = sorted(task["id"] for task in corpus.list_tasks())
    manifest_ids = sorted(task["id"] for task in manifest["tasks"])
    assert manifest["task_count"] >= 22
    assert manifest_ids == task_ids


def test_mandatory_subset_contains_expected_44_scenarios(pytestconfig):
    assert pytestconfig.getoption("--eval-subset") == "mandatory"
    corpus = GoldenTaskCorpus(root=ROOT)
    scenarios = corpus.mandatory_subset()
    assert len(scenarios) == 44
