"""Skills Marketplace — browse, install, and share community skills.

Skills are stored as JSON definitions. The marketplace uses the GitHub repo
as the registry — no external hosting needed. Users can:
- Browse available skills from the built-in catalog + community
- Install/enable skills per agent
- Create custom skills via the UI
- Export skills as shareable JSON files
"""

import json
import logging
import re
import time
from pathlib import Path

log = logging.getLogger(__name__)

# ── Skill Safety / Content Scanning ──────────────────────────────────────

# Dangerous patterns that custom skills should NEVER contain
_DANGEROUS_PATTERNS = [
    (re.compile(r'\bos\.system\b'), "Direct shell execution via os.system"),
    (re.compile(r'\b__import__\b'), "Dynamic import (potential code injection)"),
    (re.compile(r'\beval\s*\('), "eval() call (code injection risk)"),
    (re.compile(r'\bexec\s*\('), "exec() call (code injection risk)"),
    (re.compile(r'\brm\s+-rf\s+\/'), "Recursive deletion of root filesystem"),
    (re.compile(r'\bimport\s+ctypes\b'), "Low-level ctypes access"),
]

# Suspicious patterns that trigger warnings (not blocking)
_WARNING_PATTERNS = [
    (re.compile(r'\brequests\.(get|post|put|delete)\b'), "HTTP requests to external services"),
    (re.compile(r'\bsmtplib\b'), "Email sending capability"),
    (re.compile(r'\bshutil\.rmtree\b'), "Recursive directory deletion"),
    (re.compile(r'\bos\.environ\b'), "Environment variable access"),
]


def scan_skill_content(content: str) -> dict:
    """Scan skill implementation content for dangerous patterns.

    Returns dict with safe (bool), errors (list), warnings (list).
    """
    errors = []
    warnings = []

    for pattern, reason in _DANGEROUS_PATTERNS:
        if pattern.search(content):
            errors.append({"pattern": pattern.pattern, "reason": reason})

    for pattern, reason in _WARNING_PATTERNS:
        if pattern.search(content):
            warnings.append({"pattern": pattern.pattern, "reason": reason})

    return {
        "safe": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
    }

# Community skills catalog — stored locally, can be refreshed from GitHub
_COMMUNITY_SKILLS: list[dict] = []
_CUSTOM_SKILLS_DIR: Path | None = None


def _load_community_skills(data_dir: Path) -> list[dict]:
    """Load community skills from local cache."""
    cache_file = data_dir / "community_skills.json"
    if cache_file.exists():
        try:
            return json.loads(cache_file.read_text("utf-8"))
        except Exception:
            pass
    return []


def _save_community_skills(data_dir: Path, skills: list[dict]):
    cache_file = data_dir / "community_skills.json"
    cache_file.write_text(json.dumps(skills, indent=2), "utf-8")


def setup(app, store=None, registry=None, mcp_bridge=None):
    """Register marketplace endpoints."""
    from fastapi import Request
    from fastapi.responses import JSONResponse

    # Determine data dir from app state
    data_dir = Path(__file__).parent.parent / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    custom_dir = data_dir / "custom_skills"
    custom_dir.mkdir(parents=True, exist_ok=True)

    global _CUSTOM_SKILLS_DIR
    _CUSTOM_SKILLS_DIR = custom_dir

    @app.get("/api/marketplace")
    async def browse_marketplace(category: str = "", search: str = ""):
        """Browse available community skills."""
        skills = _load_community_skills(data_dir)

        # Also include locally created custom skills
        for f in sorted(custom_dir.glob("*.json")):
            try:
                skill = json.loads(f.read_text("utf-8"))
                skill["source"] = "custom"
                skills.append(skill)
            except Exception:
                continue

        if category:
            skills = [s for s in skills if s.get("category", "").lower() == category.lower()]
        if search:
            q = search.lower()
            skills = [s for s in skills if q in s.get("name", "").lower() or q in s.get("description", "").lower()]

        return {"skills": skills, "total": len(skills)}

    @app.post("/api/marketplace/create")
    async def create_custom_skill(request: Request):
        """Create a new custom skill definition."""
        body = await request.json()
        name = (body.get("name", "") or "").strip()
        if not name:
            return JSONResponse({"error": "name required"}, 400)

        impl_content = (body.get("impl_content", "") or "").strip()
        impl_type = body.get("impl_type", "prompt")

        # Safety scan for script-type implementations
        scan_result = None
        if impl_type in ("script", "mcp") and impl_content:
            scan_result = scan_skill_content(impl_content)
            if not scan_result["safe"]:
                return JSONResponse({
                    "error": "Skill content failed safety scan",
                    "scan": scan_result,
                }, 400)

        skill = {
            "id": f"custom-{name.lower().replace(' ', '-')}",
            "name": name,
            "description": (body.get("description", "") or "").strip(),
            "category": (body.get("category", "Custom") or "Custom").strip(),
            "icon": body.get("icon", "extension"),
            "builtin": False,
            "source": "custom",
            "author": (body.get("author", "") or "").strip(),
            "created_at": time.time(),
            "scanned": True,
            "scan_warnings": scan_result["warnings"] if scan_result else [],
            "implementation": {
                "type": impl_type,
                "content": impl_content,
            },
        }

        # Save to file
        skill_file = custom_dir / f"{skill['id']}.json"
        skill_file.write_text(json.dumps(skill, indent=2), "utf-8")

        return skill

    @app.delete("/api/marketplace/{skill_id}")
    async def delete_custom_skill(skill_id: str):
        """Delete a custom skill."""
        skill_file = custom_dir / f"{skill_id}.json"
        if skill_file.exists():
            skill_file.unlink()
            return {"ok": True}
        return JSONResponse({"error": "not found"}, 404)

    @app.get("/api/marketplace/export/{skill_id}")
    async def export_skill(skill_id: str):
        """Export a custom skill as shareable JSON."""
        skill_file = custom_dir / f"{skill_id}.json"
        if skill_file.exists():
            return json.loads(skill_file.read_text("utf-8"))
        return JSONResponse({"error": "not found"}, 404)

    @app.post("/api/marketplace/import")
    async def import_skill(request: Request):
        """Import a skill from JSON with safety scanning."""
        body = await request.json()
        skill_id = body.get("id", "")
        if not skill_id:
            return JSONResponse({"error": "skill must have an id"}, 400)

        # Safety scan imported skill content
        impl = body.get("implementation", {})
        impl_content = impl.get("content", "")
        impl_type = impl.get("type", "prompt")
        if impl_type in ("script", "mcp") and impl_content:
            scan_result = scan_skill_content(impl_content)
            if not scan_result["safe"]:
                return JSONResponse({
                    "error": "Imported skill failed safety scan",
                    "scan": scan_result,
                }, 400)
            body["scanned"] = True
            body["scan_warnings"] = scan_result["warnings"]

        skill_file = custom_dir / f"{skill_id}.json"
        skill_file.write_text(json.dumps(body, indent=2), "utf-8")
        return {"ok": True, "id": skill_id}

    @app.post("/api/marketplace/scan")
    async def scan_skill(request: Request):
        """Scan skill content for safety without saving."""
        body = await request.json()
        content = (body.get("content", "") or "").strip()
        if not content:
            return {"safe": True, "errors": [], "warnings": []}
        return scan_skill_content(content)

    log.info("Skills marketplace plugin loaded")
