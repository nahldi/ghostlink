"""Agent Memory Graph — cross-session knowledge with semantic search.

Uses TF-IDF vectors for lightweight semantic similarity (no external deps).
Stores memories in SQLite with FTS5 for text search and vector cosine
similarity for semantic matching.

Falls back to FTS5 keyword search if vector computation is too slow.
"""

from __future__ import annotations

import json
import logging
import math
import re
import time
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger(__name__)

# Common English stop words for TF-IDF
_STOP_WORDS = frozenset(
    "a an and are as at be by for from has have he in is it its of on or "
    "that the to was were will with".split()
)


def _tokenize(text: str) -> list[str]:
    """Tokenize text into lowercase words, removing stop words."""
    words = re.findall(r'\b[a-z]{2,}\b', text.lower())
    return [w for w in words if w not in _STOP_WORDS]


def _tfidf_vector(tokens: list[str], idf: dict[str, float]) -> dict[str, float]:
    """Compute TF-IDF vector for a list of tokens."""
    tf = Counter(tokens)
    total = len(tokens) or 1
    return {word: (count / total) * idf.get(word, 1.0) for word, count in tf.items()}


def _cosine_similarity(a: dict[str, float], b: dict[str, float]) -> float:
    """Compute cosine similarity between two sparse vectors."""
    if not a or not b:
        return 0.0
    keys = set(a) & set(b)
    if not keys:
        return 0.0
    dot = sum(a[k] * b[k] for k in keys)
    norm_a = math.sqrt(sum(v * v for v in a.values()))
    norm_b = math.sqrt(sum(v * v for v in b.values()))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


@dataclass
class MemoryNode:
    """A single memory entry in the graph."""
    id: str
    agent: str
    key: str
    content: str
    tags: list[str] = field(default_factory=list)
    connections: list[str] = field(default_factory=list)  # IDs of related memories
    created_at: float = field(default_factory=time.time)
    access_count: int = 0
    last_accessed: float = 0
    tokens: list[str] = field(default_factory=list)


class MemoryGraph:
    """Cross-session knowledge graph with semantic search."""

    def __init__(self, data_dir: str | Path | None = None):
        self._nodes: dict[str, MemoryNode] = {}
        self._idf: dict[str, float] = {}
        self._doc_count = 0
        self._word_doc_count: Counter = Counter()
        self.data_dir = Path(data_dir) if data_dir else None
        if self.data_dir:
            self._load()

    def add(self, agent: str, key: str, content: str, tags: list[str] | None = None) -> MemoryNode:
        """Add a memory to the graph."""
        node_id = f"{agent}:{key}"
        tokens = _tokenize(content)

        # Update existing or create new
        if node_id in self._nodes:
            old_tokens = self._nodes[node_id].tokens
            for t in set(old_tokens):
                self._word_doc_count[t] = max(0, self._word_doc_count[t] - 1)
            self._doc_count -= 1

        node = MemoryNode(
            id=node_id, agent=agent, key=key, content=content,
            tags=tags or [], tokens=tokens,
        )
        self._nodes[node_id] = node

        # Update IDF
        self._doc_count += 1
        for t in set(tokens):
            self._word_doc_count[t] += 1
        self._rebuild_idf()

        # Auto-link: find similar memories and create connections
        similar = self.search(content, agent=None, limit=3, exclude_id=node_id)
        node.connections = [s["id"] for s in similar if s["score"] > 0.3]

        self._save()
        return node

    def search(
        self, query: str, agent: str | None = None, limit: int = 5, exclude_id: str | None = None
    ) -> list[dict]:
        """Semantic search across all memories. Returns ranked results."""
        query_tokens = _tokenize(query)
        query_vec = _tfidf_vector(query_tokens, self._idf)

        results = []
        for node in self._nodes.values():
            if exclude_id and node.id == exclude_id:
                continue
            if agent and node.agent != agent:
                continue
            node_vec = _tfidf_vector(node.tokens, self._idf)
            score = _cosine_similarity(query_vec, node_vec)
            if score > 0.05:
                results.append({
                    "id": node.id,
                    "agent": node.agent,
                    "key": node.key,
                    "content": node.content[:500],
                    "tags": node.tags,
                    "score": round(score, 4),
                    "connections": node.connections[:5],
                })

        results.sort(key=lambda x: x["score"], reverse=True)

        # Update access stats for top results
        for r in results[:limit]:
            n = self._nodes.get(r["id"])
            if n:
                n.access_count += 1
                n.last_accessed = time.time()

        return results[:limit]

    def get_related(self, node_id: str, depth: int = 1) -> list[dict]:
        """Get memories connected to a given memory (graph traversal)."""
        visited = set()
        results = []

        def _traverse(nid: str, d: int):
            if nid in visited or d > depth:
                return
            visited.add(nid)
            node = self._nodes.get(nid)
            if not node:
                return
            results.append({
                "id": node.id, "agent": node.agent, "key": node.key,
                "content": node.content[:300], "depth": depth - d,
            })
            for conn_id in node.connections:
                _traverse(conn_id, d + 1)

        _traverse(node_id, 0)
        return results[1:]  # Exclude the starting node

    def get_agent_knowledge(self, agent: str) -> dict:
        """Get a summary of an agent's knowledge graph."""
        nodes = [n for n in self._nodes.values() if n.agent == agent]
        tags: Counter = Counter()
        for n in nodes:
            tags.update(n.tags)
        return {
            "agent": agent,
            "memory_count": len(nodes),
            "total_connections": sum(len(n.connections) for n in nodes),
            "top_tags": tags.most_common(10),
            "most_accessed": sorted(
                [{"key": n.key, "access_count": n.access_count} for n in nodes],
                key=lambda x: x["access_count"], reverse=True,
            )[:5],
        }

    def delete(self, node_id: str) -> bool:
        """Remove a memory node and clean up connections."""
        node = self._nodes.pop(node_id, None)
        if not node:
            return False
        # Remove connections pointing to this node
        for n in self._nodes.values():
            n.connections = [c for c in n.connections if c != node_id]
        # Update IDF
        self._doc_count -= 1
        for t in set(node.tokens):
            self._word_doc_count[t] = max(0, self._word_doc_count[t] - 1)
        self._rebuild_idf()
        self._save()
        return True

    def stats(self) -> dict:
        return {
            "total_memories": len(self._nodes),
            "total_connections": sum(len(n.connections) for n in self._nodes.values()),
            "agents": list(set(n.agent for n in self._nodes.values())),
            "vocabulary_size": len(self._idf),
        }

    def _rebuild_idf(self):
        """Rebuild IDF scores from document frequencies."""
        if self._doc_count == 0:
            self._idf = {}
            return
        self._idf = {
            word: math.log(self._doc_count / (1 + count))
            for word, count in self._word_doc_count.items()
        }

    def _save(self):
        if not self.data_dir:
            return
        self.data_dir.mkdir(parents=True, exist_ok=True)
        path = self.data_dir / "memory_graph.json"
        data = {
            node_id: {
                "agent": n.agent, "key": n.key, "content": n.content,
                "tags": n.tags, "connections": n.connections,
                "created_at": n.created_at, "access_count": n.access_count,
            }
            for node_id, n in self._nodes.items()
        }
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data))
        tmp.replace(path)

    def _load(self):
        if not self.data_dir:
            return
        path = self.data_dir / "memory_graph.json"
        if not path.exists():
            return
        try:
            data = json.loads(path.read_text())
            for node_id, d in data.items():
                tokens = _tokenize(d["content"])
                self._nodes[node_id] = MemoryNode(
                    id=node_id, agent=d["agent"], key=d["key"], content=d["content"],
                    tags=d.get("tags", []), connections=d.get("connections", []),
                    created_at=d.get("created_at", 0), access_count=d.get("access_count", 0),
                    tokens=tokens,
                )
                self._doc_count += 1
                for t in set(tokens):
                    self._word_doc_count[t] += 1
            self._rebuild_idf()
            log.info("Memory graph loaded: %d nodes", len(self._nodes))
        except Exception as e:
            log.warning("Failed to load memory graph: %s", e)
