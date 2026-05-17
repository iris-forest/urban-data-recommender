"""Shared theme keyword matching helpers."""
from __future__ import annotations

import re
from functools import lru_cache
from typing import Any, Dict, List, Sequence

from ..models import Dataset
from ..themes import _normalize_text, load_theme_glossary


def append_dict_values(parts: List[str], values: Sequence[Dict[str, Any]], keys: Sequence[str]) -> None:
    """Add selected text values from catalog metadata dictionaries."""
    for value in values:
        if not isinstance(value, dict):
            continue
        for key in keys:
            text = value.get(key)
            if text:
                parts.append(str(text))


def dataset_theme_blob(dataset: Dataset) -> str:
    """Build a normalized text blob for theme inference."""
    category_names: List[str] = []
    for category in dataset.categories:
        if isinstance(category, dict):
            category_names.extend(str(key) for key in category.keys())

    parts = [
        dataset.title,
        dataset.description,
        dataset.provider,
        dataset.primary_category,
        dataset.spatial_coverage,
        dataset.spatial_resolution,
        dataset.update_frequency,
        " ".join(dataset.themes or []),
        " ".join(category_names),
        dataset.source,
    ]
    append_dict_values(parts, dataset.schema_fields or [], ("name", "title", "description", "label"))
    append_dict_values(parts, dataset.preview_resources or [], ("name", "title", "description", "format"))
    return _normalize_text(" ".join(part for part in parts if part))


def text_matches_theme(text: str, theme_id: str) -> bool:
    """Return whether text contains a glossary keyword for a theme."""
    return _normalized_blob_matches_theme(_normalize_text(text), theme_id)


def infer_dataset_theme_overlap(dataset: Dataset, theme_ids: set[str]) -> set[str]:
    """Infer requested theme overlap from dataset text and metadata."""
    if not theme_ids:
        return set()

    blob = dataset_theme_blob(dataset)
    token_set = set(re.findall(r"[\w.-]+", blob))
    return {
        theme_id
        for theme_id in theme_ids
        if _normalized_blob_matches_theme(blob, theme_id, token_set=token_set)
    }


@lru_cache(maxsize=None)
def _normalized_theme_keywords(theme_id: str) -> tuple[str, ...]:
    return tuple(
        normalized
        for keyword in load_theme_glossary().get(theme_id, [])
        for normalized in [_normalize_text(keyword)]
        if normalized
    )


def _normalized_blob_matches_theme(
    blob: str,
    theme_id: str,
    token_set: set[str] | None = None,
) -> bool:
    for keyword in _normalized_theme_keywords(theme_id):
        if " " in keyword:
            if keyword in blob:
                return True
            continue

        if token_set is None:
            token_set = set(re.findall(r"[\w.-]+", blob))

        if keyword in token_set:
            return True

    return False
