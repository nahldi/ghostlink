from __future__ import annotations

import difflib
import re
from pathlib import Path


def parse_agents_md(workspace_path: Path) -> dict:
    agents_md = workspace_path / "AGENTS.md"
    if not agents_md.exists():
        return {"agents": [], "workspace_rules": [], "raw": ""}

    content = agents_md.read_text("utf-8")
    agents: list[dict] = []
    workspace_rules: list[str] = []

    sections = re.split(r"^##\s+", content, flags=re.MULTILINE)
    for section in sections:
        if not section.strip():
            continue
        lines = section.strip().splitlines()
        heading = lines[0].strip()
        body_lines = lines[1:]
        agent_name = heading.split("(")[0].strip()
        if re.match(r"^[A-Za-z][A-Za-z0-9_-]*$", agent_name):
            role = ""
            rules: list[str] = []
            for line in body_lines:
                stripped = line.strip()
                if stripped.lower().startswith("role:"):
                    role = stripped.split(":", 1)[1].strip()
                elif stripped.startswith("- "):
                    rules.append(stripped[2:].strip())
            agents.append({"name": agent_name, "role": role, "rules": rules})
            continue
        for line in body_lines:
            stripped = line.strip()
            if stripped.startswith("- "):
                workspace_rules.append(stripped[2:].strip())

    return {"agents": agents, "workspace_rules": workspace_rules, "raw": content}


def compute_agents_md_diff(previous_raw: str, current_raw: str) -> str:
    previous = previous_raw.splitlines(keepends=True)
    current = current_raw.splitlines(keepends=True)
    return "".join(
        difflib.unified_diff(previous, current, fromfile="imported", tofile="workspace", n=3)
    )
