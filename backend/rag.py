"""RAG Pipeline — document upload, chunking, and retrieval.

Supports: .txt, .md, .py, .ts, .js, .json, .csv, .html, .css, .go, .rs, .java
Chunking: fixed-size with overlap
Search: TF-IDF cosine similarity (lightweight, no external deps)
Storage: per-channel document context in SQLite-backed JSON files
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
import time
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = {
    ".txt", ".md", ".py", ".ts", ".tsx", ".js", ".jsx", ".json",
    ".csv", ".html", ".css", ".go", ".rs", ".java", ".c", ".cpp",
    ".h", ".rb", ".sh", ".yaml", ".yml", ".toml", ".xml", ".sql",
}
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB
CHUNK_SIZE = 500  # characters
CHUNK_OVERLAP = 100


_STOP_WORDS = frozenset(
    "a an and are as at be by for from has have he in is it its of on or "
    "that the to was were will with this not but they all can had her was "
    "one our out you day been few get has him his how its may new now old".split()
)


def _tokenize(text: str) -> list[str]:
    words = re.findall(r'\b[a-z]{2,}\b', text.lower())
    return [w for w in words if w not in _STOP_WORDS]


@dataclass
class Chunk:
    """A text chunk from a document."""
    id: str
    doc_id: str
    text: str
    start: int  # character offset in original doc
    tokens: list[str] = field(default_factory=list)


@dataclass
class Document:
    """An uploaded document."""
    doc_id: str
    filename: str
    channel: str
    size: int
    chunk_count: int
    uploaded_at: float = field(default_factory=time.time)
    uploaded_by: str = "system"


class RAGPipeline:
    """Document upload, chunking, and retrieval-augmented generation."""

    def __init__(self, data_dir: str | Path):
        self.data_dir = Path(data_dir) / "rag"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._documents: dict[str, Document] = {}
        self._chunks: dict[str, Chunk] = {}
        self._idf: dict[str, float] = {}
        self._doc_count = 0
        self._word_doc_count: Counter = Counter()
        self._load()

    def upload(self, filename: str, content: str, channel: str = "general", uploaded_by: str = "system") -> dict:
        """Upload a document: chunk it and index for retrieval."""
        ext = Path(filename).suffix.lower()
        if ext not in SUPPORTED_EXTENSIONS:
            return {"error": f"Unsupported file type: {ext}"}
        if len(content) > MAX_FILE_SIZE:
            return {"error": f"File too large: {len(content)} bytes (max {MAX_FILE_SIZE})"}
        if not content.strip():
            return {"error": "Empty file"}

        doc_id = f"{channel}:{filename}:{int(time.time())}"

        # Chunk the document
        chunks = self._chunk_text(content, doc_id)

        doc = Document(
            doc_id=doc_id,
            filename=filename,
            channel=channel,
            size=len(content),
            chunk_count=len(chunks),
            uploaded_by=uploaded_by,
        )
        self._documents[doc_id] = doc

        # Index chunks
        for chunk in chunks:
            self._chunks[chunk.id] = chunk
            self._doc_count += 1
            for t in set(chunk.tokens):
                self._word_doc_count[t] += 1

        self._rebuild_idf()
        self._save()

        log.info("RAG: uploaded %s (%d chunks) to #%s", filename, len(chunks), channel)
        return {"doc_id": doc_id, "chunks": len(chunks), "filename": filename}

    def search(self, query: str, channel: str | None = None, limit: int = 5) -> list[dict]:
        """Search for relevant chunks across uploaded documents."""
        query_tokens = _tokenize(query)
        if not query_tokens:
            return []

        query_vec = self._tfidf_vector(query_tokens)
        results = []

        for chunk in self._chunks.values():
            # Filter by channel if specified
            doc = self._documents.get(chunk.doc_id)
            if channel and doc and doc.channel != channel:
                continue

            chunk_vec = self._tfidf_vector(chunk.tokens)
            score = self._cosine_similarity(query_vec, chunk_vec)
            if score > 0.05:
                results.append({
                    "chunk_id": chunk.id,
                    "doc_id": chunk.doc_id,
                    "filename": doc.filename if doc else "unknown",
                    "text": chunk.text,
                    "score": round(score, 4),
                    "channel": doc.channel if doc else "",
                })

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:limit]

    def get_context(self, query: str, channel: str | None = None, max_tokens: int = 2000) -> str:
        """Get relevant context for a query, formatted for injection into agent prompt."""
        results = self.search(query, channel, limit=8)
        if not results:
            return ""

        context_parts = []
        total_chars = 0
        for r in results:
            if total_chars + len(r["text"]) > max_tokens * 4:  # rough char-to-token ratio
                break
            context_parts.append(f"[{r['filename']}] {r['text']}")
            total_chars += len(r["text"])

        return "\n---\n".join(context_parts)

    def list_documents(self, channel: str | None = None) -> list[dict]:
        """List all uploaded documents."""
        docs = self._documents.values()
        if channel:
            docs = [d for d in docs if d.channel == channel]
        return [
            {
                "doc_id": d.doc_id,
                "filename": d.filename,
                "channel": d.channel,
                "size": d.size,
                "chunks": d.chunk_count,
                "uploaded_at": d.uploaded_at,
                "uploaded_by": d.uploaded_by,
            }
            for d in docs
        ]

    def delete_document(self, doc_id: str) -> bool:
        """Delete a document and its chunks."""
        doc = self._documents.pop(doc_id, None)
        if not doc:
            return False
        # Remove chunks
        to_remove = [cid for cid, c in self._chunks.items() if c.doc_id == doc_id]
        for cid in to_remove:
            chunk = self._chunks.pop(cid)
            self._doc_count -= 1
            for t in set(chunk.tokens):
                self._word_doc_count[t] = max(0, self._word_doc_count[t] - 1)
        self._rebuild_idf()
        self._save()
        return True

    def _chunk_text(self, text: str, doc_id: str) -> list[Chunk]:
        """Split text into overlapping chunks."""
        chunks = []
        i = 0
        idx = 0
        while i < len(text):
            end = min(i + CHUNK_SIZE, len(text))
            chunk_text = text[i:end]
            tokens = _tokenize(chunk_text)
            chunks.append(Chunk(
                id=f"{doc_id}:chunk-{idx}",
                doc_id=doc_id,
                text=chunk_text,
                start=i,
                tokens=tokens,
            ))
            idx += 1
            i += CHUNK_SIZE - CHUNK_OVERLAP
        return chunks

    def _tfidf_vector(self, tokens: list[str]) -> dict[str, float]:
        tf = Counter(tokens)
        total = len(tokens) or 1
        return {w: (c / total) * self._idf.get(w, 1.0) for w, c in tf.items()}

    def _cosine_similarity(self, a: dict[str, float], b: dict[str, float]) -> float:
        keys = set(a) & set(b)
        if not keys:
            return 0.0
        dot = sum(a[k] * b[k] for k in keys)
        na = math.sqrt(sum(v * v for v in a.values()))
        nb = math.sqrt(sum(v * v for v in b.values()))
        return dot / (na * nb) if na and nb else 0.0

    def _rebuild_idf(self):
        if self._doc_count == 0:
            self._idf = {}
            return
        self._idf = {w: math.log(self._doc_count / (1 + c)) for w, c in self._word_doc_count.items()}

    def _save(self):
        path = self.data_dir / "rag_index.json"
        data = {
            "documents": {
                did: {"filename": d.filename, "channel": d.channel, "size": d.size,
                      "chunk_count": d.chunk_count, "uploaded_at": d.uploaded_at, "uploaded_by": d.uploaded_by}
                for did, d in self._documents.items()
            },
            "chunks": {
                cid: {"doc_id": c.doc_id, "text": c.text, "start": c.start}
                for cid, c in self._chunks.items()
            },
        }
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data))
        tmp.replace(path)

    def _load(self):
        path = self.data_dir / "rag_index.json"
        if not path.exists():
            return
        try:
            data = json.loads(path.read_text())
            for did, d in data.get("documents", {}).items():
                self._documents[did] = Document(doc_id=did, **d)
            for cid, c in data.get("chunks", {}).items():
                tokens = _tokenize(c["text"])
                self._chunks[cid] = Chunk(id=cid, doc_id=c["doc_id"], text=c["text"], start=c["start"], tokens=tokens)
                self._doc_count += 1
                for t in set(tokens):
                    self._word_doc_count[t] += 1
            self._rebuild_idf()
            log.info("RAG index loaded: %d documents, %d chunks", len(self._documents), len(self._chunks))
        except Exception as e:
            log.warning("Failed to load RAG index: %s", e)
