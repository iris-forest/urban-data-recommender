"""Mapping registry between external API category systems and internal theme IDs.

This file provides lookup helpers to translate external category labels/URIs
into the internal theme taxonomy used by the recommendation engine.
"""
from __future__ import annotations

from typing import List, Tuple

# Conservative example mappings. Extend as needed.
# Keys are normalized external category labels or short identifiers.
MADRID_CKAN_ORG_MAPPING = {
    "emt madrid": [("transport_networks", 0.95)],
    "urbanismo": [
        ("land_use", 0.9),
        ("geographic_boundaries", 0.8),
    ],
    "movilidad": [("transport_networks", 0.95), ("accessibility_proximity", 0.8)],
    "parques y jardines": [("green_space", 0.95)],
    "gestion del agua y zonas verdes": [("water_management", 0.95), ("green_space", 0.9)],
    "gestión del agua y zonas verdes": [("water_management", 0.95), ("green_space", 0.9)],
    "zonas verdes": [("green_space", 0.95)],
    "cartografia": [("geographic_boundaries", 0.95)],
    "cartografía": [("geographic_boundaries", 0.95)],
}

# datos.gob.es DCAT/theme label examples (labels and small URIs)
DATOS_GOB_THEME_MAPPING = {
    "transporte": [("transport_networks", 0.95)],
    "movilidad": [("transport_networks", 0.95), ("accessibility_proximity", 0.7)],
    "poblacion": [("population", 0.95)],
    "vivienda": [("housing_affordability", 0.95)],
    "gestion del agua y zonas verdes": [("water_management", 0.95), ("green_space", 0.9)],
    "gestión del agua y zonas verdes": [("water_management", 0.95), ("green_space", 0.9)],
    "urbanismo e infraestructuras": [
        ("land_use", 0.85),
        ("geographic_boundaries", 0.75),
    ],
    "territorio": [("geographic_boundaries", 0.85), ("land_use", 0.65)],
    "calidad del aire": [("air_quality", 0.95)],
    "calor": [("heat_exposure", 0.95)],
    "temperatura": [("heat_exposure", 0.95)],
    "clima": [("heat_exposure", 0.8)],
    "salud": [("health", 0.95)],
    "educacion": [("education", 0.95)],
}


def _normalize_label(s: str) -> str:
    if not s:
        return ""
    return s.strip().lower()


def map_madrid_org_label(label: str) -> List[Tuple[str, float]]:
    """Map a Madrid CKAN organization title to internal theme ids.

    Returns a list of (theme_id, confidence) tuples. Empty list if no mapping.
    """
    nl = _normalize_label(label)
    if not nl:
        return []
    # Try exact match, then prefix match
    if nl in MADRID_CKAN_ORG_MAPPING:
        return MADRID_CKAN_ORG_MAPPING[nl]
    for k, v in MADRID_CKAN_ORG_MAPPING.items():
        if k in nl or nl in k:
            return v
    return []


def map_datos_gob_theme_label(label: str) -> List[Tuple[str, float]]:
    """Map a datos.gob.es theme label or URI fragment to internal themes.

    Returns a list of (theme_id, confidence) tuples. Empty list if no mapping.
    """
    nl = _normalize_label(label)
    if not nl:
        return []
    # If the label contains a known token, return mapping
    if nl in DATOS_GOB_THEME_MAPPING:
        return DATOS_GOB_THEME_MAPPING[nl]
    for k, v in DATOS_GOB_THEME_MAPPING.items():
        if k in nl or nl in k:
            return v
    # Attempt to split URI-like values and check last path segment
    if "/" in nl:
        last = nl.split("/")[-1]
        if last in DATOS_GOB_THEME_MAPPING:
            return DATOS_GOB_THEME_MAPPING[last]
    return []


def infer_primary_category_from_themes(themes: List[str]) -> str:
    """Infer a simple human-friendly primary category from internal themes."""
    if not themes:
        return "Other"
    # Simple mapping from theme id to display category
    mapping = {
        "transport_networks": "Transport",
        "accessibility_proximity": "Accessibility",
        "population": "Population",
        "geographic_boundaries": "Geography",
        "housing_affordability": "Housing",
        "green_space": "Environment",
        "air_quality": "Environment",
        "heat_exposure": "Environment",
        "water_management": "Water",
        "land_use": "Land Use, Buildings, and Boundaries",
        "socioeconomic_context": "Socioeconomic",
        "employment": "Economy",
        "health": "Health",
        "education": "Education",
    }
    # Prefer the first known mapping
    for t in themes:
        if t in mapping:
            return mapping[t]
    return "Other"


def infer_categories_from_themes(themes: List[str]) -> List[dict[str, float]]:
    """Infer ordered category tags from internal themes."""
    categories: List[dict[str, float]] = []
    seen = set()

    for index, theme in enumerate(themes):
        category = infer_primary_category_from_themes([theme])
        if category == "Other" or category in seen:
            continue
        seen.add(category)
        categories.append({category: max(0.5, round(1.0 - (index * 0.15), 2))})

    return categories
