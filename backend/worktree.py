"""Git worktree manager for Phase 5 multi-agent isolation."""

from __future__ import annotations

import logging
import shutil
import subprocess
import time
from pathlib import Path

log = logging.getLogger(__name__)

_STALE_SECONDS = 1800
_LONG_PATH_WARN = 240


class WorktreeManager:
    """Manage per-agent/task git worktrees keyed by stable agent_id."""

    def __init__(self, base_workspace: str):
        self.base_workspace = Path(base_workspace)
        self._worktrees: dict[str, Path] = {}
        self._agent_id_by_name: dict[str, str] = {}
        self._agent_name_by_id: dict[str, str] = {}

    def _is_git_repo(self) -> bool:
        try:
            result = subprocess.run(
                ["git", "rev-parse", "--is-inside-work-tree"],
                cwd=self.base_workspace,
                capture_output=True,
                text=True,
                timeout=5,
            )
            return result.returncode == 0
        except Exception:
            return False

    def _runtime_root(self) -> Path:
        return self.base_workspace / ".ghostlink"

    def _worktree_root(self) -> Path:
        return self._runtime_root() / "worktrees"

    def _worktree_path(self, agent_id: str) -> Path:
        return self._worktree_root() / agent_id

    def _branch_name(self, agent_id: str, task_id: str | None = None) -> str:
        task_ref = (task_id or "default").strip() or "default"
        return f"ghostlink/{agent_id}/{task_ref}"

    def _sanitize_branch_component(self, value: str | None, fallback: str) -> str:
        cleaned = "".join(ch if ch.isalnum() or ch in ("-", "_", ".") else "-" for ch in (value or "").strip())
        return cleaned.strip("-") or fallback

    def _run_git(self, args: list[str], *, cwd: Path | None = None, timeout: int = 30) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["git", *args],
            cwd=cwd or self.base_workspace,
            capture_output=True,
            text=True,
            timeout=timeout,
        )

    def _remember_identity(self, agent_id: str, agent_name: str | None = None) -> None:
        if agent_name:
            self._agent_id_by_name[agent_name] = agent_id
            self._agent_name_by_id[agent_id] = agent_name

    def _resolve_agent_id(self, identifier: str) -> str:
        return self._agent_id_by_name.get(identifier, identifier)

    def _warn_long_path(self, worktree_dir: Path) -> str | None:
        if len(str(worktree_dir)) < _LONG_PATH_WARN:
            return None
        return (
            f"Worktree path is {len(str(worktree_dir))} chars long. "
            "Windows path-length limits may break creation unless long paths are enabled."
        )

    def create_worktree(self, agent_id: str, task_id: str | None = None, *, agent_name: str | None = None) -> Path | None:
        """Create an isolated worktree keyed by stable agent_id."""
        if not self._is_git_repo():
            log.info("Not a git repo; agent %s will use shared workspace", agent_name or agent_id)
            return None

        canonical_id = self._resolve_agent_id(agent_id)
        clean_agent_id = self._sanitize_branch_component(canonical_id, "agent")
        clean_task_id = self._sanitize_branch_component(task_id, "default") if task_id else None
        worktree_dir = self._worktree_path(clean_agent_id)
        branch_name = self._branch_name(clean_agent_id, clean_task_id)
        self._remember_identity(clean_agent_id, agent_name)

        try:
            if worktree_dir.exists():
                self.remove_worktree(clean_agent_id, force=True)

            warning = self._warn_long_path(worktree_dir)
            if warning:
                log.warning(warning)

            worktree_dir.parent.mkdir(parents=True, exist_ok=True)
            self._runtime_root().mkdir(parents=True, exist_ok=True)

            result = self._run_git(["worktree", "add", "-b", branch_name, str(worktree_dir), "HEAD"])
            if result.returncode != 0:
                result = self._run_git(["worktree", "add", str(worktree_dir), branch_name])
            if result.returncode != 0:
                log.warning("Failed to create worktree for %s: %s", clean_agent_id, result.stderr.strip())
                return None

            self._run_git(["config", "core.longpaths", "true"], cwd=worktree_dir, timeout=10)
            self._worktrees[clean_agent_id] = worktree_dir
            log.info("Created worktree for %s at %s", clean_agent_id, worktree_dir)
            return worktree_dir
        except Exception as e:
            log.warning("Worktree creation error for %s: %s", clean_agent_id, e)
            return None

    def remove_worktree(self, agent_id: str, *, force: bool = False) -> bool:
        """Remove a worktree after it is merged or explicitly discarded."""
        canonical_id = self._resolve_agent_id(agent_id)
        worktree_dir = self._worktrees.get(canonical_id) or self._worktree_path(canonical_id)
        if worktree_dir.exists() and not force:
            status = self._run_git(["status", "--porcelain"], cwd=worktree_dir, timeout=10)
            if status.returncode == 0 and status.stdout.strip():
                log.info("Preserving worktree for %s; dirty tree requires explicit force", canonical_id)
                return False

        branch_prefix = self._branch_name(canonical_id).rsplit("/", 1)[0]
        try:
            self._run_git(["worktree", "remove", str(worktree_dir), "--force"], timeout=15)
            self._run_git(["worktree", "prune"], timeout=5)
            branch_list = self._run_git(["branch", "--list", f"{branch_prefix}/*"], timeout=5)
            if branch_list.returncode == 0:
                for branch in [line.replace("*", "").strip() for line in branch_list.stdout.splitlines() if line.strip()]:
                    self._run_git(["branch", "-D", branch], timeout=5)
            if worktree_dir.exists():
                shutil.rmtree(str(worktree_dir), ignore_errors=True)
            self._worktrees.pop(canonical_id, None)
            log.info("Removed worktree for %s", canonical_id)
            return True
        except Exception as e:
            log.warning("Worktree removal error for %s: %s", canonical_id, e)
            return False

    def get_worktree_path(self, agent_id: str) -> Path | None:
        canonical_id = self._resolve_agent_id(agent_id)
        path = self._worktrees.get(canonical_id)
        if path is not None:
            return path
        candidate = self._worktree_path(canonical_id)
        return candidate if candidate.exists() else None

    def can_merge(self, agent_id: str, *, task_id: str | None = None) -> dict:
        """Dry-run merge probe that leaves the main tree untouched."""
        canonical_id = self._resolve_agent_id(agent_id)
        branch_name = self._branch_name(canonical_id, self._sanitize_branch_component(task_id, "default") if task_id else None)
        branch_result = self._run_git(["rev-parse", "--verify", branch_name], timeout=10)
        if branch_result.returncode != 0:
            return {"clean": False, "conflicting_files": [], "stats": {}, "reason": "branch_missing"}

        stats_result = self._run_git(["diff", "--stat", "HEAD", branch_name], timeout=10)
        stats = {
            "changed_files": len([line for line in stats_result.stdout.splitlines() if "|" in line]),
            "summary": stats_result.stdout.strip(),
        }

        merge_result = self._run_git(["merge", "--no-commit", "--no-ff", branch_name], timeout=30)
        conflicting_files: list[str] = []
        clean = merge_result.returncode == 0
        if not clean:
            conflicting_files = sorted(
                {
                    line.split("\t", 1)[-1].strip()
                    for line in merge_result.stdout.splitlines() + merge_result.stderr.splitlines()
                    if "\t" in line or "CONFLICT (" in line
                }
            )
        abort_result = self._run_git(["merge", "--abort"], timeout=15)
        if not clean and abort_result.returncode != 0:
            log.warning("Merge probe abort failed for %s: %s", canonical_id, abort_result.stderr.strip())
        return {
            "clean": clean,
            "conflicting_files": conflicting_files,
            "stats": stats,
            "reason": "" if clean else (merge_result.stderr.strip() or merge_result.stdout.strip()),
        }

    def merge_changes(self, agent_id: str, *, agent_name: str | None = None, task_id: str | None = None) -> str | None:
        """Merge a clean worktree branch back with an audit-preserving merge commit."""
        canonical_id = self._resolve_agent_id(agent_id)
        worktree_dir = self.get_worktree_path(canonical_id)
        if not worktree_dir or not worktree_dir.exists():
            return None

        clean_task_id = self._sanitize_branch_component(task_id, "default") if task_id else None
        branch_name = self._branch_name(canonical_id, clean_task_id)
        probe = self.can_merge(canonical_id, task_id=clean_task_id)
        if not probe.get("clean"):
            reason = probe.get("reason") or "merge_conflict"
            return f"Merge blocked: {reason}"

        status = self._run_git(["status", "--porcelain"], cwd=worktree_dir, timeout=10)
        if status.returncode == 0 and status.stdout.strip():
            self._run_git(["add", "-A"], cwd=worktree_dir, timeout=10)
            commit_msg = f"ghostlink: snapshot {agent_name or canonical_id}"
            commit = self._run_git(["commit", "-m", commit_msg], cwd=worktree_dir, timeout=20)
            if commit.returncode != 0 and "nothing to commit" not in (commit.stdout + commit.stderr).lower():
                return f"Commit failed: {commit.stderr.strip() or commit.stdout.strip()}"

        merge_msg = f"ghostlink: merge {agent_name or canonical_id} ({canonical_id}) task {clean_task_id or 'default'}"
        merge_result = self._run_git(["merge", branch_name, "--no-ff", "--no-edit", "-m", merge_msg], timeout=30)
        if merge_result.returncode == 0:
            log.info("Merged worktree branch %s for %s", branch_name, canonical_id)
            return merge_msg
        log.warning("Merge error for %s: %s", canonical_id, merge_result.stderr.strip())
        return f"Merge failed: {merge_result.stderr.strip() or merge_result.stdout.strip()}"

    def on_agent_disconnect(self, agent_id: str) -> dict:
        """Preserve worktree state for later operator resolution."""
        canonical_id = self._resolve_agent_id(agent_id)
        worktree_dir = self.get_worktree_path(canonical_id)
        if not worktree_dir:
            return {"agent_id": canonical_id, "action": "none", "reason": "missing_worktree"}
        status = self._run_git(["status", "--porcelain"], cwd=worktree_dir, timeout=10)
        dirty = status.returncode == 0 and bool(status.stdout.strip())
        return {
            "agent_id": canonical_id,
            "action": "preserve",
            "reason": "dirty_worktree" if dirty else "await_operator_resolution",
            "path": str(worktree_dir),
            "dirty": dirty,
        }

    def health_check(self) -> list[dict]:
        """Return health reports for all tracked worktrees."""
        reports: list[dict] = []
        now = time.time()
        worktree_list = self._run_git(["worktree", "list", "--porcelain"], timeout=10)
        valid_paths = {
            line.split(" ", 1)[1].strip()
            for line in worktree_list.stdout.splitlines()
            if line.startswith("worktree ")
        } if worktree_list.returncode == 0 else set()

        for agent_id, path in sorted(self._worktrees.items()):
            exists = path.exists()
            branch = self._branch_name(agent_id)
            last_commit_ts = 0.0
            dirty_count = 0
            disk_usage = 0
            if exists:
                status = self._run_git(["status", "--porcelain"], cwd=path, timeout=10)
                if status.returncode == 0:
                    dirty_count = len([line for line in status.stdout.splitlines() if line.strip()])
                last_commit = self._run_git(["log", "-1", "--format=%ct"], cwd=path, timeout=10)
                if last_commit.returncode == 0 and last_commit.stdout.strip().isdigit():
                    last_commit_ts = float(last_commit.stdout.strip())
                try:
                    disk_usage = sum(p.stat().st_size for p in path.rglob("*") if p.is_file())
                except OSError:
                    disk_usage = 0
                branch_result = self._run_git(["branch", "--show-current"], cwd=path, timeout=10)
                if branch_result.returncode == 0 and branch_result.stdout.strip():
                    branch = branch_result.stdout.strip()
            reports.append(
                {
                    "agent_id": agent_id,
                    "agent_name": self._agent_name_by_id.get(agent_id, ""),
                    "path": str(path),
                    "branch": branch,
                    "exists": exists,
                    "git_valid": str(path) in valid_paths if valid_paths else exists,
                    "last_commit_ts": last_commit_ts,
                    "uncommitted_changes": dirty_count,
                    "stale": bool(last_commit_ts and now - last_commit_ts > _STALE_SECONDS),
                    "disk_usage_bytes": disk_usage,
                }
            )
        return reports

    def list_worktrees(self) -> dict[str, str]:
        return {agent_id: str(path) for agent_id, path in self._worktrees.items()}

    def cleanup_all(self):
        for agent_id in list(self._worktrees.keys()):
            self.remove_worktree(agent_id, force=True)
