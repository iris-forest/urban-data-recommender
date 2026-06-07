"""Pure recommendation candidate shaping and scoring."""
from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta
from functools import lru_cache
import re
from typing import Any, Dict, List, Optional, Sequence, cast

from ..catalog_translation import ensure_dataset_translations
from ..embeddings import cosine_similarity, encode_text, get_embedding_backend_name
from ..models import Dataset
from ..themes import _normalize_text
from .theme_matching import infer_dataset_theme_overlap, text_matches_theme


QUALITY_WEIGHT = 0.3
THEME_WEIGHT = 0.7
MULTI_THEME_ESSENTIAL_MIN_THEME_MATCH = 0.72
MULTI_THEME_ESSENTIAL_MIN_QUALITY = 0.70
MULTI_THEME_ESSENTIAL_MIN_FINAL = 0.74
SINGLE_THEME_ESSENTIAL_MIN_THEME_MATCH = 0.88
SINGLE_THEME_ESSENTIAL_MIN_QUALITY = 0.82
SINGLE_THEME_ESSENTIAL_MIN_FINAL = 0.84
COMPATIBILITY_RECOMMENDED_MIN = 0.5
COMPATIBILITY_STRONG_MIN = 0.75
SEMANTIC_WEAK_MIN = 0.08
TEMPORAL_COMPATIBILITY_WEIGHT = 0.25
TEXT_COMPATIBILITY_WEIGHT = 1.0 - TEMPORAL_COMPATIBILITY_WEIGHT
DATASET_DATE_PATTERN = re.compile(r"\b((?:19|20)\d{2})(?:-(\d{2})(?:-(\d{2}))?)?\b")
REQUEST_YEAR_PATTERN = re.compile(
    r"\b((?:19|20)\d{2})(?:\s*(?:-|\u2013|\u2014|to|through|until)\s*((?:19|20)\d{2}))?\b"
)
REQUEST_FREQUENCIES = {
    "daily": {"daily", "day", "diario", "diaria"},
    "weekly": {"weekly", "week", "semanal"},
    "monthly": {"monthly", "month", "mensual"},
    "quarterly": {"quarterly", "quarter", "trimestral"},
    "annual": {"annual", "annually", "yearly", "year", "anual"},
    "real-time": {"real-time", "realtime", "real time", "live"},
}
REQUEST_FREQUENCY_PATTERNS = {
    "daily": (
        r"\bdaily\b",
        r"\bevery\s+day\b",
        r"\beach\s+day\b",
        r"\bper\s+day\b",
        r"\bupdated\s+daily\b",
        r"\bdiari[ao]\b",
    ),
    "weekly": (
        r"\bweekly\b",
        r"\bevery\s+week\b",
        r"\beach\s+week\b",
        r"\bper\s+week\b",
        r"\bupdated\s+weekly\b",
        r"\bsemanal\b",
    ),
    "monthly": (
        r"\bmonthly\b",
        r"\bevery\s+month\b",
        r"\beach\s+month\b",
        r"\bper\s+month\b",
        r"\bupdated\s+monthly\b",
        r"\bmensual\b",
    ),
    "quarterly": (
        r"\bquarterly\b",
        r"\bevery\s+quarter\b",
        r"\beach\s+quarter\b",
        r"\bper\s+quarter\b",
        r"\bupdated\s+quarterly\b",
        r"\btrimestral\b",
    ),
    "annual": (
        r"\bannual\b",
        r"\bannually\b",
        r"\byearly\b",
        r"\bevery\s+year\b",
        r"\beach\s+year\b",
        r"\bper\s+year\b",
        r"\bupdated\s+annually\b",
        r"\banual\b",
    ),
    "real-time": (
        r"\breal-time\b",
        r"\brealtime\b",
        r"\breal\s+time\b",
        r"\blive\b",
    ),
}
RELATIVE_TIME_WINDOW_PATTERN = re.compile(
    r"\b(?:last|past|previous|recent|ultimos|ultimas)\s+(\d+)\s+"
    r"(day|days|week|weeks|month|months|year|years|dia|dias|semana|semanas|mes|meses|ano|anos)\b"
)
COMPATIBILITY_STOPWORDS = {
    "a",
    "about",
    "above",
    "across",
    "after",
    "against",
    "also",
    "among",
    "an",
    "and",
    "around",
    "as",
    "at",
    "based",
    "because",
    "been",
    "before",
    "being",
    "between",
    "both",
    "by",
    "could",
    "de",
    "del",
    "does",
    "each",
    "el",
    "en",
    "for",
    "from",
    "given",
    "have",
    "in",
    "into",
    "la",
    "las",
    "level",
    "los",
    "measure",
    "near",
    "of",
    "on",
    "or",
    "over",
    "per",
    "planning",
    "por",
    "question",
    "share",
    "should",
    "than",
    "that",
    "the",
    "their",
    "there",
    "these",
    "this",
    "those",
    "through",
    "to",
    "under",
    "using",
    "want",
    "what",
    "when",
    "where",
    "which",
    "while",
    "with",
    "within",
    "would",
    "y",
}
FOCUSED_THEME_KEYWORDS = {
    "accessibility_proximity": (
        "accessibility",
        "accesibilidad",
        "proximity",
        "walking distance",
        "walking time",
        "travel time",
        "within walking",
        "service area",
        "catchment",
        "800 meters",
        "800 metres",
        "500 meters",
        "500 metres",
        "nearby",
    ),
    "transport_networks": (
        "metro",
        "rail",
        "station",
        "stations",
        "transport",
        "transit",
        "public transport",
        "bus stop",
        "bus stops",
        "commuter rail",
        "subway",
        "tram",
        "mobility",
        "bike",
        "cycling",
        "roads",
    ),
    "population": (
        "poblacion residente",
        "población residente",
        "padron",
        "padrón",
        "municipal register",
        "resident population",
        "population counts",
        "population count",
        "census tract",
        "census section",
        "demographic",
        "households",
        "older adult population",
        "senior population",
        "seniors",
        "elderly",
    ),
    "geographic_boundaries": (
        "census tract",
        "census tracts",
        "census section",
        "census sections",
        "district boundary",
        "district boundaries",
        "neighborhood boundary",
        "neighbourhood boundary",
        "administrative boundary",
        "boundaries",
        "boundary",
        "polygon",
        "polygons",
        "shapefile",
        "cartography",
        "cartografia",
        "cartografía",
        "geodata",
    ),
    "green_space": (
        "green space",
        "green spaces",
        "green area",
        "green areas",
        "parks",
        "park",
        "public park",
        "zonas verdes",
        "zona verde",
        "parques",
        "parque",
        "jardines",
        "tree canopy",
        "canopy cover",
        "urban forest",
        "arbolado",
    ),
    "air_quality": (
        "air quality",
        "calidad del aire",
        "pollution",
        "air pollution",
        "low emission",
        "low-emission",
        "low emission zone",
        "low-emission zone",
        "emissions",
        "emission",
        "pm2.5",
        "no2",
        "nitrogen dioxide",
    ),
}
EXCLUDED_FOCUSED_THEME_PHRASES = {
    "population": (
        "abastecimiento de agua potable para la poblacion",
        "abastecimiento de agua potable para la población",
        "census of economic activity",
        "drinking water for the population",
        "economic activity park",
        "economic activity parks",
        "for the population and the consum",
        "municipalities with population",
        "older adults levels",
        "older adults niveles",
        "population atendida",
        "population between",
        "poblacion atendida",
        "población atendida",
        "population served",
        "resident parking",
        "resident vehicle",
        "resident vehicles",
        "residentes y vehiculos",
        "residentes y vehículos",
        "served population",
        "supply of drinking water for the population",
    ),
    "accessibility_proximity": (
        "access through audiovisual media",
        "access by audiovisual media",
    ),
    "green_space": (
        "business park",
        "business parks",
        "economic activity park",
        "economic activity parks",
        "industrial park",
        "industrial parks",
        "irrigation of green areas",
        "natural park",
        "natural parks",
        "parque natural",
        "parques naturales",
        "parques de actividad economica",
        "parques de actividad económica",
        "poligons d'activitat economica",
        "polígons d'activitat econòmica",
        "riego de green areas",
        "riego de zonas verdes",
        "water for green areas",
    ),
}

NON_MADRID_SCOPE_LABELS = {
    "alava": "Alava",
    "andalucia": "Andalucia",
    "andalucía": "Andalucia",
    "aragon": "Aragon",
    "aragón": "Aragon",
    "badajoz": "Badajoz",
    "barcelona": "Barcelona",
    "canarias": "the Canary Islands",
    "cantabria": "Cantabria",
    "castilla and leon": "Castilla y Leon",
    "castilla y leon": "Castilla y Leon",
    "castilla y león": "Castilla y Leon",
    "catalunya": "Catalonia",
    "cataluna": "Catalonia",
    "cataluña": "Catalonia",
    "comunidad valenciana": "Valencia",
    "euskadi": "the Basque Country",
    "extremadura": "Extremadura",
    "galicia": "Galicia",
    "girona": "Girona",
    "islas canarias": "the Canary Islands",
    "navarra": "Navarra",
    "national air quality": "Spain",
    "pais vasco": "the Basque Country",
    "país vasco": "the Basque Country",
    "parques nacionales espanoles": "Spanish national parks",
    "spanish national parks": "Spanish national parks",
    "valencia": "Valencia",
    "spain": "Spain",
    "espana": "Spain",
    "españa": "Spain",
    "national": "Spain",
    "nacional": "Spain",
    "nationwide": "Spain",
}
GENERIC_CONCEPT_TOKENS = {
    "access",
    "accessibility",
    "distance",
    "mobility",
    "population",
    "resident",
    "residents",
    "transport",
    "public",
    "service",
    "services",
}

REQUESTED_GEOGRAPHY_TERMS = {
    "district": ("district", "districts", "distrito", "distritos"),
    "neighborhood": ("neighborhood", "neighborhoods", "neighbourhood", "neighbourhoods", "barrio", "barrios"),
    "census tract": ("census tract", "census tracts", "census section", "census sections", "seccion censal", "secciones censales"),
}
REQUESTED_THEME_PHRASE_GROUPS = {
    "air_quality": {
        "low emission zone": (
            "low emission",
            "low-emission",
            "low emission zone",
            "low-emission zone",
            "zona de bajas emisiones",
            "zbe",
        ),
    },
}


def _recommendation_key(recommendation: Dict[str, Any]) -> str:
    return str(recommendation.get("dataset_id") or recommendation.get("title") or id(recommendation))


def _recommendation_search_priority(recommendation: Dict[str, Any]) -> tuple[int, int]:
    location_text = " ".join(
        str(recommendation.get(key, ""))
        for key in ("title", "provider", "spatial_coverage", "source")
    ).lower()
    local_priority = 0 if "madrid" in location_text else 1
    return local_priority, int(recommendation.get("search_rank", 1_000_000))


def _compatibility_token(token: str) -> str:
    token = token.strip("._-")
    if token.startswith("accessib"):
        return "access"
    if token == "proximity":
        return "near"
    if len(token) > 4 and token.endswith("ies"):
        return f"{token[:-3]}y"
    if len(token) > 4 and token.endswith("s") and not token.endswith(("ss", "us")):
        return token[:-1]
    return token


def _compatibility_tokens(text: str) -> List[str]:
    tokens: List[str] = []
    for raw_token in re.findall(r"[\w.-]+", _normalize_text(text)):
        token = _compatibility_token(raw_token)
        if len(token) < 3 or token.isdigit() or token in COMPATIBILITY_STOPWORDS:
            continue
        tokens.append(token)
    return tokens


def _append_dict_text(parts: List[str], values: Sequence[Any], keys: Sequence[str]) -> None:
    for value in values:
        if not isinstance(value, dict):
            continue
        for key in keys:
            if text := value.get(key):
                parts.append(str(text))


def _candidate_focus_text(candidate: Dict[str, Any]) -> str:
    parts = [
        str(candidate.get(key) or "")
        for key in (
            "title",
            "title_en",
            "title_original",
            "description",
            "description_en",
            "description_original",
            "spatial_coverage",
            "spatial_resolution",
        )
    ]
    _append_dict_text(parts, candidate.get("preview_resources", []) or [], ("name", "title", "description", "format"))
    _append_dict_text(parts, candidate.get("schema_fields", []) or [], ("name", "title", "description", "label"))
    return _normalize_text(" ".join(part for part in parts if part))


def _candidate_semantic_text(candidate: Dict[str, Any]) -> str:
    """Build reranker text from real dataset metadata, not inferred theme/category tags."""
    parts = [
        str(candidate.get(key) or "")
        for key in (
            "title",
            "title_en",
            "title_original",
            "description",
            "description_en",
            "description_original",
            "spatial_coverage",
            "spatial_resolution",
            "update_frequency",
            "last_updated",
            "publication_date",
        )
    ]
    _append_dict_text(parts, candidate.get("preview_resources", []) or [], ("name", "title", "description", "format"))
    _append_dict_text(parts, candidate.get("schema_fields", []) or [], ("name", "title", "description", "label"))
    return _normalize_text(" ".join(part for part in parts if part))


def _semantic_query_text(indicator_text: str, extracted_themes: Sequence[str]) -> str:
    theme_text = " ".join(theme.replace("_", " ") for theme in extracted_themes)
    return _normalize_text(f"{indicator_text} {theme_text}")


def semantic_reranker_backend_name() -> str:
    return get_embedding_backend_name()


@lru_cache(maxsize=8192)
def _cached_semantic_vector(text: str, backend_name: str) -> tuple[float, ...]:
    """Cache catalog candidate vectors; query vectors stay per request."""
    _ = backend_name
    return tuple(encode_text(text))


def _candidate_scope_text(candidate: Dict[str, Any]) -> str:
    parts = [
        str(candidate.get(key) or "")
        for key in (
            "title",
            "title_en",
            "title_original",
            "description",
            "description_en",
            "description_original",
            "provider",
            "spatial_coverage",
            "source",
            "api_url",
        )
    ]
    return _normalize_text(" ".join(part for part in parts if part))


def _non_madrid_scope_reason(
    candidate: Dict[str, Any],
    indicator_text: str = "",
) -> Optional[str]:
    scope_text = _candidate_scope_text(candidate)
    if not scope_text:
        return None

    normalized_indicator = _normalize_text(indicator_text)
    if "madrid" in normalized_indicator and "madrid" not in scope_text:
        for location, label in NON_MADRID_SCOPE_LABELS.items():
            if location in scope_text:
                return f"coverage appears to be {label}, not Madrid"

    if "madrid" in scope_text:
        return None

    for location, label in NON_MADRID_SCOPE_LABELS.items():
        if location in scope_text:
            return f"coverage appears to be {label}, not Madrid"

    return None


def _generic_only_token_hits(combined_hits: Sequence[str]) -> bool:
    if not combined_hits:
        return False
    return all(token in GENERIC_CONCEPT_TOKENS for token in combined_hits)


def _requested_geography_terms(indicator_text: str) -> tuple[str, tuple[str, ...]] | None:
    normalized = _normalize_text(indicator_text)
    for label, terms in REQUESTED_GEOGRAPHY_TERMS.items():
        if any(term in normalized for term in terms):
            return label, terms
    return None


def _geographic_granularity_reason(candidate: Dict[str, Any], indicator_text: str) -> Optional[str]:
    requested = _requested_geography_terms(indicator_text)
    if not requested:
        return None

    label, terms = requested
    candidate_text = _candidate_semantic_text(candidate)
    if any(term in candidate_text for term in terms):
        return None

    return f"does not mention requested {label} granularity"


def _missing_requested_theme_phrases(
    candidate: Dict[str, Any],
    indicator_text: str,
    focused_theme_hits: Sequence[str],
) -> List[str]:
    query_text = _normalize_text(indicator_text)
    candidate_text = _candidate_semantic_text(candidate)
    missing: List[str] = []

    for theme_id in focused_theme_hits:
        for label, phrases in REQUESTED_THEME_PHRASE_GROUPS.get(theme_id, {}).items():
            query_requires_phrase = any(phrase in query_text for phrase in phrases)
            candidate_has_phrase = any(phrase in candidate_text for phrase in phrases)
            if query_requires_phrase and not candidate_has_phrase:
                missing.append(label)

    return list(dict.fromkeys(missing))


def _focused_keyword_matches(theme_id: str, normalized_keyword: str, focus_text: str, token_set: set[str]) -> bool:
    if " " in normalized_keyword:
        return normalized_keyword in focus_text

    if normalized_keyword not in token_set:
        return False

    if theme_id == "air_quality" and normalized_keyword in {"no2", "pm2.5"}:
        return any(
            context in focus_text
            for context in (
                "air quality",
                "calidad del aire",
                "contaminacion",
                "contaminación",
                "pollutant",
                "pollution",
                "nitrogen dioxide",
                "atmospheric",
                "atmosferica",
                "atmosférica",
            )
        )

    return True


def _focused_theme_hits(candidate: Dict[str, Any], extracted_themes: Sequence[str]) -> List[str]:
    matching_theme_set = set(candidate.get("matching_themes", []))
    focus_text = _candidate_focus_text(candidate)
    token_set = set(re.findall(r"[\w.-]+", focus_text))
    focused: List[str] = []

    for theme_id in dict.fromkeys(extracted_themes):
        if theme_id not in matching_theme_set:
            continue

        if any(phrase in focus_text for phrase in EXCLUDED_FOCUSED_THEME_PHRASES.get(theme_id, ())):
            continue

        keywords = FOCUSED_THEME_KEYWORDS.get(theme_id)
        if not keywords:
            if text_matches_theme(focus_text, theme_id):
                focused.append(theme_id)
            continue

        for keyword in keywords:
            normalized = _normalize_text(keyword)
            if not normalized:
                continue
            if _focused_keyword_matches(theme_id, normalized, focus_text, token_set):
                focused.append(theme_id)
                break

    return focused


def _bounded_overlap_score(
    query_tokens: Sequence[str],
    target_tokens: Sequence[str],
    max_expected_hits: int,
) -> tuple[float, List[str]]:
    query_set = set(query_tokens)
    target_set = set(target_tokens)
    hits = sorted(query_set.intersection(target_set))
    if not query_set or not target_set:
        return 0.0, hits

    denominator = max(1, min(max_expected_hits, len(target_set), len(query_set)))
    return min(1.0, len(hits) / denominator), hits


def _query_phrase_score(query_tokens: Sequence[str], title_text: str, description_text: str) -> float:
    phrases: List[str] = []
    for size in (3, 2):
        phrases.extend(
            " ".join(query_tokens[index:index + size])
            for index in range(0, max(0, len(query_tokens) - size + 1))
        )

    if not phrases:
        return 0.0

    title_hits = sum(1 for phrase in phrases if phrase in title_text)
    description_hits = sum(1 for phrase in phrases if phrase in description_text)
    weighted_hits = title_hits + (description_hits * 0.6)
    return min(1.0, weighted_hits / min(4, len(phrases)))


def _parse_dataset_date(value: Any) -> Optional[date]:
    text = str(value or "").strip()
    if not text:
        return None

    match = DATASET_DATE_PATTERN.search(text)
    if not match:
        return None

    year = int(match.group(1))
    month = int(match.group(2) or "1")
    day = int(match.group(3) or "1")
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _candidate_publication_date(candidate: Dict[str, Any]) -> Optional[date]:
    return _parse_dataset_date(candidate.get("publication_date")) or _parse_dataset_date(candidate.get("last_updated"))


def _score_recency(dataset_date: date, reference_date: Optional[date] = None) -> float:
    today = reference_date or date.today()
    age_days = max(0, (today - dataset_date).days)
    if age_days <= 365:
        return 1.0 - (age_days / 365 * 0.15)
    if age_days <= 1095:
        return 0.85 - ((age_days - 365) / 730 * 0.25)
    if age_days <= 2190:
        return 0.60 - ((age_days - 1095) / 1095 * 0.30)
    return max(0.05, 0.30 - ((age_days - 2190) / 3650 * 0.25))


def _score_year_distance(days_from_requested_period: int) -> float:
    years = days_from_requested_period / 365.0
    if years <= 0.5:
        return 1.0
    if years <= 1:
        return 0.9
    if years <= 2:
        return 0.75
    if years <= 5:
        return 0.45
    if years <= 10:
        return 0.20
    return 0.05


def _requested_year_window(indicator_text: str) -> Optional[tuple[date, date, str]]:
    match = REQUEST_YEAR_PATTERN.search(_normalize_text(indicator_text))
    if not match:
        return None

    start_year = int(match.group(1))
    end_year = int(match.group(2) or start_year)
    if end_year < start_year:
        start_year, end_year = end_year, start_year

    label = str(start_year) if start_year == end_year else f"{start_year}-{end_year}"
    return date(start_year, 1, 1), date(end_year, 12, 31), label


def _shift_months(value: date, month_delta: int) -> date:
    month_index = value.month - 1 + month_delta
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, monthrange(year, month)[1])
    return date(year, month, day)


def _requested_relative_time_window(
    indicator_text: str,
    reference_date: Optional[date] = None,
) -> Optional[tuple[date, date, str]]:
    match = RELATIVE_TIME_WINDOW_PATTERN.search(_normalize_text(indicator_text))
    if not match:
        return None

    amount = int(match.group(1))
    unit = match.group(2)
    end = reference_date or date.today()

    if unit in {"day", "days", "dia", "dias"}:
        start = end - timedelta(days=amount)
        label_unit = "day" if amount == 1 else "days"
    elif unit in {"week", "weeks", "semana", "semanas"}:
        start = end - timedelta(weeks=amount)
        label_unit = "week" if amount == 1 else "weeks"
    elif unit in {"month", "months", "mes", "meses"}:
        start = _shift_months(end, -amount)
        label_unit = "month" if amount == 1 else "months"
    else:
        start = _shift_months(end, -(amount * 12))
        label_unit = "year" if amount == 1 else "years"

    return start, end, f"last {amount} {label_unit}"


def _requested_time_window(indicator_text: str) -> Optional[tuple[date, date, str]]:
    return _requested_year_window(indicator_text) or _requested_relative_time_window(indicator_text)


def _candidate_title_year_windows(candidate: Dict[str, Any]) -> List[tuple[date, date, str]]:
    windows: List[tuple[date, date, str]] = []
    seen: set[str] = set()
    title_text = " ".join(
        str(candidate.get(key) or "")
        for key in ("title", "title_en", "title_original")
    )

    for match in REQUEST_YEAR_PATTERN.finditer(_normalize_text(title_text)):
        start_year = int(match.group(1))
        end_year = int(match.group(2) or start_year)
        if end_year < start_year:
            start_year, end_year = end_year, start_year
        label = str(start_year) if start_year == end_year else f"{start_year}-{end_year}"
        if label in seen:
            continue
        seen.add(label)
        windows.append((date(start_year, 1, 1), date(end_year, 12, 31), label))

    return windows


def _title_year_matching_requested_window(
    candidate: Dict[str, Any],
    requested_window: tuple[date, date, str],
) -> Optional[str]:
    requested_start, requested_end, requested_label = requested_window
    for title_start, title_end, title_label in _candidate_title_year_windows(candidate):
        if title_start <= requested_end and title_end >= requested_start:
            return (
                f"title indicates {title_label}, matching requested {requested_label}; "
                "used before publication date"
            )
    return None


def _requested_frequency(indicator_text: str) -> Optional[str]:
    normalized = _normalize_text(indicator_text)
    for frequency, patterns in REQUEST_FREQUENCY_PATTERNS.items():
        if any(re.search(pattern, normalized) for pattern in patterns):
            return frequency
    return None


def _frequency_score(candidate: Dict[str, Any], requested_frequency: Optional[str]) -> Optional[float]:
    if not requested_frequency:
        return None

    update_frequency = _normalize_text(str(candidate.get("update_frequency") or ""))
    if not update_frequency or update_frequency == "unknown":
        return 0.35

    requested_tokens = REQUEST_FREQUENCIES[requested_frequency]
    if any(token in update_frequency for token in requested_tokens):
        return 1.0

    if requested_frequency == "annual" and any(token in update_frequency for token in REQUEST_FREQUENCIES["quarterly"]):
        return 0.8
    if requested_frequency == "quarterly" and any(token in update_frequency for token in REQUEST_FREQUENCIES["monthly"]):
        return 0.8
    if requested_frequency == "monthly" and any(token in update_frequency for token in REQUEST_FREQUENCIES["weekly"]):
        return 0.8
    if requested_frequency in {"daily", "weekly", "monthly"} and any(token in update_frequency for token in REQUEST_FREQUENCIES["real-time"]):
        return 0.85

    return 0.45


def _temporal_compatibility(
    candidate: Dict[str, Any],
    indicator_text: str,
) -> tuple[Optional[float], Optional[str]]:
    requested_window = _requested_time_window(indicator_text)
    dataset_date = _candidate_publication_date(candidate)
    requested_frequency = _requested_frequency(indicator_text)
    frequency_score = _frequency_score(candidate, requested_frequency)

    date_score: Optional[float] = None
    date_reason: Optional[str] = None
    if requested_window and (title_year_reason := _title_year_matching_requested_window(candidate, requested_window)):
        date_score = 1.0
        date_reason = title_year_reason
    elif dataset_date and requested_window:
        start_date, end_date, label = requested_window
        if start_date <= dataset_date <= end_date:
            distance_days = 0
        else:
            distance_days = min(abs((dataset_date - start_date).days), abs((dataset_date - end_date).days))
        date_score = _score_year_distance(distance_days)
        date_reason = f"published {dataset_date.isoformat()}, nearest to requested {label}"
    elif dataset_date:
        date_score = _score_recency(dataset_date)
        date_reason = f"published {dataset_date.isoformat()}, preferred because no specific year was requested"

    score_parts = [score for score in (date_score, frequency_score) if score is not None]
    if not score_parts:
        return None, None

    if date_score is not None and frequency_score is not None:
        temporal_score = (0.75 * date_score) + (0.25 * frequency_score)
    else:
        temporal_score = score_parts[0]

    reason_parts = []
    if date_reason:
        reason_parts.append(date_reason)
    if requested_frequency:
        reason_parts.append(f"{candidate.get('update_frequency') or 'unknown cadence'} compared with requested {requested_frequency} cadence")

    return round(max(0.0, min(1.0, temporal_score)), 3), "; ".join(reason_parts)


def _semantic_compatibility(candidate: Dict[str, Any], query_vector: Sequence[float]) -> float:
    candidate_text = _candidate_semantic_text(candidate)
    if not candidate_text or not query_vector:
        return 0.0

    try:
        candidate_vector = _cached_semantic_vector(candidate_text, get_embedding_backend_name())
        return round(max(0.0, min(1.0, cosine_similarity(query_vector, candidate_vector))), 3)
    except Exception:
        return 0.0


def _compatibility_band(score: float) -> str:
    if score >= COMPATIBILITY_STRONG_MIN:
        return "strong"
    if score >= COMPATIBILITY_RECOMMENDED_MIN:
        return "partial"
    return "weak"


def _compatibility_evidence(
    focused_theme_hits: Sequence[str],
    extracted_themes: Sequence[str],
    missing_requested_concepts: Sequence[str],
    geographic_reason: Optional[str],
    granularity_reason: Optional[str],
    temporal_reason: Optional[str],
    semantic_score: float,
) -> Dict[str, Any]:
    matched_concepts = [theme.replace("_", " ") for theme in dict.fromkeys(focused_theme_hits)]
    missing_concepts = [
        theme.replace("_", " ")
        for theme in dict.fromkeys(extracted_themes)
        if theme not in set(focused_theme_hits)
    ]
    missing_concepts.extend(concept for concept in missing_requested_concepts if concept not in missing_concepts)
    geography = geographic_reason or granularity_reason or "Geography is compatible with the planning question."
    time = temporal_reason or "No clear time metadata was available for this dataset."

    if matched_concepts:
        summary = f"This dataset aligns with your question on: {', '.join(matched_concepts)}."
    else:
        summary = (
            "We did not find clear mentions of your themes in the dataset title, "
            "description, or fields."
        )
    return {
        "matched_concepts": matched_concepts,
        "missing_concepts": missing_concepts,
        "geography": geography,
        "time": time,
        "summary": summary,
    }


def _compatibility_reason(
    text_score: float,
    title_hits: Sequence[str],
    description_hits: Sequence[str],
    theme_hits: Sequence[str],
    focused_theme_hits: Sequence[str],
    temporal_reason: Optional[str] = None,
    geographic_reason: Optional[str] = None,
    granularity_reason: Optional[str] = None,
    semantic_score: float = 0.0,
) -> str:
    matched_terms = list(dict.fromkeys([*title_hits, *description_hits]))[:4]
    theme_evidence = focused_theme_hits if focused_theme_hits else theme_hits
    matched_themes = [theme.replace("_", " ") for theme in list(dict.fromkeys(theme_evidence))[:3]]

    if not matched_terms and not matched_themes:
        reason = "No clear title or description overlap with the planning question."
        if temporal_reason:
            reason += f" Time alignment: {temporal_reason}."
        if geographic_reason or granularity_reason:
            reason += f" Geographic alignment: {geographic_reason or granularity_reason}."
        return reason

    if focused_theme_hits:
        strength = "Strong"
    elif text_score >= 0.75:
        strength = "Strong"
    elif text_score >= 0.5:
        strength = "Moderate"
    else:
        strength = "Limited"

    evidence_parts: List[str] = []
    if matched_terms:
        evidence_parts.append(f"mentions {', '.join(matched_terms)}")
    if matched_themes:
        evidence_parts.append(f"covers {', '.join(matched_themes)}")

    reason = (
        f"{strength} semantic/title/description match: {'; '.join(evidence_parts)}. "
        f"Semantic similarity: {round(semantic_score * 100)}%."
    )
    if temporal_reason:
        reason += f" Time alignment: {temporal_reason}."
    if geographic_reason or granularity_reason:
        reason += f" Geographic alignment: {geographic_reason or granularity_reason}."
    return reason


def _combine_text_and_temporal_scores(text_score: float, temporal_score: Optional[float]) -> float:
    if temporal_score is None:
        return text_score
    return (TEXT_COMPATIBILITY_WEIGHT * text_score) + (TEMPORAL_COMPATIBILITY_WEIGHT * temporal_score)


def _selected_theme_fit_score(
    focused_theme_hits: Sequence[str],
    text_score: float,
    temporal_score: Optional[float],
) -> Optional[float]:
    if not focused_theme_hits:
        return None

    base_score = 0.86 + min(0.08, 0.04 * (len(set(focused_theme_hits)) - 1))
    text_bonus = min(0.03, max(0.0, text_score) * 0.03)
    temporal_bonus = 0.04 * max(0.0, temporal_score if temporal_score is not None else 0.5)
    return min(0.99, base_score + text_bonus + temporal_bonus)


def score_title_description_compatibility(
    candidate: Dict[str, Any],
    indicator_text: str,
    extracted_themes: Sequence[str],
    query_vector: Optional[Sequence[float]] = None,
) -> Dict[str, Any]:
    """Stage 2 semantic reranker score for a candidate dataset."""
    theme_text = " ".join(theme.replace("_", " ") for theme in extracted_themes)
    query_tokens = _compatibility_tokens(f"{indicator_text} {theme_text}")
    title = str(candidate.get("title_en") or candidate.get("title") or "")
    description = str(candidate.get("description_en") or candidate.get("description") or "")
    title_text = _normalize_text(title)
    description_text = _normalize_text(description)
    title_tokens = _compatibility_tokens(title)
    description_tokens = _compatibility_tokens(description)

    title_score, title_hits = _bounded_overlap_score(query_tokens, title_tokens, 4)
    description_score, description_hits = _bounded_overlap_score(query_tokens, description_tokens, 7)
    combined_hits = sorted(set(title_hits).union(description_hits))
    query_coverage = min(1.0, len(combined_hits) / max(1, min(5, len(set(query_tokens)))))
    phrase_score = _query_phrase_score(query_tokens, title_text, description_text)

    text = f"{title} {description}"
    unique_themes = list(dict.fromkeys(extracted_themes))
    theme_hits = [theme for theme in unique_themes if text_matches_theme(text, theme)]
    focused_theme_hits = _focused_theme_hits(candidate, unique_themes)
    theme_score = len(theme_hits) / max(1, len(unique_themes)) if unique_themes else 0.0

    text_score = (
        (0.40 * title_score)
        + (0.25 * description_score)
        + (0.20 * theme_score)
        + (0.10 * query_coverage)
        + (0.05 * phrase_score)
    )
    if not combined_hits and not theme_hits:
        text_score = 0.0

    temporal_score, temporal_reason = _temporal_compatibility(candidate, indicator_text)
    if query_vector is None:
        try:
            query_vector = encode_text(_semantic_query_text(indicator_text, extracted_themes))
        except Exception:
            query_vector = []
    semantic_score = _semantic_compatibility(candidate, query_vector)
    concept_score = 0.0
    if focused_theme_hits:
        concept_score = min(1.0, 0.82 + (0.06 * (len(set(focused_theme_hits)) - 1)))

    # Use the same temporal fallback as other logic
    temporal_component = temporal_score if temporal_score is not None else 0.5

    # Legacy internal score (kept for compatibility with other ranking rules)
    score = (
        (0.45 * semantic_score)
        + (0.35 * concept_score)
        + (0.10 * text_score)
        + (0.10 * temporal_component)
    )

    # New compatibility breakdown signals and final weighted percentage
    # Preset weights (semantically-weighted): semantic 40%, focused evidence 30%, text overlap 20%, timeframe 10%
    COMPATIBILITY_WEIGHTS = {
        "semantic": 0.40,
        "focused_evidence": 0.30,
        "text_overlap": 0.20,
        "timeframe": 0.10,
    }

    # Prepare per-signal scores (0.0-1.0)
    sig_semantic = round(max(0.0, min(1.0, float(semantic_score) if semantic_score is not None else 0.0)), 3)
    sig_focused = round(max(0.0, min(1.0, float(concept_score) if concept_score is not None else 0.0)), 3)
    sig_text = round(max(0.0, min(1.0, float(text_score) if text_score is not None else 0.0)), 3)
    sig_time = round(max(0.0, min(1.0, float(temporal_component) if temporal_component is not None else 0.5)), 3)

    weighted_components = {
        "semantic": round(sig_semantic * COMPATIBILITY_WEIGHTS["semantic"], 3),
        "focused_evidence": round(sig_focused * COMPATIBILITY_WEIGHTS["focused_evidence"], 3),
        "text_overlap": round(sig_text * COMPATIBILITY_WEIGHTS["text_overlap"], 3),
        "timeframe": round(sig_time * COMPATIBILITY_WEIGHTS["timeframe"], 3),
    }

    compatibility_final_score = round(
        sum(weighted_components.values()),
        3,
    )
    selected_theme_score = _selected_theme_fit_score(focused_theme_hits, text_score, temporal_score)
    if selected_theme_score is not None:
        score = max(score, selected_theme_score + min(0.04, semantic_score * 0.04))
    geographic_reason = _non_madrid_scope_reason(candidate, indicator_text)
    granularity_reason = _geographic_granularity_reason(candidate, indicator_text)
    missing_requested_concepts = _missing_requested_theme_phrases(
        candidate,
        indicator_text,
        focused_theme_hits,
    )
    focused_theme_set = set(focused_theme_hits)
    required_theme_set = set(unique_themes)
    if not focused_theme_hits:
        score = min(score, 0.49)
    if semantic_score < SEMANTIC_WEAK_MIN and not combined_hits:
        score = min(score, 0.49)
    if _generic_only_token_hits(combined_hits) and not focused_theme_set:
        score = min(score, 0.49)
    if len(required_theme_set) >= 2 and focused_theme_set:
        covered_required = focused_theme_set.intersection(required_theme_set)
        other_required = required_theme_set - focused_theme_set
        if covered_required == {"population"} and other_required:
            score = min(score, 0.74)
    if granularity_reason and focused_theme_set == {"population"}:
        score = min(score, 0.74)
    if missing_requested_concepts and len(focused_theme_set) == 1:
        score = min(score, 0.74)
    if geographic_reason:
        score = min(score, 0.49)
    rounded_score = round(max(0.0, min(1.0, score)), 3)
    score_adjustment = round(rounded_score - compatibility_final_score, 3)
    band = _compatibility_band(rounded_score)
    evidence = _compatibility_evidence(
        focused_theme_hits,
        extracted_themes,
        missing_requested_concepts,
        geographic_reason,
        granularity_reason,
        temporal_reason,
        semantic_score,
    )
    return {
        "score": rounded_score,
        "semantic_score": semantic_score,
        "compatibility_band": band,
        "compatibility_evidence": evidence,
        "reason": _compatibility_reason(
            text_score,
            title_hits,
            description_hits,
            theme_hits,
            focused_theme_hits,
            temporal_reason,
            geographic_reason,
            granularity_reason,
            semantic_score,
        ),
        "focused_theme_hits": focused_theme_hits,
        "compatibility_breakdown": {
            "weights": COMPATIBILITY_WEIGHTS,
            "signals": [
                {
                    "id": "semantic",
                    "label": "Semantic similarity",
                    "score": sig_semantic,
                    "percentage": int(round(sig_semantic * 100)),
                    "weight": COMPATIBILITY_WEIGHTS["semantic"],
                    "contribution": weighted_components["semantic"],
                },
                {
                    "id": "focused_evidence",
                    "label": "Focused evidence",
                    "score": sig_focused,
                    "percentage": int(round(sig_focused * 100)),
                    "weight": COMPATIBILITY_WEIGHTS["focused_evidence"],
                    "contribution": weighted_components["focused_evidence"],
                },
                {
                    "id": "text_overlap",
                    "label": "Text overlap",
                    "score": sig_text,
                    "percentage": int(round(sig_text * 100)),
                    "weight": COMPATIBILITY_WEIGHTS["text_overlap"],
                    "contribution": weighted_components["text_overlap"],
                },
                {
                    "id": "timeframe",
                    "label": "Timeframe fit",
                    "score": sig_time,
                    "percentage": int(round(sig_time * 100)),
                    "weight": COMPATIBILITY_WEIGHTS["timeframe"],
                    "contribution": weighted_components["timeframe"],
                },
            ],
            "final_score": compatibility_final_score,
            "final_percentage": round(compatibility_final_score * 100, 1),
            "final_adjustment": score_adjustment,
        },
    }


def _promote_theme_coverage(
    scored: List[Dict[str, Any]],
    extracted_themes: Sequence[str],
) -> List[Dict[str, Any]]:
    """Keep the first page representative when an indicator spans themes."""
    ordered_themes = list(dict.fromkeys(extracted_themes))
    if len(ordered_themes) < 2:
        return scored

    promoted: List[Dict[str, Any]] = []
    promoted_keys: set[str] = set()

    for theme_id in ordered_themes:
        eligible_matches = [
            recommendation
            for recommendation in scored
            if theme_id in recommendation.get("matching_themes", [])
            and _recommendation_key(recommendation) not in promoted_keys
        ]
        best_match = min(
            eligible_matches,
            key=_recommendation_search_priority,
            default=None,
        )
        if best_match is None:
            continue

        promoted.append(best_match)
        promoted_keys.add(_recommendation_key(best_match))

    if len(promoted) < 2:
        return scored

    promoted.sort(key=_recommendation_search_priority)
    return promoted + [
        recommendation
        for recommendation in scored
        if _recommendation_key(recommendation) not in promoted_keys
    ]


def _ensure_selected_theme_essentials(
    scored: List[Dict[str, Any]],
    extracted_themes: Sequence[str],
) -> List[Dict[str, Any]]:
    """Mark compatible representatives, with a narrow fallback for uncovered themes."""
    for theme_id in dict.fromkeys(extracted_themes):
        already_covered = any(
            recommendation.get("is_essential")
            and theme_id in recommendation.get("focused_matching_themes", [])
            for recommendation in scored
        )
        if already_covered:
            continue

        eligible = [
            recommendation
            for recommendation in scored
            if theme_id in recommendation.get("focused_matching_themes", [])
        ]
        if not eligible:
            continue

        compatible = [
            recommendation
            for recommendation in eligible
            if recommendation.get("compatibility_band") == "strong"
            and float(recommendation.get("compatibility_score", 0.0)) >= COMPATIBILITY_STRONG_MIN
        ]
        if compatible:
            match_pool = compatible
        else:
            continue

        best_match = max(
            match_pool,
            key=lambda recommendation: (
                float(recommendation.get("compatibility_score", 0.0)),
                float(recommendation.get("final_score", 0.0)),
                float(recommendation.get("theme_match_score", 0.0)),
                float(recommendation.get("quality_score", 0.0)),
            ),
        )
        best_match["is_essential"] = True
        theme_label = theme_id.replace("_", " ")
        reason = str(best_match.get("reason_recommended", "")).strip()
        addendum = f" Pre-selected as the strongest semantic match for the selected {theme_label} theme."
        if addendum.strip() not in reason:
            best_match["reason_recommended"] = f"{reason}{addendum}".strip()

    return scored


def candidate_from_dataset(dataset: Dataset, extracted_themes: set[str]) -> Optional[Dict[str, Any]]:
    """Convert a Dataset into a recommendation candidate when themes overlap."""
    dataset_themes = set(dataset.themes or [])
    direct_overlap = extracted_themes.intersection(dataset_themes)
    inferred_overlap = infer_dataset_theme_overlap(dataset, extracted_themes.difference(dataset_themes))
    overlap = direct_overlap.union(inferred_overlap)
    if not overlap:
        return None

    ensure_dataset_translations(dataset)
    candidate_themes = sorted(dataset_themes.union(inferred_overlap))

    return {
        "dataset_id": dataset.dataset_id,
        "title": dataset.title,
        "title_original": dataset.title_original or dataset.title,
        "title_en": dataset.title_en or dataset.title,
        "provider": dataset.provider,
        "themes": candidate_themes,
        "matching_themes": sorted(overlap),
        "spatial_resolution": dataset.spatial_resolution,
        "access_type": dataset.access_type,
        "formats": dataset.formats,
        "quality": {
            "completeness": dataset.quality.completeness,
            "timeliness": dataset.quality.timeliness,
            "consistency": dataset.quality.consistency,
            "documentation": dataset.quality.documentation,
        },
        "description": dataset.description,
        "description_original": dataset.description_original or dataset.description,
        "description_en": dataset.description_en or dataset.description,
        "spatial_coverage": dataset.spatial_coverage,
        "update_frequency": dataset.update_frequency,
        "last_updated": dataset.last_updated,
        "publication_date": dataset.publication_date,
        "primary_category": dataset.primary_category,
        "categories": dataset.categories,
        "category_confidence": dataset.category_confidence,
        "category_method": dataset.category_method,
        "source": dataset.source,
        "api_url": dataset.api_url,
        "schema_fields": dataset.schema_fields,
        "preview_resources": dataset.preview_resources,
        "sample_preview": dataset.sample_preview,
    }


def score_candidate_recommendations(
    candidates: Sequence[Dict[str, Any]],
    theme_confidence: Dict[str, float],
    extracted_themes: Sequence[str],
    indicator_text: str = "",
) -> List[Dict[str, Any]]:
    """Score and rank candidate datasets with broad retrieval followed by semantic reranking."""
    scored: List[Dict[str, Any]] = []
    try:
        query_vector = encode_text(_semantic_query_text(indicator_text, extracted_themes))
    except Exception:
        query_vector = []

    for candidate in candidates:
        matching = candidate["matching_themes"]
        if not matching:
            theme_match = 0.0
        else:
            confidence_component = sum(theme_confidence.get(theme, 0.5) for theme in matching) / len(matching)
            coverage_component = len(matching) / max(1, len(extracted_themes))
            theme_match = (0.7 * confidence_component) + (0.3 * coverage_component)

        quality = cast(Dict[str, float], candidate["quality"])
        quality_score = (
            quality.get("completeness", 0.5)
            + quality.get("timeliness", 0.5)
            + quality.get("consistency", 0.5)
            + quality.get("documentation", 0.5)
        ) / 4.0

        final_score = (THEME_WEIGHT * theme_match) + (QUALITY_WEIGHT * quality_score)
        compatibility = score_title_description_compatibility(
            candidate,
            indicator_text,
            extracted_themes,
            query_vector,
        )
        focused_matching = compatibility.get("focused_theme_hits", [])
        is_essential = (
            compatibility["compatibility_band"] == "strong"
            and float(compatibility["score"]) >= COMPATIBILITY_STRONG_MIN
            and bool(compatibility.get("focused_theme_hits"))
            and quality_score >= 0.62
        )

        matched_labels = ", ".join(theme.replace("_", " ") for theme in matching)
        reason = f"Matches the indicator theme(s): {matched_labels}."
        if compatibility["compatibility_band"] == "strong":
            reason += f" Strong match for your question: {compatibility['compatibility_evidence']['summary']}"
        elif compatibility["compatibility_band"] == "partial":
            reason += f" Partial match: {compatibility['compatibility_evidence']['summary']}"
        else:
            reason += f" Weak match: {compatibility['compatibility_evidence']['summary']}"

        scored.append(
            {
                "dataset_id": candidate["dataset_id"],
                "title": candidate["title"],
                "title_original": candidate.get("title_original", candidate["title"]),
                "title_en": candidate.get("title_en", candidate["title"]),
                "provider": candidate.get("provider", ""),
                "themes": candidate.get("themes", []),
                "matching_themes": matching,
                "focused_matching_themes": focused_matching,
                "theme_match_score": round(theme_match, 3),
                "quality_score": round(quality_score, 3),
                "final_score": round(final_score, 3),
                "compatibility_score": compatibility["score"],
                "compatibility_reason": compatibility["reason"],
                "semantic_score": compatibility["semantic_score"],
                "compatibility_breakdown": compatibility.get("compatibility_breakdown"),
                "compatibility_band": compatibility["compatibility_band"],
                "compatibility_evidence": compatibility["compatibility_evidence"],
                "is_essential": is_essential,
                "reason_recommended": reason,
                "quality": quality,
                "description": candidate.get("description", ""),
                "description_original": candidate.get("description_original", candidate.get("description", "")),
                "description_en": candidate.get("description_en", candidate.get("description", "")),
                "spatial_coverage": candidate.get("spatial_coverage", ""),
                "spatial_resolution": candidate.get("spatial_resolution", ""),
                "update_frequency": candidate.get("update_frequency", ""),
                "last_updated": candidate.get("last_updated", ""),
                "publication_date": candidate.get("publication_date", ""),
                "access_type": candidate.get("access_type", ""),
                "formats": candidate.get("formats", []),
                "primary_category": candidate.get("primary_category", ""),
                "categories": candidate.get("categories", []),
                "category_confidence": candidate.get("category_confidence", 0.0),
                "category_method": candidate.get("category_method", "rule"),
                "source": candidate.get("source", ""),
                "api_url": candidate.get("api_url", ""),
                "schema_fields": candidate.get("schema_fields", []),
                "preview_resources": candidate.get("preview_resources", []),
                "sample_preview": candidate.get("sample_preview", []),
                "search_rank": candidate.get("search_rank", 1_000_000),
            }
        )

    scored = _ensure_selected_theme_essentials(scored, extracted_themes)
    scored.sort(
        key=lambda item: (
            bool(item.get("is_essential", False)),
            float(item.get("compatibility_score", 0.0)),
            float(item.get("semantic_score", 0.0)),
            float(item.get("final_score", 0.0)),
            -int(item.get("search_rank", 1_000_000)),
        ),
        reverse=True,
    )
    return scored
