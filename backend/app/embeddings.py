"""Lightweight semantic vector helpers for dataset summaries.

This module keeps the prototype dependency-light by default. If
`sentence-transformers` is available, it will be used automatically; otherwise
it falls back to a deterministic hashed vector representation that still
supports cosine-similarity search and in-memory indexing.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
import hashlib
import math
import re
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from .models import DatasetSummary


TOKEN_PATTERN = re.compile(r"[\w\u00C0-\u017F'-]+", re.UNICODE)
VECTOR_DIMENSION = 256


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").lower()).strip()


def tokenize(text: str) -> List[str]:
    return [token.lower() for token in TOKEN_PATTERN.findall(normalize_text(text)) if len(token) > 1]


def summarize_to_text(summary: DatasetSummary) -> str:
    column_bits = []
    for column in summary.columns or []:
        if isinstance(column, dict):
            name = str(column.get("name", ""))
            description = str(column.get("description", ""))
            inferred_type = str(column.get("inferred_type", ""))
            column_bits.append(" ".join(part for part in [name, inferred_type, description] if part))

    sample_bits = []
    for row in (summary.sample_rows or [])[:5]:
        if isinstance(row, dict):
            sample_bits.append(" ".join(f"{key} {value}" for key, value in row.items()))

    parts = [
        summary.title,
        summary.description,
        " ".join(summary.tags or []),
        " ".join(summary.risk_notes or []),
        " ".join(summary.recommended_usage or []),
        " ".join(column_bits),
        " ".join(sample_bits),
        summary.source,
        summary.source_url,
        summary.geo_coverage.get("name", "") if isinstance(summary.geo_coverage, dict) else "",
        summary.time_coverage.get("name", "") if isinstance(summary.time_coverage, dict) else "",
    ]
    return normalize_text(" ".join(part for part in parts if part))


class _BaseEmbeddingBackend:
    def encode(self, text: str) -> List[float]:
        raise NotImplementedError


class _SentenceTransformerBackend(_BaseEmbeddingBackend):
    def __init__(self) -> None:
        from sentence_transformers import SentenceTransformer  # type: ignore

        self.model = SentenceTransformer("all-MiniLM-L6-v2")

    def encode(self, text: str) -> List[float]:
        vector = self.model.encode([text], normalize_embeddings=True)[0]
        return [float(value) for value in vector]


class _HashedEmbeddingBackend(_BaseEmbeddingBackend):
    def __init__(self, dimension: int = VECTOR_DIMENSION) -> None:
        self.dimension = dimension

    def encode(self, text: str) -> List[float]:
        tokens = tokenize(text)
        vector = [0.0] * self.dimension
        if not tokens:
            return vector

        counts = Counter(tokens)
        for token, count in counts.items():
            digest = hashlib.sha1(token.encode("utf-8")).hexdigest()
            index = int(digest[:8], 16) % self.dimension
            vector[index] += float(count)

        norm = math.sqrt(sum(value * value for value in vector)) or 1.0
        return [value / norm for value in vector]


@lru_cache(maxsize=1)
def get_embedding_backend() -> _BaseEmbeddingBackend:
    try:
        return _SentenceTransformerBackend()
    except Exception:
        return _HashedEmbeddingBackend()


def cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    if not left or not right:
        return 0.0
    shared = min(len(left), len(right))
    if shared == 0:
        return 0.0
    numerator = sum(left[index] * right[index] for index in range(shared))
    left_norm = math.sqrt(sum(value * value for value in left[:shared]))
    right_norm = math.sqrt(sum(value * value for value in right[:shared]))
    denominator = left_norm * right_norm
    if denominator == 0:
        return 0.0
    return float(numerator / denominator)


def encode_text(text: str) -> List[float]:
    return get_embedding_backend().encode(normalize_text(text))


def similarity_for_summary(summary: DatasetSummary, query_text: str, extra_terms: Optional[Sequence[str]] = None) -> float:
    parts = [query_text]
    if extra_terms:
        parts.extend(extra_terms)
    query_vector = encode_text(" ".join(parts))
    summary_vector = encode_text(summarize_to_text(summary))
    return cosine_similarity(query_vector, summary_vector)


@dataclass(slots=True)
class SemanticMatch:
    summary: DatasetSummary
    score: float


class SummaryVectorIndex:
    """Tiny in-memory vector index for dataset summaries."""

    def __init__(self, summaries: Optional[Iterable[DatasetSummary]] = None) -> None:
        self._items: List[Tuple[DatasetSummary, List[float]]] = []
        if summaries:
            self.add_summaries(summaries)

    def add_summaries(self, summaries: Iterable[DatasetSummary]) -> None:
        for summary in summaries:
            self._items.append((summary, encode_text(summarize_to_text(summary))))

    def search(self, query: str, limit: int = 10, extra_terms: Optional[Sequence[str]] = None) -> List[SemanticMatch]:
        query_vector = encode_text(" ".join([query, *(extra_terms or [])]))
        ranked: List[SemanticMatch] = []

        for summary, vector in self._items:
            score = cosine_similarity(query_vector, vector)
            if score > 0:
                ranked.append(SemanticMatch(summary=summary, score=round(score, 4)))

        ranked.sort(key=lambda item: item.score, reverse=True)
        return ranked[:limit]


def build_summary_index(summaries: Sequence[DatasetSummary]) -> SummaryVectorIndex:
    return SummaryVectorIndex(summaries)


def semantic_search_summaries(
    query: str,
    summaries: Sequence[DatasetSummary],
    limit: int = 10,
    extra_terms: Optional[Sequence[str]] = None,
) -> List[SemanticMatch]:
    return build_summary_index(summaries).search(query=query, limit=limit, extra_terms=extra_terms)
