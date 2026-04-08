from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from evals import DEFAULT_THRESHOLDS, evaluate_regression_gates  # noqa: E402


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Check GhostLink eval hard gates.")
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--results", required=True)
    args = parser.parse_args()

    baseline_payload = _load_json(Path(args.baseline))
    results_payload = _load_json(Path(args.results))

    baseline_results = list(baseline_payload.get("results", []))
    current_results = list(results_payload.get("results", []))
    thresholds = results_payload.get("thresholds") or baseline_payload.get("thresholds") or DEFAULT_THRESHOLDS
    gate = evaluate_regression_gates(current_results, thresholds=thresholds, baseline_results=baseline_results)

    print(json.dumps(gate, indent=2))
    if gate["ok"]:
        return 0
    for failure in gate["blocking"]:
        print(f"FAIL {failure['task_id']}: {failure['reason']}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
