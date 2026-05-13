"""Theme extraction and confidence scoring."""
from __future__ import annotations

from collections import defaultdict
import re
from typing import Dict, List, Tuple

from ..themes import _normalize_text, extract_themes as extract_themes_simple, load_theme_glossary


def extract_themes_with_confidence(text: str, top_n: int = 5) -> Tuple[Dict[str, float], str]:
    """Keyword-based theme extraction with normalized confidence scores."""
    if not text:
        return {}, "keywords"

    glossary = load_theme_glossary()
    txt = _normalize_text(text)
    if not txt:
        return {}, "keywords"

    hits: Dict[str, float] = defaultdict(float)
    for theme_id, keywords in glossary.items():
        for kw in keywords:
            normalized_keyword = _normalize_text(kw)
            if not normalized_keyword:
                continue
            if " " in normalized_keyword:
                if normalized_keyword in txt:
                    hits[theme_id] += 2.0
            elif re.search(rf"\b{re.escape(normalized_keyword)}\b", txt):
                hits[theme_id] += 1.0

    if not hits:
        return {}, "keywords"

    max_hits = max(hits.values())
    theme_confidence = {
        theme_id: round(max(score / max_hits, 0.55), 2)
        for theme_id, score in hits.items()
    }
    sorted_themes = sorted(theme_confidence.items(), key=lambda item: item[1], reverse=True)[:top_n]
    return {theme_id: score for theme_id, score in sorted_themes}, "keywords"


def fallback_theme_confidence(text: str) -> Tuple[List[str], Dict[str, float]]:
    """Return fallback keyword themes with uniform confidence."""
    simple_themes = extract_themes_simple(text)
    return simple_themes, {theme: 0.6 for theme in simple_themes}
