from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import aiosqlite

# Built-in skills that ship with the app
BUILTIN_SKILLS = [
    {
        "id": "web-search",
        "name": "Web Search",
        "description": "Search the web using DuckDuckGo or Google API",
        "category": "Research",
        "icon": "search",
        "builtin": True,
        "configurable": True,
        "config_fields": [{"key": "api_key", "label": "API Key", "type": "password", "required": False}],
    },
    {"id": "web-fetch", "name": "Web Fetch", "description": "Fetch and extract readable content from URLs", "category": "Research", "icon": "language", "builtin": True},
    {"id": "file-browser", "name": "File Browser", "description": "Navigate, read, and search project files", "category": "Development", "icon": "folder_open", "builtin": True},
    {"id": "git-ops", "name": "Git Operations", "description": "Git status, diff, commit, branch, PR management via gh CLI", "category": "Development", "icon": "commit", "builtin": True},
    {"id": "shell-exec", "name": "Shell Execute", "description": "Run shell commands with optional approval gates", "category": "System", "icon": "terminal", "builtin": True},
    {"id": "code-analysis", "name": "Code Analysis", "description": "AST parsing, dependency scanning, linting, and code review", "category": "Development", "icon": "code", "builtin": True},
    {"id": "screenshot", "name": "Screenshot", "description": "Capture screenshots of URLs or localhost pages", "category": "Creative", "icon": "screenshot_monitor", "builtin": True},
    {"id": "image-analysis", "name": "Image Analysis", "description": "Analyze images with vision models", "category": "Creative", "icon": "image_search", "builtin": True},
    {"id": "pdf-reader", "name": "PDF Reader", "description": "Extract text and data from PDF documents", "category": "Data", "icon": "picture_as_pdf", "builtin": True},
    {"id": "calculator", "name": "Calculator", "description": "Math expressions, unit conversions, and formulas", "category": "System", "icon": "calculate", "builtin": True},
    {"id": "notes", "name": "Note Taking", "description": "Create, search, and manage persistent notes and memory", "category": "System", "icon": "note_add", "builtin": True},
    {"id": "github-issues", "name": "GitHub Issues & PRs", "description": "Fetch issues, create PRs, review code, manage CI", "category": "Development", "icon": "bug_report", "builtin": True},
    {"id": "web-perf", "name": "Web Performance", "description": "Lighthouse audits, Core Web Vitals, performance profiling", "category": "Development", "icon": "speed", "builtin": True},
    {"id": "accessibility", "name": "Accessibility Auditor", "description": "WCAG 2.1 compliance checking for HTML/CSS", "category": "Development", "icon": "accessible", "builtin": True},
    {"id": "weather", "name": "Weather", "description": "Current weather and forecasts for any location", "category": "Data", "icon": "cloud", "builtin": True},
    {"id": "timer", "name": "Timer & Reminders", "description": "Set timers, countdowns, and scheduled reminders", "category": "System", "icon": "timer", "builtin": True},
    {"id": "database-query", "name": "Database Query", "description": "Run SQL queries against SQLite, Postgres, or MySQL databases", "category": "Data", "icon": "storage", "builtin": True},
    {"id": "docker-manage", "name": "Docker Manager", "description": "List, start, stop, and inspect Docker containers and images", "category": "System", "icon": "deployed_code", "builtin": True},
    {"id": "api-test", "name": "API Tester", "description": "Send HTTP requests and test REST/GraphQL API endpoints", "category": "Development", "icon": "api", "builtin": True},
    {"id": "diagram-gen", "name": "Diagram Generator", "description": "Create flowcharts, sequence diagrams, and architecture diagrams", "category": "Creative", "icon": "schema", "builtin": True},
    {"id": "text-transform", "name": "Text Transform", "description": "Regex, JSON/CSV/YAML conversion, base64, hashing, formatting", "category": "System", "icon": "text_fields", "builtin": True},
    {"id": "slack-notify", "name": "Slack/Discord Notify", "description": "Send notifications to Slack channels or Discord webhooks", "category": "Communication", "icon": "campaign", "builtin": True},
    {"id": "email-send", "name": "Email Sender", "description": "Draft and send emails via SMTP or API integrations", "category": "Communication", "icon": "mail", "builtin": True},
    {"id": "ai-search", "name": "AI Search", "description": "AI-powered web search with synthesized answers and citations", "category": "Research", "icon": "travel_explore", "builtin": True},
    {"id": "knowledge-graph", "name": "Knowledge Graph", "description": "Build and query persistent knowledge graphs with entities and relations", "category": "Data", "icon": "hub", "builtin": True},
    {"id": "test-runner", "name": "Test Runner", "description": "Run test suites (Jest, pytest, Go test) and report results", "category": "Development", "icon": "science", "builtin": True},
    {"id": "dep-scanner", "name": "Dependency Scanner", "description": "Scan for outdated, vulnerable, or unused dependencies", "category": "Development", "icon": "security", "builtin": True},
    {"id": "translate", "name": "Translator", "description": "Translate text between 50+ languages with context awareness", "category": "Communication", "icon": "translate", "builtin": True},
]

CATEGORIES = ["Development", "Research", "Creative", "System", "Data", "Communication"]


class SkillsRegistry:
    def __init__(self, data_dir: Path, db: aiosqlite.Connection):
        self.data_dir = data_dir
        self.db = db
        self.skills_dir = data_dir / "skills"
        self.skills_dir.mkdir(parents=True, exist_ok=True)
        self._legacy_agent_skills: dict[str, list[str]] = {}
        self._legacy_skill_config: dict[str, dict[str, Any]] = {}
        self._load_legacy()

    def _config_path(self) -> Path:
        return self.data_dir / "skills_config.json"

    def _load_legacy(self):
        path = self._config_path()
        if not path.exists():
            return
        try:
            data = json.loads(path.read_text("utf-8"))
            self._legacy_agent_skills = data.get("agent_skills", {})
            self._legacy_skill_config = data.get("skill_config", {})
        except Exception:
            self._legacy_agent_skills = {}
            self._legacy_skill_config = {}

    async def init(self):
        from profiles import DEFAULT_PROFILE_ID, get_profile_skills, set_profile_skills

        if not await get_profile_skills(self.db, DEFAULT_PROFILE_ID):
            await set_profile_skills(self.db, DEFAULT_PROFILE_ID, [s["id"] for s in BUILTIN_SKILLS], BUILTIN_SKILLS)
        await self._migrate_legacy_config()

    async def _migrate_legacy_config(self):
        from profiles import DEFAULT_PROFILE_ID, get_profile_skills, set_profile_skills

        if not self._legacy_agent_skills:
            return
        if not await get_profile_skills(self.db, DEFAULT_PROFILE_ID):
            first_agent = next(iter(self._legacy_agent_skills))
            await set_profile_skills(self.db, DEFAULT_PROFILE_ID, self._legacy_agent_skills[first_agent], BUILTIN_SKILLS)
        backup = self._config_path().with_suffix(".json.v1-backup")
        if self._config_path().exists() and not backup.exists():
            backup.write_text(self._config_path().read_text("utf-8"), "utf-8")

    def get_all_skills(self) -> list[dict]:
        skills = list(BUILTIN_SKILLS)
        if self.skills_dir.exists():
            for path in sorted(self.skills_dir.glob("*.json")):
                try:
                    skill = json.loads(path.read_text("utf-8"))
                    if isinstance(skill, dict) and "id" in skill:
                        skill["builtin"] = False
                        skill.setdefault("source", "custom")
                        skills.append(skill)
                except Exception:
                    pass
        return skills

    async def get_effective_skills(self, agent_id: str, profile_id: str) -> list[str]:
        from profiles import get_profile_skills

        entries = await get_profile_skills(self.db, profile_id)
        enabled = {entry["skill_id"] for entry in entries if entry["enabled"]}
        cursor = await self.db.execute("SELECT skill_id, action FROM agent_skill_overrides WHERE agent_id = ?", (agent_id,))
        try:
            rows = await cursor.fetchall()
        finally:
            await cursor.close()
        for row in rows:
            if row["action"] == "add":
                enabled.add(row["skill_id"])
            elif row["action"] == "remove":
                enabled.discard(row["skill_id"])
        return sorted(enabled)

    async def get_agent_skills(self, agent_name: str) -> list[str]:
        import deps

        inst = deps.registry.resolve(agent_name) if deps.registry else None
        if inst is None:
            return [s["id"] for s in BUILTIN_SKILLS]
        return await self.get_effective_skills(inst.agent_id, getattr(inst, "profile_id", "default"))

    async def enable_skill(self, agent_id: str, skill_id: str):
        await self.db.execute(
            """
            INSERT INTO agent_skill_overrides (agent_id, skill_id, action, config)
            VALUES (?, ?, 'add', '{}')
            ON CONFLICT(agent_id, skill_id) DO UPDATE SET action = 'add'
            """,
            (agent_id, skill_id),
        )
        await self.db.commit()

    async def disable_skill(self, agent_id: str, skill_id: str):
        await self.db.execute(
            """
            INSERT INTO agent_skill_overrides (agent_id, skill_id, action, config)
            VALUES (?, ?, 'remove', '{}')
            ON CONFLICT(agent_id, skill_id) DO UPDATE SET action = 'remove'
            """,
            (agent_id, skill_id),
        )
        await self.db.commit()

    def get_skill_config(self, agent_name: str, skill_id: str) -> dict:
        return self._legacy_skill_config.get(f"{agent_name}:{skill_id}", {})

    def get_categories(self) -> list[str]:
        return CATEGORIES
