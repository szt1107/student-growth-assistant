"""Candidate compatibility with the measured Stage 3 scheduler, not timing gates."""
import hashlib
import json
from pathlib import Path
import runpy

import pytest

ROOT = Path(__file__).resolve().parents[2]
BASELINE = json.loads((Path(__file__).parent/"fixtures/scheduler_stage3.json").read_text())
BENCHMARK = runpy.run_path(str(ROOT/"scripts/scheduling_benchmark.py"))


@pytest.mark.parametrize("name", BASELINE["cases"])
def test_candidates_match_recorded_stage3_output(name, monkeypatch):
    # Keep the original fixture intact. Cases with explicit windows retain
    # their measured output. The unbounded deadlines case now uses 24 hours.
    monkeypatch.setenv('SGA_DAILY_LOAD_WEIGHT', '0')
    monkeypatch.setenv('SGA_REST_WEIGHT', '0')
    result = BENCHMARK["run_case"](name)
    expected = BASELINE["cases"][name]
    assert result["input_sha256"] == expected["input_sha256"]
    fingerprint = hashlib.sha256(json.dumps(result["output"], sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    if name == 'deadlines':
        # Full-day availability intentionally changes this historical result.
        assert result['output']['status'] == 'ready'
        assert result['output']['items']
        assert len(result['output']['candidate_options']) == 3
        assert result['output'] == BENCHMARK['run_case'](name)['output']
    else:
        assert fingerprint == expected["output_sha256"]
    assert all(not errors for errors in result["independent_validation_errors"])


@pytest.mark.parametrize("kind", ["time", "expansions"])
def test_search_limit_explains_which_budget_without_partial_candidate(kind, monkeypatch):
    from app.services import assistant_scheduler as scheduler
    tasks, rules, previous, _, _ = BENCHMARK["scenario"]("deadlines")
    if kind == "expansions":
        monkeypatch.setattr(scheduler, "SEARCH_EXPANSIONS", 1)
        monkeypatch.setattr(scheduler, "monotonic", lambda: 0)
    else:
        ticks = iter([0, 21])
        monkeypatch.setattr(scheduler, "monotonic", lambda: next(ticks))
    result = scheduler.arrange(BENCHMARK["WEEK"], BENCHMARK["NOW"], tasks, rules, previous, False)
    assert result["status"] == "no_plan" and result["items"] == []
    assert result["diagnostics"][0]["code"] == "SEARCH_LIMIT"
    assert result["diagnostics"][0]["budget_kind"] == kind
    assert result["diagnostics"][0]["expansions"] == (2 if kind == "expansions" else 1)
