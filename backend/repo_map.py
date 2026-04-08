"""Repository Map — lightweight codebase architecture extraction.

Parses project files using regex patterns (no tree-sitter dependency)
to produce a condensed architecture map of classes, functions, and exports.

Output fits in ~4K tokens for agent system prompt injection.
"""

from __future__ import annotations

import logging
import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger(__name__)

# Language-specific patterns for extracting symbols
_PATTERNS: dict[str, list[tuple[str, re.Pattern]]] = {
    ".py": [
        ("class", re.compile(r"^class\s+(\w+)(?:\(.*?\))?:", re.MULTILINE)),
        ("function", re.compile(r"^def\s+(\w+)\(", re.MULTILINE)),
        ("async_function", re.compile(r"^async\s+def\s+(\w+)\(", re.MULTILINE)),
    ],
    ".ts": [
        ("class", re.compile(r"(?:export\s+)?class\s+(\w+)", re.MULTILINE)),
        ("function", re.compile(r"(?:export\s+)?(?:async\s+)?function\s+(\w+)", re.MULTILINE)),
        ("component", re.compile(r"(?:export\s+)?(?:const|function)\s+(\w+).*?(?:=>|{)\s*(?:\(|{)?.*?(?:<|return)", re.MULTILINE)),
        ("interface", re.compile(r"(?:export\s+)?interface\s+(\w+)", re.MULTILINE)),
        ("type", re.compile(r"(?:export\s+)?type\s+(\w+)\s*=", re.MULTILINE)),
    ],
    ".tsx": [
        ("component", re.compile(r"(?:export\s+)?(?:const|function)\s+(\w+).*?(?:=>|{)", re.MULTILINE)),
        ("interface", re.compile(r"(?:export\s+)?interface\s+(\w+)", re.MULTILINE)),
    ],
    ".js": [
        ("class", re.compile(r"(?:export\s+)?class\s+(\w+)", re.MULTILINE)),
        ("function", re.compile(r"(?:export\s+)?(?:async\s+)?function\s+(\w+)", re.MULTILINE)),
    ],
    ".go": [
        ("function", re.compile(r"^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\(", re.MULTILINE)),
        ("struct", re.compile(r"^type\s+(\w+)\s+struct\s*{", re.MULTILINE)),
        ("interface", re.compile(r"^type\s+(\w+)\s+interface\s*{", re.MULTILINE)),
    ],
    ".rs": [
        ("function", re.compile(r"(?:pub\s+)?(?:async\s+)?fn\s+(\w+)", re.MULTILINE)),
        ("struct", re.compile(r"(?:pub\s+)?struct\s+(\w+)", re.MULTILINE)),
        ("trait", re.compile(r"(?:pub\s+)?trait\s+(\w+)", re.MULTILINE)),
        ("impl", re.compile(r"impl(?:<.*?>)?\s+(\w+)", re.MULTILINE)),
    ],
    ".java": [
        ("class", re.compile(r"(?:public|private|protected)?\s*class\s+(\w+)", re.MULTILINE)),
        ("interface", re.compile(r"(?:public\s+)?interface\s+(\w+)", re.MULTILINE)),
        ("method", re.compile(r"(?:public|private|protected)\s+\w+\s+(\w+)\s*\(", re.MULTILINE)),
    ],
}

# Extend .tsx to also use .ts patterns
_PATTERNS[".tsx"] = _PATTERNS[".ts"] + _PATTERNS[".tsx"]

IGNORE_DIRS = {
    "node_modules", "__pycache__", ".venv", "venv", ".git", "dist", "build",
    ".next", ".cache", "coverage", ".ghostlink-worktrees", ".ghostlink", ".claude",
}
MAX_FILES = 500
MAX_FILE_SIZE = 200_000  # 200KB


@dataclass
class Symbol:
    """A code symbol (class, function, etc.)."""
    name: str
    kind: str
    file: str
    line: int = 0


@dataclass
class RepoMap:
    """Condensed architecture map of a codebase."""
    root: str
    files_scanned: int = 0
    symbols: list[Symbol] = field(default_factory=list)
    scan_time: float = 0


def scan_repo(root: str | Path, max_files: int = MAX_FILES) -> RepoMap:
    """Scan a repository and extract symbols."""
    root = Path(root).resolve()
    if not root.is_dir():
        return RepoMap(root=str(root))

    start = time.time()
    repo_map = RepoMap(root=str(root))
    file_count = 0

    for dirpath, dirnames, filenames in os.walk(root):
        # Skip ignored directories
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]

        for fname in sorted(filenames):
            if file_count >= max_files:
                break

            filepath = Path(dirpath) / fname
            ext = filepath.suffix.lower()
            if ext not in _PATTERNS:
                continue

            try:
                if filepath.stat().st_size > MAX_FILE_SIZE:
                    continue
                content = filepath.read_text("utf-8", errors="replace")
                file_count += 1

                rel_path = str(filepath.relative_to(root)).replace("\\", "/")
                patterns = _PATTERNS[ext]

                for kind, pattern in patterns:
                    for match in pattern.finditer(content):
                        name = match.group(1)
                        # Skip private/internal names
                        if name.startswith("_") and not name.startswith("__"):
                            continue
                        line = content[:match.start()].count("\n") + 1
                        repo_map.symbols.append(Symbol(name=name, kind=kind, file=rel_path, line=line))

            except (PermissionError, OSError, UnicodeDecodeError):
                continue

        if file_count >= max_files:
            break

    repo_map.files_scanned = file_count
    repo_map.scan_time = time.time() - start
    log.info("Repo map: scanned %d files, found %d symbols in %.1fs", file_count, len(repo_map.symbols), repo_map.scan_time)
    return repo_map


def format_map(repo_map: RepoMap, max_tokens: int = 4000) -> str:
    """Format the repo map as a condensed string for agent injection."""
    if not repo_map.symbols:
        return f"# Repository Map ({repo_map.root})\nNo symbols found."

    # Group by file
    by_file: dict[str, list[Symbol]] = {}
    for s in repo_map.symbols:
        by_file.setdefault(s.file, []).append(s)

    lines = [f"# Repository Map ({repo_map.files_scanned} files, {len(repo_map.symbols)} symbols)"]
    char_budget = max_tokens * 4  # rough token-to-char ratio

    for filepath in sorted(by_file.keys()):
        symbols = by_file[filepath]
        file_line = f"\n## {filepath}"
        sym_lines = []
        for s in sorted(symbols, key=lambda x: x.line):
            sym_lines.append(f"  {s.kind}: {s.name} (L{s.line})")

        entry = file_line + "\n" + "\n".join(sym_lines)
        if len("\n".join(lines)) + len(entry) > char_budget:
            lines.append(f"\n... ({len(by_file) - len(lines) + 1} more files)")
            break
        lines.append(entry)

    return "\n".join(lines)


def to_json(repo_map: RepoMap) -> dict:
    """Convert repo map to JSON for API response."""
    by_file: dict[str, list[dict]] = {}
    for s in repo_map.symbols:
        by_file.setdefault(s.file, []).append({
            "name": s.name, "kind": s.kind, "line": s.line,
        })
    return {
        "root": repo_map.root,
        "files_scanned": repo_map.files_scanned,
        "symbol_count": len(repo_map.symbols),
        "scan_time_ms": int(repo_map.scan_time * 1000),
        "files": {k: v for k, v in sorted(by_file.items())},
    }
