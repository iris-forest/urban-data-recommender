"""Pydantic request and response schemas for the FastAPI boundary."""
from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    """Request to analyze an indicator description."""

    indicator_text: str = Field(..., min_length=10, description="Natural language description of the indicator")


class AnalyzeResponse(BaseModel):
    """Response with parsed indicator and extracted themes."""

    parsed_indicator: Dict = Field(..., description="Parsed geographic level, time frame, population")
    extracted_themes: List[str] = Field(..., description="Top themes extracted from the indicator")
    theme_confidence: Dict[str, float] = Field(..., description="Confidence scores for each theme")
    debug_trace: Optional[List[str]] = Field(None, description="Debug information (development only)")


class RecommendRequest(BaseModel):
    """Request to get dataset recommendations."""

    indicator_text: str = Field(..., min_length=10, description="Natural language description of the indicator")
    extracted_themes: Optional[List[str]] = Field(None, description="Pre-extracted themes (optional)")


class DatasetItem(BaseModel):
    """Simplified dataset for API responses."""

    dataset_id: str
    title: str
    title_original: str = ""
    title_en: str = ""
    provider: str
    themes: List[str]
    matching_themes: List[str] = Field(default_factory=list)
    spatial_coverage: str
    spatial_resolution: str
    update_frequency: str
    last_updated: str
    publication_date: str = ""
    access_type: str
    formats: List[str]
    quality: Dict
    description: str
    description_original: str = ""
    description_en: str = ""
    reason_recommended: Optional[str] = None
    relevance_score: Optional[float] = None
    is_essential: bool = False
    source: Optional[str] = None
    api_url: Optional[str] = None
    primary_category: Optional[str] = None
    categories: Optional[List[Dict[str, float]]] = None
    category_confidence: Optional[float] = None
    category_method: Optional[str] = None
    schema_fields: Optional[List[Dict[str, str]]] = None
    preview_available: bool = False


class RecommendResponse(BaseModel):
    """Response with ranked dataset recommendations."""

    recommendations: List[DatasetItem]
    data_gaps: List[Dict] = Field(default_factory=list, description="Identified data gaps")
    quality_risks: List[Dict] = Field(default_factory=list, description="Data quality risks")


class DatasetCatalogResponse(BaseModel):
    """Response with full dataset catalog."""

    datasets: List[DatasetItem]
    total_count: int


class DatasetPreviewColumn(BaseModel):
    name: str
    inferred_type: str = "unknown"
    description: str = ""


class DatasetPreviewResponse(BaseModel):
    dataset_id: str
    columns: List[DatasetPreviewColumn] = Field(default_factory=list)
    rows: List[Dict[str, object]] = Field(default_factory=list)
    source_url: str = ""
    resource_name: str = ""
    resource_format: str = ""
    message: Optional[str] = None


class DatasetFitAnalysisRequest(BaseModel):
    indicator_text: str = Field(..., min_length=10, description="Natural language description of the indicator")
    selected_themes: List[str] = Field(default_factory=list, description="Themes selected by the user")
    dataset_ids: List[str] = Field(default_factory=list, description="Selected dataset ids to analyze")
    dataset_snapshots: List[Dict[str, Any]] = Field(default_factory=list, description="Optional selected dataset metadata snapshots")
    parsed_indicator: Dict[str, Any] = Field(default_factory=dict, description="Parsed indicator context from /analyze")
    preview_rows: int = Field(5, ge=1, le=10, description="Maximum preview rows per dataset")


class DatasetFitColumnInsight(BaseModel):
    name: str
    inferred_type: str = "unknown"
    semantic_role: str = "unknown"
    sample_values: List[str] = Field(default_factory=list)
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    notes: str = ""


class DatasetFitInsight(BaseModel):
    dataset_id: str
    title: str
    provider: str = ""
    formats: List[str] = Field(default_factory=list)
    source_url: str = ""
    fit_score: int = Field(0, ge=0, le=100)
    recommended_role: str = "supporting"
    fit_summary: str = ""
    useful_columns: List[DatasetFitColumnInsight] = Field(default_factory=list)
    limitations: List[str] = Field(default_factory=list)
    missing_requirements: List[str] = Field(default_factory=list)
    join_keys: List[str] = Field(default_factory=list)
    time_fields: List[str] = Field(default_factory=list)
    geo_fields: List[str] = Field(default_factory=list)
    quality_risks: List[str] = Field(default_factory=list)
    recommended_next_action: str = ""


class CrossDatasetFitSummary(BaseModel):
    summary: str = ""
    join_strategy: List[str] = Field(default_factory=list)
    gaps: List[str] = Field(default_factory=list)
    recommended_workflow: List[str] = Field(default_factory=list)


class DatasetFitAnalysisResponse(BaseModel):
    insight_source: str = "heuristic"
    datasets: List[DatasetFitInsight] = Field(default_factory=list)
    recommended_dataset_ids: List[str] = Field(default_factory=list)
    cross_dataset_summary: CrossDatasetFitSummary = Field(default_factory=CrossDatasetFitSummary)
    warnings: List[str] = Field(default_factory=list)


class SemanticSearchRequest(BaseModel):
    query: str = Field(..., min_length=3, description="Semantic search query")
    limit: int = Field(10, ge=1, le=50, description="Maximum number of results")


class SemanticSearchItem(BaseModel):
    id: str
    title: str
    description: str
    tags: List[str] = Field(default_factory=list)
    risk_notes: List[str] = Field(default_factory=list)
    recommended_usage: List[str] = Field(default_factory=list)
    last_updated: str = ""
    source: str = ""
    source_url: str = ""
    score: float = 0.0


class SemanticSearchResponse(BaseModel):
    results: List[SemanticSearchItem]
    total_count: int


class TopicSuggestRequest(BaseModel):
    indicator_text: str = Field(..., min_length=10, description="Natural language indicator text")


class TopicSuggestResponse(BaseModel):
    parsed_indicator: Dict = Field(default_factory=dict)
    topics: List[str] = Field(default_factory=list)
    theme_confidence: Dict[str, float] = Field(default_factory=dict)
    method: str = "keywords"
    debug_trace: List[str] = Field(default_factory=list)


class PackageCreateRequest(BaseModel):
    dataset_ids: Optional[List[str]] = Field(None, description="Selected dataset ids to package")
    query: Optional[str] = Field(None, description="Fallback semantic query if dataset ids are not supplied")
    limit: int = Field(5, ge=1, le=20, description="Maximum number of datasets when using query fallback")


class EnrichSummariesRequest(BaseModel):
    dataset_ids: Optional[List[str]] = Field(None, description="Specific dataset IDs to enrich (all if omitted)")
    force_regenerate: bool = Field(False, description="Force regeneration even if already enriched")


class LLMSettingsResponse(BaseModel):
    enabled: bool = Field(..., description="Whether LLM insights are enabled")
    provider: str = Field(..., description="LLM provider name or 'heuristic'")
    source: str = Field(..., description="Human-readable insight source")


class ImportSource(str, Enum):
    """Canonical external source identifiers used by the frontend API contract."""

    MADRID_CKAN = "madrid-ckan"
    DATOS_GOB_ES = "datos-gob-es"


class ImportSourceResponse(BaseModel):
    imported_count: int
    requested_source: ImportSource
    mapped_source: str
    session_dir: str
    dataset_ids: List[str]


class ClearImportSourceResponse(BaseModel):
    cleared_count: int
    requested_source: Optional[ImportSource] = None
    mapped_source: Optional[str] = None
    dataset_ids: List[str]


class FullCatalogImportProgressResponse(BaseModel):
    source: str
    requested_source: ImportSource
    status: str
    fetched_count: int = 0
    normalized_count: int = 0
    total_count: Optional[int] = None
    current_page: Optional[int] = None
    current_offset: Optional[int] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    last_error: Optional[str] = None
    raw_snapshot_count: int = 0
    normalized_cache_path: str = ""
    manifest_path: str = ""
    is_stale: bool = False
    cache_updated_at: Optional[str] = None
