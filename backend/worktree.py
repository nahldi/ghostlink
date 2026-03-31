"""Git Worktree Manager — isolates each agent in its own git worktree.

Prevents agents from clobbering each other's file edits by giving each
agent a separate working copy of the repository. Changes merge back to
the main branch on deregister.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path

log = logging.getLogger(__name__)


class WorktreeManager:
    """Manages per-agent git worktrees for file isolation."""

    def __init__(self, base_workspace: str):
        self.base_workspace = Path(base_workspace)
        self._worktrees: dict[str, Path] = {}  # agent_name → worktree path

    def _is_git_repo(self) -> bool:
        """Check if the base workspace is a git repository."""
        try:
            result = subprocess.run(
                ["git", "rev-parse", "--is-inside-work-tree"],
                cwd=self.base_workspace,
                capture_output=True, text=True, timeout=5,
            )
            return result.returncode == 0
        except Exception:
            return False

    def create_worktree(self, agent_name: str) -> Path | None:
        """Create an isolated git worktree for an agent.
        Returns the worktree path, or None if git is not available."""
        if not self._is_git_repo():
            log.info("Not a git repo — agent %s will use shared workspace", agent_name)
            return None

        worktree_dir = self.base_workspace / ".ghostlink-worktrees" / agent_name
        branch_name = f"ghostlink-{agent_name}"

        try:
            # Clean up if exists from previous run
            if worktree_dir.exists():
                self.remove_worktree(agent_name)

            # Create the worktree with a new branch
            worktree_dir.parent.mkdir(parents=True, exist_ok=True)
            result = subprocess.run(
                ["git", "worktree", "add", "-b", branch_name, str(worktree_dir), "HEAD"],
                cwd=self.base_workspace,
                capture_output=True, text=True, timeout=30,
            )

            if result.returncode != 0:
                # Branch may already exist — try without -b
                result = subprocess.run(
                    ["git", "worktree", "add", str(worktree_dir), branch_name],
                    cwd=self.base_workspace,
                    capture_output=True, text=True, timeout=30,
                )

            if result.returncode == 0:
                self._worktrees[agent_name] = worktree_dir
                log.info("Created worktree for %s at %s", agent_name, worktree_dir)
                return worktree_dir
            else:
                log.warning("Failed to create worktree for %s: %s", agent_name, result.stderr)
                return None
        except Exception as e:
            log.warning("Worktree creation error for %s: %s", agent_name, e)
            return None

    def remove_worktree(self, agent_name: str) -> bool:
        """Remove an agent's worktree and clean up the branch."""
        worktree_dir = self._worktrees.pop(agent_name, None)
        if not worktree_dir:
            worktree_dir = self.base_workspace / ".ghostlink-worktrees" / agent_name

        branch_name = f"ghostlink-{agent_name}"

        try:
            # Remove the worktree
            subprocess.run(
                ["git", "worktree", "remove", str(worktree_dir), "--force"],
                cwd=self.base_workspace,
                capture_output=True, text=True, timeout=10,
            )

            # Prune stale worktree references
            subprocess.run(
                ["git", "worktree", "prune"],
                cwd=self.base_workspace,
                capture_output=True, timeout=5,
            )

            # Delete the branch
            subprocess.run(
                ["git", "branch", "-D", branch_name],
                cwd=self.base_workspace,
                capture_output=True, text=True, timeout=5,
            )

            # Clean up directory if still present
            if worktree_dir.exists():
                shutil.rmtree(str(worktree_dir), ignore_errors=True)

            log.info("Removed worktree for %s", agent_name)
            return True
        except Exception as e:
            log.warning("Worktree removal error for %s: %s", agent_name, e)
            return False

    def get_worktree_path(self, agent_name: str) -> Path | None:
        """Get the worktree path for an agent, or None if not using worktrees."""
        return self._worktrees.get(agent_name)

    def merge_changes(self, agent_name: str) -> str | None:
        """Merge an agent's worktree changes back to the main branch.
        Returns the merge commit message, or None if no changes."""
        worktree_dir = self._worktrees.get(agent_name)
        if not worktree_dir or not worktree_dir.exists():
            return None

        branch_name = f"ghostlink-{agent_name}"

        try:
            # Check if there are changes in the worktree
            result = subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=worktree_dir,
                capture_output=True, text=True, timeout=10,
            )
            if not result.stdout.strip():
                return None  # No changes to merge

            # Commit any uncommitted changes in the worktree
            subprocess.run(
                ["git", "add", "-A"],
                cwd=worktree_dir, capture_output=True, timeout=10,
            )
            subprocess.run(
                ["git", "commit", "-m", f"Agent {agent_name} changes via GhostLink"],
                cwd=worktree_dir, capture_output=True, text=True, timeout=15,
            )

            # Merge the branch into the main branch
            merge_result = subprocess.run(
                ["git", "merge", branch_name, "--no-edit"],
                cwd=self.base_workspace,
                capture_output=True, text=True, timeout=30,
            )

            if merge_result.returncode == 0:
                msg = f"Merged {agent_name}'s changes"
                log.info(msg)
                return msg
            else:
                log.warning("Merge conflict for %s: %s", agent_name, merge_result.stderr)
                return f"Merge conflict: {merge_result.stderr[:200]}"
        except Exception as e:
            log.warning("Merge error for %s: %s", agent_name, e)
            return None

    def list_worktrees(self) -> dict[str, str]:
        """List all active agent worktrees."""
        return {name: str(path) for name, path in self._worktrees.items()}

    def cleanup_all(self):
        """Remove all worktrees (on server shutdown)."""
        for agent_name in list(self._worktrees.keys()):
            self.remove_worktree(agent_name)
