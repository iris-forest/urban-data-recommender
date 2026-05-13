"""Theme glossary and improved matching helpers for the planner MVP.

This module prefers a JSON-backed `themes.json` file (editable) and falls
back to an internal `THEMES` constant when the file is absent or invalid.
Extraction uses normalized, phrase-aware matching with a controlled fuzzy
fallback for better precision and recall.
"""
from __future__ import annotations

from typing import Dict, List
import re
import unicodedata
from difflib import get_close_matches


# --- Built-in fallback theme glossary (kept small and readable) ---
THEMES: Dict[str, List[str]] = {
    "accessibility_proximity": [
        "accessibility",
        "accesibilidad",
        "access",
        "proximity",
        "proximidad",
        "service area",
        "service areas",
        "catchment",
        "catchment area",
        "catchment areas",
        "walkability",
        "walking distance",
        "walking time",
        "travel time",
        "15 minute",
        "15-minute",
        "10 minute",
        "10-minute",
        "5 minute",
        "5-minute",
        "nearby",
        "distance",
        "neighbourhood",
        "neighborhood",
        "local",
        "amenity",
        "service",
        "facility",
    ],
    "transport_networks": [
        "transport",
        "transporte",
        "mobility",
        "metro",
        "bus",
        "rail",
        "traffic",
        "roads",
        "stations",
        "commute",
        "public transit",
        "subway",
        "tram",
        "public transport",
        "public transportation",
        "cycling",
        "cyclist",
        "bicycle",
        "bicycles",
        "bike",
        "bike lane",
        "bike lanes",
        "cycle lane",
        "cycle lanes",
        "carril bici",
        "pedestrian",
        "sidewalk",
        "sidewalks",
    ],
    "population": [
        "population",
        "poblacion",
        "población",
        "residents",
        "resident",
        "census",
        "demographic",
        "people",
        "inhabitants",
        "households",
        "older adults",
        "older adult",
        "seniors",
        "senior citizens",
        "elderly",
    ],
    "geographic_boundaries": [
        "administrative boundary",
        "administrative boundaries",
        "district boundary",
        "district boundaries",
        "neighborhood boundary",
        "neighborhood boundaries",
        "neighbourhood boundary",
        "neighbourhood boundaries",
        "municipal boundary",
        "municipal boundaries",
        "boundary",
        "boundaries",
        "polygon",
        "polygons",
        "shapefile",
        "spatial join",
        "census section",
        "census sections",
        "census tract",
        "census tracts",
        "seccion censal",
        "secciones censales",
        "limites administrativos",
        "límites administrativos",
        "cartografia",
        "cartografía",
        "geodata",
    ],
    "housing_affordability": ["housing", "vivienda", "rent", "alquiler", "affordability", "residential", "apartment", "home", "homes"],
    "green_space": [
        "green space",
        "green spaces",
        "parques y zonas verdes",
        "superficie de parques",
        "superficie ocupada por parques",
        "zonas verdes urbanas",
        "parques y jardines",
        "zonas verdes",
        "zona verde",
        "green area",
        "green areas",
        "areas verdes",
        "area verde",
        "jardines",
        "greenspace",
        "parks",
        "park",
        "public park",
        "open space",
        "urban forest",
        "tree canopy",
        "canopy cover",
        "shade",
        "shaded",
        "vegetation",
        "playground",
        "playgrounds",
        "garden",
        "gardens",
        "parque",
        "arbolado",
        "sombra",
    ],
    "water_management": [
        "water management",
        "water",
        "stormwater",
        "storm water",
        "wastewater",
        "waste water",
        "drainage",
        "sewer",
        "sewers",
        "sewerage",
        "irrigation",
        "flood",
        "flooding",
        "flood risk",
        "reservoir",
        "drinking water",
        "agua",
        "gestion del agua",
        "gestión del agua",
        "saneamiento",
        "alcantarillado",
        "drenaje",
        "riego",
        "inundacion",
        "inundación",
    ],
    "air_quality": [
        "air quality",
        "calidad del aire",
        "pollution",
        "pm2.5",
        "no2",
        "nitrogen dioxide",
        "emissions",
        "emission",
        "low emission",
        "low-emission",
        "low emission zone",
        "low-emission zone",
        "low-emission zones",
    ],
    "heat_exposure": [
        "heat",
        "urban heat",
        "heat island",
        "urban heat island",
        "heat exposure",
        "extreme heat",
        "temperature",
        "surface temperature",
        "thermal comfort",
        "cooling",
        "calor",
        "isla de calor",
        "temperatura",
    ],
    "land_use": [
        "land use",
        "land-use",
        "zoning",
        "parcel",
        "parcels",
        "cadastre",
        "cadastral",
        "building footprint",
        "building footprints",
        "urban form",
        "urban planning",
        "planning",
        "usos del suelo",
        "uso del suelo",
        "clasificacion del suelo",
        "clasificación del suelo",
        "planeamiento urbanistico",
        "planeamiento urbanístico",
        "catastro",
        "urbanismo",
        "built environment",
        "impervious",
        "impervious surface",
        "sealed surface",
        "building density",
        "floor area",
    ],
    "socioeconomic_context": [
        "socioeconomic",
        "socio-economic",
        "income",
        "renta",
        "deprivation",
        "vulnerability",
        "vulnerabilidad",
        "poverty",
        "pobreza",
        "equity",
        "inequality",
        "desigualdad",
        "social vulnerability",
        "heat vulnerability",
        "climate vulnerability",
    ],
    "employment": ["employment", "empleo", "jobs", "unemployment", "labor", "workforce"],
    "health": [
        "health",
        "salud",
        "healthcare",
        "health care",
        "hospital",
        "hospitals",
        "clinic",
        "clinics",
        "primary care",
        "health center",
        "health centre",
        "centro de salud",
        "mortality",
        "wellbeing",
        "patient",
    ],
    "education": [
        "education",
        "educacion",
        "educación",
        "school",
        "schools",
        "student",
        "students",
        "teacher",
        "university",
        "kindergarten",
        "daycare",
        "childcare",
        "nursery",
        "colegio",
        "colegios",
        "escuela",
        "escuelas",
        "centro educativo",
        "centros educativos",
    ],
}


# Optional JSON-backed themes file (editable, versionable)
def _normalize_text(s: str) -> str:
    """Lowercase, remove diacritics, and collapse whitespace."""
    s = (s or "").lower()
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = re.sub(r"\s+", " ", s).strip()
    return s


def load_theme_glossary() -> Dict[str, List[str]]:
    """Return the keyword glossary.

    Always returns a defensive copy of the built-in `THEMES`.
    """
    return {theme_id: list(keywords) for theme_id, keywords in THEMES.items()}


# Note: embedding- and zero-shot-based extraction have been removed.
# Theme extraction is intentionally keyword-based and implemented in
# `extract_themes()` below which uses the glossary returned by
# `load_theme_glossary()`.


def extract_themes(text: str, top_n: int = 5, external_themes: List[str] | None = None) -> List[str]:
    """Return the top matching canonical theme ids for `text`.

    If `external_themes` is provided, those theme ids are given priority and
    prepended to the returned list (deduplicated). The rest of the behavior
    is unchanged and acts as a fallback for additional theme suggestions.
    """
    glossary = load_theme_glossary()
    txt = _normalize_text(text)
    if not txt and not external_themes:
        return []

    scores: Dict[str, float] = {}

    # Longest-first phrase matching gives higher weight
    for theme_id, keywords in glossary.items():
        kws = sorted(set(keywords), key=lambda s: len(s), reverse=True)
        for kw in kws:
            nkw = _normalize_text(kw)
            if not nkw:
                continue
            if " " in nkw:
                # phrase match (substring)
                if nkw in txt:
                    scores[theme_id] = scores.get(theme_id, 0.0) + 2.0
            else:
                # word boundary match
                if re.search(rf"\b{re.escape(nkw)}\b", txt):
                    scores[theme_id] = scores.get(theme_id, 0.0) + 1.0

    # Conservative fuzzy fallback if no matches found
    if not scores and txt:
        tokens = re.findall(r"\w+", txt)
        # build flat list of keywords for get_close_matches
        flat_keywords = {}
        for theme_id, keywords in glossary.items():
            for kw in keywords:
                flat_keywords.setdefault(_normalize_text(kw), []).append(theme_id)

        for tok in tokens:
            # only consider token length >=4 for fuzzy
            if len(tok) < 4:
                continue
            candidates = get_close_matches(tok, flat_keywords.keys(), n=2, cutoff=0.86)
            for cand in candidates:
                for theme_id in flat_keywords.get(cand, []):
                    scores[theme_id] = scores.get(theme_id, 0.0) + 0.5

    # Sort themes by score
    sorted_themes = [theme for theme, _ in sorted(scores.items(), key=lambda x: x[1], reverse=True)][:top_n]

    # Merge external themes (if given) with extracted ones, preserving order and dedup
    result: List[str] = []
    if external_themes:
        for t in external_themes:
            if t and t not in result:
                result.append(t)

    for t in sorted_themes:
        if t not in result:
            result.append(t)

    return result[:top_n]
