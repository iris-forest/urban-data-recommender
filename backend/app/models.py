"""Core data models for the Urban Planner Dataset Assistant prototype.

These are lightweight stdlib dataclasses so the app can stay dependency-free
while the MVP is being assembled.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, TypedDict, Optional


@dataclass(slots=True)
class IndicatorParsed:
    geographic_level: str = "unknown"
    time_frame: str = "unknown"
    population: str = ""
    attributes: List[str] = field(default_factory=list)


@dataclass(slots=True)
class Indicator:
    id: str
    raw_text: str
    parsed: IndicatorParsed = field(default_factory=IndicatorParsed)
    extracted_themes: List[str] = field(default_factory=list)


@dataclass(slots=True)
class DatasetQuality:
    completeness: float = 0.0
    timeliness: float = 0.0
    consistency: float = 0.0
    documentation: float = 0.0


@dataclass(slots=True)
class Dataset:
    dataset_id: str
    title: str
    provider: str
    themes: List[str]
    spatial_coverage: str
    spatial_resolution: str
    update_frequency: str
    last_updated: str
    access_type: str
    formats: List[str]
    quality: DatasetQuality
    description: str
    sample_preview: List[Dict[str, str]] = field(default_factory=list)
    schema_fields: List[Dict[str, Any]] = field(default_factory=list)
    preview_resources: List[Dict[str, Any]] = field(default_factory=list)
    primary_category: str = ""
    categories: List[Dict[str, float]] = field(default_factory=list)
    category_confidence: float = 0.0
    category_method: str = "rule"
    source: str = ""  # Track data origin: madrid_ckan | datos_gob_es | other adapters
    api_url: str = ""  # Original API URL if from external source
    title_original: str = ""
    title_en: str = ""
    description_original: str = ""
    description_en: str = ""
    translation_method: str = ""
    translation_version: str = ""
    publication_date: str = ""


@dataclass(slots=True)
class DatasetSummary:
    id: str
    title: str
    description: str = ""
    source: str = ""
    source_url: str = ""
    columns: List[Dict[str, Any]] = field(default_factory=list)  # {name, inferred_type, description}
    sample_rows: List[Dict[str, Any]] = field(default_factory=list)
    geo_coverage: Optional[Dict[str, Any]] = None
    time_coverage: Optional[Dict[str, Any]] = None
    license: str = ""
    tags: List[str] = field(default_factory=list)
    risk_notes: List[str] = field(default_factory=list)
    recommended_usage: List[str] = field(default_factory=list)
    embedding: Optional[List[float]] = None  # may be stored inline or referenced externally
    file_link: str = ""
    schema_version: str = "1.0"
    active: bool = True
    last_updated: str = ""
    match_reasons: List[str] = field(default_factory=list)
    size_bytes: Optional[int] = None


@dataclass(slots=True)
class Recommendation:
    dataset_id: str
    theme_match_score: float
    quality_score: float
    final_score: float
    matching_themes: List[str] = field(default_factory=list)
    is_essential: bool = False


@dataclass(slots=True)
class DataGap:
    theme_id: str
    description: str
    suggested_workarounds: List[str] = field(default_factory=list)


@dataclass(slots=True)
class Summary:
    indicator: Indicator
    recommendations: List[Recommendation] = field(default_factory=list)
    essential: List[Recommendation] = field(default_factory=list)
    optional: List[Recommendation] = field(default_factory=list)
    gaps: List[DataGap] = field(default_factory=list)
    risks: List[str] = field(default_factory=list)


class GraphState(TypedDict, total=False):
    indicator_text: str
    parsed_indicator: Dict[str, Any]
    extracted_themes: List[str]
    theme_confidence: Dict[str, float]
    candidate_datasets: List[Dict[str, Any]]
    scored_recommendations: List[Dict[str, Any]]
    essential_recommendations: List[Dict[str, Any]]
    optional_recommendations: List[Dict[str, Any]]
    selected_dataset_ids: List[str]
    gaps: List[Dict[str, Any]]
    risks: List[str]
    errors: List[str]
    debug_trace: List[str]
