"""Shared theme keyword matching helpers."""
from __future__ import annotations

import re
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
    blob = _normalize_text(text)
    for keyword in load_theme_glossary().get(theme_id, []):
        normalized = _normalize_text(keyword)
        if not normalized:
            continue
        if " " in normalized:
            if normalized in blob:
                return True
        elif re.search(rf"\b{re.escape(normalized)}\b", blob):
            return True
    return False


def infer_dataset_theme_overlap(dataset: Dataset, theme_ids: set[str]) -> set[str]:
    """Infer requested theme overlap from dataset text and metadata."""
    blob = dataset_theme_blob(dataset)
    return {
        theme_id
        for theme_id in theme_ids
        if text_matches_theme(blob, theme_id)
    }
