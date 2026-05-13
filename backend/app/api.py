"""FastAPI application for the Urban Planner Dataset Assistant.

This module is the HTTP boundary. It keeps request validation, response shape
mapping, and transport-level errors here while delegating business logic to the
application, domain, catalog, preview, and package modules.
"""

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Optional
from datetime import datetime
from fastapi.responses import Response
import logging

from .api_mappers import (
    catalog_response_from_datasets,
    full_import_progress_response,
    recommendation_response_from_state,
)
from .api_schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    ClearImportSourceResponse,
    DatasetCatalogResponse,
    DatasetFitAnalysisRequest,
    DatasetFitAnalysisResponse,
    DatasetPreviewResponse,
    EnrichSummariesRequest,
    FullCatalogImportProgressResponse,
    ImportSource,
    ImportSourceResponse,
    LLMSettingsResponse,
    PackageCreateRequest,
    RecommendRequest,
    RecommendResponse,
    SemanticSearchItem,
    SemanticSearchRequest,
    SemanticSearchResponse,
    TopicSuggestRequest,
    TopicSuggestResponse,
)
from .application.dataset_fit_analysis import analyze_selected_dataset_fit
from .application.recommend_datasets import analyze_indicator_state, recommend_datasets_state
from .catalog import get_dataset_by_id, get_full_catalog, load_persisted_summaries
from .catalog import import_api_source, clear_imported_api_source
from .embeddings import semantic_search_summaries
from .full_catalog_import import FULL_IMPORT_MANAGER, FULL_IMPORT_SOURCES
from .package_builder import build_package_for_query, build_package_manifest
from .preview import build_dataset_preview
from .llm_insights import enrich_dataset_summary, is_llm_enabled, get_insight_source
from .storage import write_imported_datasets
from .config import Config

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.DEBUG if Config.DEBUG else logging.INFO)


IMPORT_SOURCE_TO_BACKEND: Dict[str, str] = {
    ImportSource.MADRID_CKAN.value: "madrid_ckan",
    ImportSource.DATOS_GOB_ES.value: "datos_gob_es",
}

# Backward-compatible aliases accepted by backend, normalized to canonical IDs.
IMPORT_SOURCE_ALIASES: Dict[str, str] = {
    "madrid_ckan": ImportSource.MADRID_CKAN.value,
    "datos_gob_es": ImportSource.DATOS_GOB_ES.value,
    "datos-gob": ImportSource.DATOS_GOB_ES.value,
}


def normalize_import_source(raw_source: str) -> Optional[str]:
    if raw_source in IMPORT_SOURCE_TO_BACKEND:
        return raw_source
    return IMPORT_SOURCE_ALIASES.get(raw_source)


def _full_import_progress_response(
    requested_source: str,
    mapped_source: str,
) -> FullCatalogImportProgressResponse:
    progress = FULL_IMPORT_MANAGER.get_progress(mapped_source)
    return full_import_progress_response(requested_source, progress.to_dict())


# =============================================================================
# Application Setup
# =============================================================================

app = FastAPI(
    title="Urban Planner Dataset Assistant API",
    description="Backend API for matching urban planning indicators to datasets",
    version="0.1.0"
)

# CORS is configured from environment-backed settings so local Vite fallback
# ports and deployed frontend origins can be handled without changing endpoint
# code.
app.add_middleware(
    CORSMiddleware,
    allow_origins=Config.CORS_ORIGINS,
    allow_origin_regex=Config.CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# Indicator Analysis And Dataset Recommendations
# =============================================================================

@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_indicator(request: AnalyzeRequest) -> AnalyzeResponse:
    """
    Parse indicator text and extract themes.
    
    Takes a natural language description of an indicator and:
    1. Validates the input
    2. Parses it for geographic level, time frame, population
    3. Extracts relevant data themes with confidence scores
    
    Example:
    ```
    POST /analyze
    {
        "indicator_text": "I need to analyze bus stop accessibility by neighborhood in Madrid"
    }
    ```
    """
    try:
        state = analyze_indicator_state(request.indicator_text)
        if state.get("errors"):
            raise HTTPException(status_code=400, detail=state["errors"][0])

        return AnalyzeResponse(
            parsed_indicator=state.get("parsed_indicator", {}),
            extracted_themes=state.get("extracted_themes", []),
            theme_confidence=state.get("theme_confidence", {}),
            debug_trace=state.get("debug_trace"),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error analyzing indicator: {str(e)}")


@app.post("/topics/suggest", response_model=TopicSuggestResponse)
async def suggest_topics(request: TopicSuggestRequest) -> TopicSuggestResponse:
    """Suggest topics and parsed indicator context for confirmation in the UI."""
    try:
        state = analyze_indicator_state(request.indicator_text)
        if state.get("errors"):
            raise HTTPException(status_code=400, detail=state["errors"][0])

        return TopicSuggestResponse(
            parsed_indicator=state.get("parsed_indicator", {}),
            topics=state.get("extracted_themes", []),
            theme_confidence=state.get("theme_confidence", {}),
            method="keywords",
            debug_trace=state.get("debug_trace", []),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Topic suggestion failed: {str(e)}")


@app.post("/recommend", response_model=RecommendResponse)
async def get_recommendations(request: RecommendRequest) -> RecommendResponse:
    """
    Get ranked dataset recommendations for an indicator.
    
    Takes an indicator description and optional themes, then:
    1. Finds relevant datasets from catalog
    2. Scores them based on theme match + quality
    3. Identifies data gaps and quality risks
    
    Example:
    ```
    POST /recommend
    {
        "indicator_text": "I need to analyze bus stop accessibility by neighborhood",
        "extracted_themes": ["transport_networks", "population"]
    }
    ```
    """
    try:
        state = recommend_datasets_state(
            indicator_text=request.indicator_text,
            extracted_themes=request.extracted_themes,
        )
        if state.get("errors"):
            raise HTTPException(status_code=400, detail=state["errors"][0])

        return recommendation_response_from_state(state)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Recommendation request failed")
        raise HTTPException(status_code=500, detail=f"Error getting recommendations: {str(e)}")


# =============================================================================
# Catalog Browsing, Preview, And Dataset Fit Review
# =============================================================================

@app.get("/datasets", response_model=DatasetCatalogResponse)
async def get_datasets_catalog(
    include_apis: bool = False,
    source: Optional[str] = None,
) -> DatasetCatalogResponse:
    """
    Get the dataset catalog.
    
    If 'source' query param is provided, returns only datasets for that source.
    Otherwise returns all available datasets in the catalog with their metadata.
    Useful for browsing and exploring the full available data.
    
    Query Parameters:
        include_apis (bool): Include API-sourced datasets. Default: False
        source (str, optional): Filter to datasets from a specific source (madrid_ckan, datos_gob_es, etc.)
    """
    try:
        catalog = get_full_catalog(include_apis=include_apis)
        
        # Filter by source if provided
        if source:
            catalog = [ds for ds in catalog if getattr(ds, "source", "") == source]
        
        return catalog_response_from_datasets(catalog)
    except Exception as e:
        logger.exception("Dataset catalog request failed")
        raise HTTPException(status_code=500, detail=f"Error fetching catalog: {str(e)}")


@app.get("/datasets/{dataset_id}/preview", response_model=DatasetPreviewResponse)
async def get_dataset_preview(
    dataset_id: str,
    rows: int = Query(5, ge=1, le=10),
) -> DatasetPreviewResponse:
    """Return lightweight schema metadata and a lazy sample row preview."""
    try:
        dataset = get_dataset_by_id(dataset_id, include_apis=True)
        if dataset is None:
            raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' was not found")

        return DatasetPreviewResponse(**build_dataset_preview(dataset, max_rows=rows))
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Dataset preview request failed for %s", dataset_id)
        raise HTTPException(status_code=500, detail=f"Error fetching dataset preview: {str(e)}")


@app.post("/datasets/analyze-fit", response_model=DatasetFitAnalysisResponse)
async def analyze_dataset_fit(request: DatasetFitAnalysisRequest) -> DatasetFitAnalysisResponse:
    """Analyze selected datasets against the indicator using columns and preview rows."""
    try:
        return analyze_selected_dataset_fit(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as e:
        logger.exception("Dataset fit analysis failed")
        raise HTTPException(status_code=500, detail=f"Error analyzing selected datasets: {str(e)}")


@app.get("/health")
async def health_check() -> Dict:
    """Simple health check endpoint."""
    return {
        "status": "ok",
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.post("/import/{source}", response_model=ImportSourceResponse)
async def import_source(source: str):
    """Trigger an import from an external API source and persist results to disk.

    Source must be one of: 'madrid-ckan', 'datos-gob-es'. This endpoint will:
    1. Fetch datasets from the adapter
    2. Write metadata CSVs to backend/imports/{timestamp}/{source}/
    3. Update the global datasets_mapping.json
    4. Merge with in-memory catalog
    
    The imported datasets will be included by `GET /datasets?include_apis=true` or
    `GET /datasets?source={source}` until the server restarts (or mapping is explicitly cleared).
    
    Returns:
        - imported_count: Number of datasets imported
        - requested_source: Original source name from request
        - mapped_source: Backend adapter name used
        - session_dir: Timestamp directory where files were written
        - dataset_ids: List of dataset IDs written
    """
    try:
        canonical_source = normalize_import_source(source)
        if not canonical_source:
            valid = ", ".join(s.value for s in ImportSource)
            raise HTTPException(
                status_code=400,
                detail=f"Unknown import source '{source}'. Valid values: {valid}",
            )

        mapped = IMPORT_SOURCE_TO_BACKEND[canonical_source]

        # Quick imports fetch a bounded slice for interactive exploration.
        new = import_api_source(mapped)
        
        if not new:
            raise HTTPException(
                status_code=400,
                detail=f"No datasets found for source '{canonical_source}' or import failed",
            )
        
        # Imported metadata is persisted for inspection while the active catalog
        # stays in process memory for fast recommendation reads.
        storage_result = write_imported_datasets(mapped, new)
        logger.info("Imported %s datasets from %s", len(new), mapped)
        
        return ImportSourceResponse(
            imported_count=len(new),
            requested_source=canonical_source,
            mapped_source=mapped,
            session_dir=storage_result["session_dir"],
            dataset_ids=storage_result["dataset_ids"],
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Import failed for source %s", source)
        raise HTTPException(status_code=500, detail=f"Import failed: {e}")


@app.post("/import/{source}/full", response_model=FullCatalogImportProgressResponse)
async def import_full_catalog(source: str, background_tasks: BackgroundTasks) -> FullCatalogImportProgressResponse:
    """Start a background full-catalog import for a supported source.

    Unlike the quick import endpoint, this paginates through the source catalog,
    stores raw API snapshots under `backend/data/cache/raw/`, writes normalized
    Dataset records to JSONL, and updates a manifest with progress details.
    Calling this endpoint again after completion or failure starts a refresh.
    """
    try:
        canonical_source = normalize_import_source(source)
        if not canonical_source:
            valid = ", ".join(s.value for s in ImportSource)
            raise HTTPException(
                status_code=400,
                detail=f"Unknown import source '{source}'. Valid values: {valid}",
            )

        mapped = IMPORT_SOURCE_TO_BACKEND[canonical_source]
        if mapped not in FULL_IMPORT_SOURCES:
            raise HTTPException(
                status_code=400,
                detail=f"Full catalog import is not supported for '{canonical_source}'",
            )

        started, should_schedule = FULL_IMPORT_MANAGER.start(mapped)
        if should_schedule:
            background_tasks.add_task(FULL_IMPORT_MANAGER.run, mapped)

        return full_import_progress_response(canonical_source, started.to_dict())
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Full catalog import start failed for source %s", source)
        raise HTTPException(status_code=500, detail=f"Full catalog import failed to start: {e}")


@app.post("/import/{source}/full/rebuild", response_model=FullCatalogImportProgressResponse)
async def rebuild_full_catalog_cache(source: str, background_tasks: BackgroundTasks) -> FullCatalogImportProgressResponse:
    """Rebuild normalized full-catalog cache records from raw cached snapshots."""
    try:
        canonical_source = normalize_import_source(source)
        if not canonical_source:
            valid = ", ".join(s.value for s in ImportSource)
            raise HTTPException(
                status_code=400,
                detail=f"Unknown import source '{source}'. Valid values: {valid}",
            )

        mapped = IMPORT_SOURCE_TO_BACKEND[canonical_source]
        if mapped not in FULL_IMPORT_SOURCES:
            raise HTTPException(
                status_code=400,
                detail=f"Full catalog cache rebuild is not supported for '{canonical_source}'",
            )

        started, should_schedule = FULL_IMPORT_MANAGER.start_rebuild(mapped)
        if should_schedule:
            background_tasks.add_task(FULL_IMPORT_MANAGER.rebuild_from_raw, mapped)

        return full_import_progress_response(canonical_source, started.to_dict())
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Full catalog cache rebuild start failed for source %s", source)
        raise HTTPException(status_code=500, detail=f"Full catalog cache rebuild failed to start: {e}")


@app.get("/import/{source}/full/progress", response_model=FullCatalogImportProgressResponse)
async def get_full_catalog_import_progress(source: str) -> FullCatalogImportProgressResponse:
    """Return progress for a source full-catalog import job or its cached manifest."""
    try:
        canonical_source = normalize_import_source(source)
        if not canonical_source:
            valid = ", ".join(s.value for s in ImportSource)
            raise HTTPException(
                status_code=400,
                detail=f"Unknown import source '{source}'. Valid values: {valid}",
            )

        mapped = IMPORT_SOURCE_TO_BACKEND[canonical_source]
        if mapped not in FULL_IMPORT_SOURCES:
            raise HTTPException(
                status_code=400,
                detail=f"Full catalog import is not supported for '{canonical_source}'",
            )

        return _full_import_progress_response(canonical_source, mapped)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Full catalog import progress failed for source %s", source)
        raise HTTPException(status_code=500, detail=f"Full catalog import progress failed: {e}")


@app.delete("/import/{source}", response_model=ClearImportSourceResponse)
async def clear_import_source(source: str) -> ClearImportSourceResponse:
    """Clear imported datasets from the active runtime catalog for one source."""
    try:
        canonical_source = normalize_import_source(source)
        if not canonical_source:
            valid = ", ".join(s.value for s in ImportSource)
            raise HTTPException(
                status_code=400,
                detail=f"Unknown import source '{source}'. Valid values: {valid}",
            )

        mapped = IMPORT_SOURCE_TO_BACKEND[canonical_source]
        removed_ids = clear_imported_api_source(mapped)
        logger.info("Cleared %s imported datasets from %s", len(removed_ids), mapped)

        return ClearImportSourceResponse(
            cleared_count=len(removed_ids),
            requested_source=canonical_source,
            mapped_source=mapped,
            dataset_ids=removed_ids,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Clear import failed for source %s", source)
        raise HTTPException(status_code=500, detail=f"Clear import failed: {e}")


@app.delete("/imports", response_model=ClearImportSourceResponse)
async def clear_all_import_sources() -> ClearImportSourceResponse:
    """Clear all imported datasets from the active runtime catalog."""
    try:
        removed_ids = clear_imported_api_source(None)
        logger.info("Cleared %s imported datasets from all sources", len(removed_ids))
        return ClearImportSourceResponse(
            cleared_count=len(removed_ids),
            requested_source=None,
            mapped_source=None,
            dataset_ids=removed_ids,
        )
    except Exception as e:
        logger.exception("Clear all imports failed")
        raise HTTPException(status_code=500, detail=f"Clear imports failed: {e}")


# =============================================================================
# Packaging, Summaries, And Optional LLM Enrichment
# =============================================================================

@app.post("/summaries/search", response_model=SemanticSearchResponse)
async def semantic_search(request: SemanticSearchRequest) -> SemanticSearchResponse:
    """Search persisted dataset summaries using the lightweight vector index."""
    try:
        summaries = load_persisted_summaries()
        matches = semantic_search_summaries(request.query, summaries, limit=request.limit)

        results = [
            SemanticSearchItem(
                id=match.summary.id,
                title=match.summary.title,
                description=match.summary.description,
                tags=match.summary.tags,
                risk_notes=match.summary.risk_notes,
                recommended_usage=match.summary.recommended_usage,
                last_updated=match.summary.last_updated,
                source=match.summary.source,
                source_url=match.summary.source_url,
                score=match.score,
            )
            for match in matches
        ]
        return SemanticSearchResponse(results=results, total_count=len(results))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Semantic search failed: {str(e)}")


@app.post("/package/create")
async def create_package(request: PackageCreateRequest):
    """Create a downloadable zip package for selected dataset summaries."""
    try:
        package_bytes, resolved_ids = build_package_for_query(
            dataset_ids=request.dataset_ids,
            query=request.query or "",
            limit=request.limit,
        )

        filename = "urban-planner-dataset-package.zip"
        if resolved_ids:
            filename = f"urban-planner-datasets-{len(resolved_ids)}.zip"

        return Response(
            content=package_bytes,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Package creation failed: {str(e)}")


@app.post("/package/manifest")
async def create_package_manifest(request: PackageCreateRequest):
    """Create the same JSON manifest used inside the downloadable package."""
    try:
        dataset_ids = [dataset_id for dataset_id in (request.dataset_ids or []) if dataset_id]
        if not dataset_ids and request.query:
            from .embeddings import semantic_search_summaries

            summaries = load_persisted_summaries()
            matches = semantic_search_summaries(request.query, summaries, limit=request.limit)
            dataset_ids = [match.summary.id for match in matches]

        return build_package_manifest(dataset_ids)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Package manifest creation failed: {str(e)}")

@app.get("/settings/llm", response_model=LLMSettingsResponse)
async def get_llm_settings():
    """Get current LLM insights configuration."""
    return LLMSettingsResponse(
        enabled=is_llm_enabled(),
        provider="heuristic" if not is_llm_enabled() else "LLM",
        source=get_insight_source(),
    )


@app.post("/summaries/enrich")
async def enrich_summaries(request: EnrichSummariesRequest):
    """Regenerate insights for summaries using LLM or heuristics.
    
    This endpoint allows on-demand enrichment of dataset summaries with
    improved risk notes, column descriptions, and usage recommendations.
    """
    try:
        summaries = load_persisted_summaries()
        if not summaries:
            raise ValueError("No persisted summaries found")
        
        # Enrichment can target specific summaries or refresh everything.
        to_enrich = summaries
        if request.dataset_ids:
            to_enrich = [s for s in summaries if s.id in request.dataset_ids]
            if not to_enrich:
                raise ValueError("None of the requested IDs found in summaries")
        
        # Summary enrichment keeps the persisted summary shape while improving
        # explanatory text through the configured LLM or heuristic fallback.
        enriched_count = 0
        for summary in to_enrich:
            summary = enrich_dataset_summary(summary)
            enriched_count += 1
        
        return {
            "enriched_count": enriched_count,
            "total_summaries": len(summaries),
            "llm_enabled": is_llm_enabled(),
            "source": get_insight_source(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Enrichment failed: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
