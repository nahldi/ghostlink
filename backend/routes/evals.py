"""Eval corpus, grading, and benchmark routes."""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

import deps
from evals import evaluate_regression_gates

router = APIRouter()


@router.get("/api/evals/manifest")
async def get_eval_manifest(regenerate: bool = False):
    if deps.eval_engine is None:
        return JSONResponse({"error": "not implemented"}, 501)
    return deps.eval_engine.corpus.generate_manifest(write=regenerate)


@router.get("/api/evals/tasks")
async def list_eval_tasks():
    if deps.eval_engine is None:
        return JSONResponse({"error": "not implemented"}, 501)
    return {"tasks": deps.eval_engine.corpus.list_tasks()}


@router.get("/api/evals/scenarios/mandatory")
async def list_mandatory_eval_scenarios():
    if deps.eval_engine is None:
        return JSONResponse({"error": "not implemented"}, 501)
    scenarios = deps.eval_engine.corpus.mandatory_subset()
    return {"count": len(scenarios), "scenarios": scenarios}


@router.post("/api/evals/grade")
async def grade_eval_trace(request: Request):
    if deps.eval_engine is None:
        return JSONResponse({"error": "not implemented"}, 501)
    body = await request.json()
    golden_task_id = str(body.get("golden_task_id", "") or "").strip()
    if not golden_task_id:
        return JSONResponse({"error": "golden_task_id required"}, 400)
    task = deps.eval_engine.corpus.get_task(golden_task_id)
    if not task:
        return JSONResponse({"error": "golden task not found"}, 404)
    trace = body.get("trace")
    if not isinstance(trace, dict):
        trace = await deps.eval_engine.build_trace(task_id=str(body.get("task_id", "") or ""), trace_id=str(body.get("trace_id", "") or ""))
    report = deps.eval_engine.grader.grade(trace, task, baseline=body.get("baseline"))
    return {"task": task, "trace": {"task_id": trace.get("task_id", ""), "trace_id": trace.get("trace_id", ""), "duration_ms": trace.get("duration_ms", 0)}, "report": report.to_dict()}


@router.post("/api/evals/runs")
async def create_eval_run(request: Request):
    if deps.eval_engine is None:
        return JSONResponse({"error": "not implemented"}, 501)
    body = await request.json()
    return await deps.eval_engine.store.create_run(
        subset=str(body.get("subset", "mandatory") or "mandatory"),
        baseline_run_id=str(body.get("baseline_run_id", "") or ""),
        commit_hash=str(body.get("commit_hash", "") or ""),
        version=str(body.get("version", "") or ""),
        metadata=body.get("metadata") if isinstance(body.get("metadata"), dict) else {},
    )


@router.post("/api/evals/runs/{run_id}/results")
async def record_eval_result(run_id: str, request: Request):
    if deps.eval_engine is None:
        return JSONResponse({"error": "not implemented"}, 501)
    body = await request.json()
    golden_task_id = str(body.get("golden_task_id", "") or "").strip()
    task = deps.eval_engine.corpus.get_task(golden_task_id)
    if not task:
        return JSONResponse({"error": "golden task not found"}, 404)
    trace = body.get("trace")
    if not isinstance(trace, dict):
        trace = await deps.eval_engine.build_trace(task_id=str(body.get("task_id", "") or ""), trace_id=str(body.get("trace_id", "") or ""))
    report = deps.eval_engine.grader.grade(trace, task, baseline=body.get("baseline"))
    result = await deps.eval_engine.store.record_result(
        run_id=run_id,
        task=task,
        provider=str(body.get("provider", "anthropic") or "anthropic"),
        model=str(body.get("model", "unknown") or "unknown"),
        profile=str(body.get("profile", "default") or "default"),
        sandbox_tier=str(body.get("sandbox_tier", "none") or "none"),
        agent_role=str(body.get("agent_role", "single_agent") or "single_agent"),
        trace_id=str(trace.get("trace_id", "") or ""),
        task_ref=str(trace.get("task_id", "") or ""),
        report=report,
        cost_usd=sum(float(item.get("cost", item.get("cost_usd", 0.0)) or 0.0) for item in trace.get("usage", [])),
        duration_ms=int(trace.get("duration_ms", 0) or 0),
        commit_hash=str(body.get("commit_hash", "") or ""),
        version=str(body.get("version", "") or ""),
        metadata=body.get("metadata") if isinstance(body.get("metadata"), dict) else {},
        human_override=body.get("human_override") if isinstance(body.get("human_override"), dict) else None,
    )
    return {"result": result, "report": report.to_dict()}


@router.get("/api/evals/results")
async def list_eval_results(run_id: str = "", provider: str = "", model: str = "", profile: str = "", version: str = "", since: float | None = None, until: float | None = None, limit: int = 100, offset: int = 0):
    if deps.eval_engine is None:
        return JSONResponse({"error": "not implemented"}, 501)
    return {"results": await deps.eval_engine.store.list_results(run_id=run_id, provider=provider, model=model, profile=profile, version=version, since=since, until=until, limit=limit, offset=offset)}


@router.get("/api/evals/runs/{run_id}/summary")
async def get_eval_run_summary(run_id: str):
    if deps.eval_engine is None:
        return JSONResponse({"error": "not implemented"}, 501)
    return await deps.eval_engine.store.summarize_run(run_id)


@router.post("/api/evals/gates/check")
async def check_eval_gates(request: Request):
    if deps.eval_engine is None:
        return JSONResponse({"error": "not implemented"}, 501)
    body = await request.json()
    run_id = str(body.get("run_id", "") or "")
    if not run_id:
        return JSONResponse({"error": "run_id required"}, 400)
    current = await deps.eval_engine.store.list_results(run_id=run_id, limit=5000)
    baseline_run_id = str(body.get("baseline_run_id", "") or "")
    baseline = await deps.eval_engine.store.list_results(run_id=baseline_run_id, limit=5000) if baseline_run_id else []
    return {"run_id": run_id, "baseline_run_id": baseline_run_id, **evaluate_regression_gates(current, thresholds=deps.eval_engine.corpus.thresholds(), baseline_results=baseline)}
