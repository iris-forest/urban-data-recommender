"""Indicator text validation and parsing."""
from __future__ import annotations

import re
from typing import List, Sequence, Tuple

from ..models import IndicatorParsed
from ..themes import extract_themes as extract_themes_simple


MIN_INPUT_LENGTH = 10
DEFAULT_GEOGRAPHIC_LEVEL = "Madrid city"

GEOGRAPHY_KEYWORDS: Sequence[Tuple[str, str]] = (
    ("census tracts", "census tract"),
    ("census tract", "census tract"),
    ("census sections", "census section"),
    ("census section", "census section"),
    ("city center", "city center"),
    ("district", "district"),
    ("neighbourhood", "neighbourhood"),
    ("neighborhood", "neighbourhood"),
    ("borough", "borough"),
    ("metropolitan", "metropolitan"),
    ("suburban", "suburban"),
    ("urban", "urban"),
    ("madrid", DEFAULT_GEOGRAPHIC_LEVEL),
)

ADMINISTRATIVE_LEVEL_LABELS = {
    "borough",
    "census section",
    "census tract",
    "district",
    "neighbourhood",
}

TIME_KEYWORDS = {
    "daily": "Daily",
    "weekly": "Weekly",
    "monthly": "Monthly",
    "quarterly": "Quarterly",
    "yearly": "Yearly",
    "annual": "Annual",
    "realtime": "Real-time",
    "real-time": "Real-time",
    "historical": "Historical",
    "recent": "Recent",
    "current": "Current",
}

POPULATION_KEYWORDS = {
    "older adults": "Older adults",
    "older adult": "Older adults",
    "seniors": "Older adults",
    "senior citizens": "Older adults",
    "elderly": "Older adults",
    "residents": "Residents",
    "resident": "Residents",
    "people": "People",
    "population": "Population",
    "inhabitants": "Inhabitants",
    "workers": "Workers",
    "employees": "Employees",
    "businesses": "Businesses",
    "households": "Households",
}

RELATIVE_PERIOD_PATTERN = re.compile(
    r"\b(?:for|over|during|within|in)?\s*(?:the\s+)?"
    r"(?:last|past|previous)\s+(\d{1,2})\s+(days?|weeks?|months?|years?)\b"
)
EXPLICIT_YEAR_PATTERN = re.compile(
    r"\b((?:19|20)\d{2})(?:\s*(?:-|\u2013|\u2014|to|through|until)\s*((?:19|20)\d{2}))?\b"
)


def validate_indicator_text(value: str) -> Tuple[str, List[str]]:
    """Normalize indicator text and return validation errors."""
    text = (value or "").strip()
    if not text:
        return text, ["Indicator text is empty."]
    if len(text) < MIN_INPUT_LENGTH:
        return text, [f"Indicator text must be at least {MIN_INPUT_LENGTH} characters."]
    return text, []


def _format_relative_period(match: re.Match[str]) -> str:
    amount = match.group(1)
    unit = match.group(2).rstrip("s")
    plural = "" if amount == "1" else "s"
    return f"Last {amount} {unit}{plural}"


def _format_explicit_year(match: re.Match[str]) -> str:
    start_year = match.group(1)
    end_year = match.group(2)
    if end_year and end_year != start_year:
        return f"{start_year}-{end_year}"
    return start_year


def _format_geographic_level(label: str) -> str:
    normalized = label.strip().lower()
    if not normalized or label == DEFAULT_GEOGRAPHIC_LEVEL or normalized == "madrid":
        return DEFAULT_GEOGRAPHIC_LEVEL
    if normalized in ADMINISTRATIVE_LEVEL_LABELS:
        return f"{DEFAULT_GEOGRAPHIC_LEVEL} ({normalized} level)"
    if normalized == "city center":
        return "Madrid city center"
    if normalized == "metropolitan":
        return "Madrid metropolitan area"
    if normalized == "suburban":
        return "Madrid suburbs"
    if normalized == "urban":
        return DEFAULT_GEOGRAPHIC_LEVEL
    return f"{DEFAULT_GEOGRAPHIC_LEVEL} ({normalized} level)"


def parse_indicator_text(text: str) -> IndicatorParsed:
    """Rule-based parser for geography, time, population, and attributes."""
    lowered = text.lower()
    parsed = IndicatorParsed(geographic_level=DEFAULT_GEOGRAPHIC_LEVEL)

    for keyword, label in GEOGRAPHY_KEYWORDS:
        if keyword in lowered:
            parsed.geographic_level = _format_geographic_level(label)
            break

    relative_period_match = RELATIVE_PERIOD_PATTERN.search(lowered)
    if relative_period_match:
        parsed.time_frame = _format_relative_period(relative_period_match)
    elif explicit_year_match := EXPLICIT_YEAR_PATTERN.search(lowered):
        parsed.time_frame = _format_explicit_year(explicit_year_match)
    else:
        for keyword, label in TIME_KEYWORDS.items():
            if keyword in lowered:
                parsed.time_frame = label
                break

    for keyword, label in POPULATION_KEYWORDS.items():
        if keyword in lowered:
            parsed.population = label
            break

    parsed.attributes = extract_themes_simple(text)
    return parsed
