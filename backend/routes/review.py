from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

import deps
from code_review import ReviewEngine, init_review_db

router = APIRouter()


def _engine() -> ReviewEngine:
    return ReviewEngine(deps.runtime_db)


async def _record_review_audit(event_type: str, action: str, *, detail: dict) -> None:
    if deps.audit_store is None:
        return
    await deps.audit_store.record(
        event_type,
        actor="review_engine",
        actor_type="system",
        action=action,
        detail=detail,
    )


@router.post("/api/review")
async def review_diff(request: Request):
    body = await request.json()
    diff_text = str(body.get("diff_text") or body.get("diff") or "").strip()
    if not diff_text:
        return JSONResponse({"error": "diff_text required"}, 400)
    await init_review_db(deps.runtime_db)
    result = await _engine().review_diff(diff_text)
    await _record_review_audit(
        "review.generated",
        "generated code review findings",
        detail={"review_id": result["review_id"], "finding_count": len(result["findings"])},
    )
    return result


@router.get("/api/review/rules")
async def list_review_rules(active_only: bool = False):
    await init_review_db(deps.runtime_db)
    return {"rules": await _engine().list_rules(active_only=active_only)}


@router.post("/api/review/rules")
async def create_review_rule(request: Request):
    body = await request.json()
    rule_text = str(body.get("rule_text") or "").strip()
    if not rule_text:
        return JSONResponse({"error": "rule_text required"}, 400)
    await init_review_db(deps.runtime_db)
    rule = await _engine().create_rule(
        rule_text=rule_text,
        category=str(body.get("category") or "custom"),
        match_text=str(body.get("match_text") or ""),
        suggestion=str(body.get("suggestion") or ""),
        severity=str(body.get("severity") or "medium"),
        origin="manual",
    )
    await _record_review_audit("review.rule.created", "created review rule", detail={"rule_id": rule["rule_id"], "origin": "manual"})
    return {"rule": rule}


@router.post("/api/review/{finding_id}/correct")
async def correct_review_finding(finding_id: str, request: Request):
    body = await request.json()
    try:
        learned = await _engine().learn_from_correction(
            finding_id,
            str(body.get("correction_type") or ""),
            str(body.get("correction_text") or ""),
        )
    except KeyError:
        return JSONResponse({"error": "finding not found"}, 404)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, 400)
    await _record_review_audit(
        "review.corrected",
        "learned from review correction",
        detail={"finding_id": finding_id, "correction_type": learned["correction_type"], "rule_id": (learned["rule"] or {}).get("rule_id", "")},
    )
    return learned


@router.delete("/api/review/rules/{rule_id}")
async def delete_review_rule(rule_id: str):
    await init_review_db(deps.runtime_db)
    deleted = await _engine().delete_rule(rule_id)
    if not deleted:
        return JSONResponse({"error": "not found"}, 404)
    await _record_review_audit("review.rule.deleted", "deleted review rule", detail={"rule_id": rule_id})
    return {"ok": True}
