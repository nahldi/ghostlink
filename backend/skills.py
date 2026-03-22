"""Skills registry — manages available skills and per-agent skill assignments."""

import json
import os
from pathlib import Path
from typing import Any

# Built-in skills that ship with the app
BUILTIN_SKILLS = [
    {
        "id": "web-search",
        "name": "Web Search",
        "description": "Search the web using Brave or DuckDuckGo API",
        "category": "Research",
        "icon": "search",
        "builtin": True,
        "configurable": True,
        "config_fields": [{"key": "api_key", "label": "API Key", "type": "password", "required": False}],
    },
    {
        "id": "web-fetch",
        "name": "Web Fetch",
        "description": "Fetch and extract readable content from URLs",
        "category": "Research",
        "icon": "language",
        "builtin": True,
    },
    {
        "id": "file-browser",
        "name": "File Browser",
        "description": "Navigate, read, and search project files",
        "category": "Development",
        "icon": "folder_open",
        "builtin": True,
    },
    {
        "id": "git-ops",
        "name": "Git Operations",
        "description": "Git status, diff, commit, branch, PR management via gh CLI",
        "category": "Development",
        "icon": "commit",
        "builtin": True,
    },
    {
        "id": "shell-exec",
        "name": "Shell Execute",
        "description": "Run shell commands with optional approval gates",
        "category": "System",
        "icon": "terminal",
        "builtin": True,
    },
    {
        "id": "code-analysis",
        "name": "Code Analysis",
        "description": "AST parsing, dependency scanning, linting, and code review",
        "category": "Development",
        "icon": "code",
        "builtin": True,
    },
    {
        "id": "screenshot",
        "name": "Screenshot",
        "description": "Capture screenshots of URLs or localhost pages",
        "category": "Creative",
        "icon": "screenshot_monitor",
        "builtin": True,
    },
    {
        "id": "image-analysis",
        "name": "Image Analysis",
        "description": "Analyze images with vision models",
        "category": "Creative",
        "icon": "image_search",
        "builtin": True,
    },
    {
        "id": "pdf-reader",
        "name": "PDF Reader",
        "description": "Extract text and data from PDF documents",
        "category": "Data",
        "icon": "picture_as_pdf",
        "builtin": True,
    },
    {
        "id": "calculator",
        "name": "Calculator",
        "description": "Math expressions, unit conversions, and formulas",
        "category": "System",
        "icon": "calculate",
        "builtin": True,
    },
    {
        "id": "notes",
        "name": "Note Taking",
        "description": "Create, search, and manage persistent notes and memory",
        "category": "System",
        "icon": "note_add",
        "builtin": True,
    },
    {
        "id": "github-issues",
        "name": "GitHub Issues & PRs",
        "description": "Fetch issues, create PRs, review code, manage CI",
        "category": "Development",
        "icon": "bug_report",
        "builtin": True,
    },
    {
        "id": "web-perf",
        "name": "Web Performance",
        "description": "Lighthouse audits, Core Web Vitals, performance profiling",
        "category": "Development",
        "icon": "speed",
        "builtin": True,
    },
    {
        "id": "accessibility",
        "name": "Accessibility Auditor",
        "description": "WCAG 2.1 compliance checking for HTML/CSS",
        "category": "Development",
        "icon": "accessible",
        "builtin": True,
    },
    {
        "id": "weather",
        "name": "Weather",
        "description": "Current weather and forecasts for any location",
        "category": "Data",
        "icon": "cloud",
        "builtin": True,
    },
    {
        "id": "timer",
        "name": "Timer & Reminders",
        "description": "Set timers, countdowns, and scheduled reminders",
        "category": "System",
        "icon": "timer",
        "builtin": True,
    },
    {
        "id": "database-query",
        "name": "Database Query",
        "description": "Run SQL queries against SQLite, Postgres, or MySQL databases",
        "category": "Data",
        "icon": "storage",
        "builtin": True,
    },
    {
        "id": "docker-manage",
        "name": "Docker Manager",
        "description": "List, start, stop, and inspect Docker containers and images",
        "category": "System",
        "icon": "deployed_code",
        "builtin": True,
    },
    {
        "id": "api-test",
        "name": "API Tester",
        "description": "Send HTTP requests and test REST/GraphQL API endpoints",
        "category": "Development",
        "icon": "api",
        "builtin": True,
    },
    {
        "id": "diagram-gen",
        "name": "Diagram Generator",
        "description": "Create flowcharts, sequence diagrams, and architecture diagrams",
        "category": "Creative",
        "icon": "schema",
        "builtin": True,
    },
    {
        "id": "text-transform",
        "name": "Text Transform",
        "description": "Regex, JSON/CSV/YAML conversion, base64, hashing, formatting",
        "category": "System",
        "icon": "text_fields",
        "builtin": True,
    },
    {
        "id": "slack-notify",
        "name": "Slack/Discord Notify",
        "description": "Send notifications to Slack channels or Discord webhooks",
        "category": "Communication",
        "icon": "campaign",
        "builtin": True,
    },
    {
        "id": "email-send",
        "name": "Email Sender",
        "description": "Draft and send emails via SMTP or API integrations",
        "category": "Communication",
        "icon": "mail",
        "builtin": True,
    },
    {
        "id": "ai-search",
        "name": "AI Search",
        "description": "AI-powered web search with synthesized answers and citations",
        "category": "Research",
        "icon": "travel_explore",
        "builtin": True,
    },
    {
        "id": "knowledge-graph",
        "name": "Knowledge Graph",
        "description": "Build and query persistent knowledge graphs with entities and relations",
        "category": "Data",
        "icon": "hub",
        "builtin": True,
    },
    {
        "id": "test-runner",
        "name": "Test Runner",
        "description": "Run test suites (Jest, pytest, Go test) and report results",
        "category": "Development",
        "icon": "science",
        "builtin": True,
    },
    {
        "id": "dep-scanner",
        "name": "Dependency Scanner",
        "description": "Scan for outdated, vulnerable, or unused dependencies",
        "category": "Development",
        "icon": "security",
        "builtin": True,
    },
    {
        "id": "translate",
        "name": "Translator",
        "description": "Translate text between 50+ languages with context awareness",
        "category": "Communication",
        "icon": "translate",
        "builtin": True,
    },
]

CATEGORIES = ["Development", "Research", "Creative", "System", "Data", "Communication"]


class SkillsRegistry:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.skills_dir = data_dir / "skills"
        self.skills_dir.mkdir(parents=True, exist_ok=True)
        self._agent_skills: dict[str, list[str]] = {}  # agent_name → [skill_ids]
        self._skill_config: dict[str, dict[str, Any]] = {}  # agent:skill → config
        self._load()

    def _config_path(self) -> Path:
        return self.data_dir / "skills_config.json"

    def _load(self):
        path = self._config_path()
        if path.exists():
            try:
                data = json.loads(path.read_text("utf-8"))
                self._agent_skills = data.get("agent_skills", {})
                self._skill_config = data.get("skill_config", {})
            except Exception as e:
                import logging
                logging.getLogger(__name__).warning("Failed to load skills config: %s", e)

    def _save(self):
        path = self._config_path()
        path.write_text(json.dumps({
            "agent_skills": self._agent_skills,
            "skill_config": self._skill_config,
        }, indent=2), "utf-8")

    def get_all_skills(self) -> list[dict]:
        """Return all available skills (builtin + custom installed)."""
        skills = list(BUILTIN_SKILLS)
        # Scan skills_dir for custom installed skills
        if self.skills_dir.exists():
            for f in sorted(self.skills_dir.glob("*.json")):
                try:
                    import json as _json
                    skill = _json.loads(f.read_text("utf-8"))
                    if isinstance(skill, dict) and "id" in skill:
                        skill["builtin"] = False
                        skill.setdefault("source", "custom")
                        skills.append(skill)
                except Exception:
                    pass
        return skills

    def get_agent_skills(self, agent_name: str) -> list[str]:
        """Get enabled skill IDs for an agent. All skills enabled by default."""
        if agent_name not in self._agent_skills:
            # First time — enable all built-in skills by default
            return [s["id"] for s in BUILTIN_SKILLS]
        return self._agent_skills[agent_name]

    def set_agent_skills(self, agent_name: str, skill_ids: list[str]):
        """Set enabled skills for an agent."""
        self._agent_skills[agent_name] = skill_ids
        self._save()

    def enable_skill(self, agent_name: str, skill_id: str):
        skills = self._agent_skills.get(agent_name, [])
        if skill_id not in skills:
            skills.append(skill_id)
        self._agent_skills[agent_name] = skills
        self._save()

    def disable_skill(self, agent_name: str, skill_id: str):
        skills = self._agent_skills.get(agent_name, [])
        if skill_id in skills:
            skills.remove(skill_id)
        self._agent_skills[agent_name] = skills
        self._save()

    def get_skill_config(self, agent_name: str, skill_id: str) -> dict:
        key = f"{agent_name}:{skill_id}"
        return self._skill_config.get(key, {})

    def set_skill_config(self, agent_name: str, skill_id: str, config: dict):
        key = f"{agent_name}:{skill_id}"
        self._skill_config[key] = config
        self._save()

    def get_categories(self) -> list[str]:
        return CATEGORIES
