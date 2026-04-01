"""Document Parser — extracts text from PDF, DOCX, and plain text files.

Provides chunking for RAG pipelines and context injection into agent prompts.
No external dependencies required — uses built-in libraries where possible.
"""

from __future__ import annotations

import io
import json
import logging
import re
import zipfile
from pathlib import Path

log = logging.getLogger(__name__)


def extract_text(file_bytes: bytes, filename: str) -> str:
    """Extract plain text from a document file.

    Supports: .txt, .md, .json, .csv, .py, .js, .ts, .html, .xml, .docx, .pdf (basic)
    """
    ext = Path(filename).suffix.lower()

    if ext in ('.txt', '.md', '.py', '.js', '.ts', '.tsx', '.jsx', '.css', '.html',
               '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.sh', '.bash',
               '.rs', '.go', '.java', '.c', '.cpp', '.h', '.rb', '.php', '.sql',
               '.r', '.swift', '.kt', '.scala', '.lua', '.pl', '.csv', '.log'):
        return file_bytes.decode('utf-8', errors='replace')

    if ext == '.json':
        try:
            data = json.loads(file_bytes.decode('utf-8', errors='replace'))
            return json.dumps(data, indent=2)
        except json.JSONDecodeError:
            return file_bytes.decode('utf-8', errors='replace')

    if ext == '.docx':
        return _extract_docx(file_bytes)

    if ext == '.pdf':
        return _extract_pdf_basic(file_bytes)

    return file_bytes.decode('utf-8', errors='replace')


def chunk_text(text: str, chunk_size: int = 2000, overlap: int = 200) -> list[dict]:
    """Split text into overlapping chunks for RAG processing.

    Args:
        text: The full text to chunk
        chunk_size: Target size per chunk in characters
        overlap: Number of overlapping characters between chunks

    Returns:
        List of dicts with 'index', 'text', 'start', 'end' keys
    """
    if len(text) <= chunk_size:
        return [{"index": 0, "text": text, "start": 0, "end": len(text)}]

    chunks = []
    start = 0
    index = 0

    while start < len(text):
        end = start + chunk_size

        # Try to break at a paragraph or sentence boundary
        if end < len(text):
            # Look for paragraph break
            para_break = text.rfind('\n\n', start + chunk_size // 2, end)
            if para_break > start:
                end = para_break + 2
            else:
                # Look for sentence break
                sent_break = text.rfind('. ', start + chunk_size // 2, end)
                if sent_break > start:
                    end = sent_break + 2

        chunk_text_str = text[start:end].strip()
        if chunk_text_str:
            chunks.append({
                "index": index,
                "text": chunk_text_str,
                "start": start,
                "end": min(end, len(text)),
            })
            index += 1

        start = end - overlap
        if start >= len(text):
            break

    return chunks


def summarize_document(text: str, max_length: int = 500) -> str:
    """Create a brief summary of a document's content."""
    lines = text.strip().split('\n')
    non_empty = [line.strip() for line in lines if line.strip()]

    # Extract headers (markdown or uppercase lines)
    headers = [line for line in non_empty[:50] if line.startswith('#') or (line.isupper() and len(line) < 80)]

    summary_parts = []
    if headers:
        summary_parts.append("Sections: " + ", ".join(h.lstrip('#').strip() for h in headers[:10]))

    summary_parts.append(f"Length: {len(text):,} chars, {len(non_empty)} lines")

    # First meaningful paragraph
    for line in non_empty[:10]:
        if len(line) > 30 and not line.startswith('#'):
            summary_parts.append("Preview: " + line[:200])
            break

    return " | ".join(summary_parts)[:max_length]


# ── Format-specific extractors ─────────────────────────────────────

def _extract_docx(file_bytes: bytes) -> str:
    """Extract text from a DOCX file using zipfile (no dependencies)."""
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
            if 'word/document.xml' not in zf.namelist():
                return "(DOCX: no document.xml found)"

            xml_content = zf.read('word/document.xml').decode('utf-8', errors='replace')

            # Simple XML text extraction — strip all tags, keep text
            # Remove XML tags but preserve paragraph breaks
            text = re.sub(r'<w:p[^>]*>', '\n', xml_content)
            text = re.sub(r'<[^>]+>', '', text)
            text = re.sub(r'&amp;', '&', text)
            text = re.sub(r'&lt;', '<', text)
            text = re.sub(r'&gt;', '>', text)
            text = re.sub(r'&quot;', '"', text)
            text = re.sub(r'&apos;', "'", text)
            text = re.sub(r'\n{3,}', '\n\n', text)

            return text.strip()
    except Exception as e:
        log.warning("DOCX extraction failed: %s", e)
        return f"(DOCX extraction failed: {e})"


def _extract_pdf_basic(file_bytes: bytes) -> str:
    """Basic PDF text extraction without external dependencies.

    Extracts text from simple PDFs. For complex PDFs with images,
    tables, or encrypted content, consider using PyMuPDF or pdfplumber.
    """
    try:
        content = file_bytes.decode('latin-1', errors='replace')

        # Find all text streams in the PDF
        texts = []
        # Look for text between BT (begin text) and ET (end text) markers
        for match in re.finditer(r'BT\s*(.*?)\s*ET', content, re.DOTALL):
            block = match.group(1)
            # Extract text from Tj and TJ operators
            for text_match in re.finditer(r'\((.*?)\)\s*Tj', block):
                texts.append(text_match.group(1))
            for text_match in re.finditer(r'\[(.*?)\]\s*TJ', block):
                # TJ arrays contain strings and positioning
                for part in re.finditer(r'\((.*?)\)', text_match.group(1)):
                    texts.append(part.group(1))

        if texts:
            return '\n'.join(texts)

        return "(PDF: could not extract text — may be image-based or encrypted. Install PyMuPDF for better extraction.)"
    except Exception as e:
        log.warning("PDF extraction failed: %s", e)
        return f"(PDF extraction failed: {e})"
