"""Mappers from internal state/models to API response schemas."""
from __future__ import annotations

from typing import Any, Dict, Sequence

from .api_schemas import (
    DatasetCatalogResponse,
    DatasetItem,
    FullCatalogImportProgressResponse,
    RecommendResponse,
)
from .catalog_translation import ensure_dataset_translations
from .models import Dataset, GraphState


def _has_preview_payload(value: Dict[str, Any]) -> bool:
    return bool(
        value.get("schema_fields")
        or value.get("preview_resources")
        or value.get("sample_preview")
    )


def dataset_quality_payload(dataset: Dataset) -> Dict[str, float]:
    """Return the public numeric quality payload for a Dataset."""
    return {
        "completeness": dataset.quality.completeness,
        "timeliness": dataset.quality.timeliness,
        "consistency": dataset.quality.consistency,
        "documentation": dataset.quality.documentation,
    }


def dataset_to_item(dataset: Dataset, is_essential: bool = False) -> DatasetItem:
    """Map an internal Dataset to the public DatasetItem contract."""
    ensure_dataset_translations(dataset)
    return DatasetItem(
        dataset_id=dataset.dataset_id,
        title=dataset.title_en or dataset.title,
        title_original=dataset.title_original or dataset.title,
        title_en=dataset.title_en or dataset.title,
        provider=dataset.provider,
        themes=dataset.themes,
        matching_themes=[],
        spatial_coverage=dataset.spatial_coverage,
        spatial_resolution=dataset.spatial_resolution,
        update_frequency=dataset.update_frequency,
        last_updated=dataset.last_updated,
        publication_date=dataset.publication_date,
        access_type=dataset.access_type,
        formats=dataset.formats,
        quality=dataset_quality_payload(dataset),
        description=dataset.description_en or dataset.description,
        description_original=dataset.description_original or dataset.description,
        description_en=dataset.description_en or dataset.description,
        is_essential=is_essential,
        source=getattr(dataset, "source", ""),
        api_url=getattr(dataset, "api_url", ""),
        primary_category=getattr(dataset, "primary_category", ""),
        categories=getattr(dataset, "categories", []),
        category_confidence=getattr(dataset, "category_confidence", 0.0),
        category_method=getattr(dataset, "category_method", "rule"),
        schema_fields=getattr(dataset, "schema_fields", []),
        preview_available=bool(
            getattr(dataset, "schema_fields", [])
            or getattr(dataset, "preview_resources", [])
            or getattr(dataset, "sample_preview", [])
        ),
    )


def recommendation_to_item(recommendation: Dict[str, Any]) -> DatasetItem:
    """Map a scored recommendation state dictionary to DatasetItem."""
    title_original = recommendation.get("title_original") or recommendation.get("title", "")
    title_en = recommendation.get("title_en") or recommendation.get("title", "")
    description_original = recommendation.get("description_original") or recommendation.get("description", "")
    description_en = recommendation.get("description_en") or recommendation.get("description", "")
    return DatasetItem(
        dataset_id=recommendation.get("dataset_id", ""),
        title=title_en,
        title_original=title_original,
        title_en=title_en,
        provider=recommendation.get("provider", ""),
        themes=recommendation.get("themes", []),
        matching_themes=recommendation.get("matching_themes", []),
        spatial_coverage=recommendation.get("spatial_coverage", ""),
        spatial_resolution=recommendation.get("spatial_resolution", ""),
        update_frequency=recommendation.get("update_frequency", ""),
        last_updated=recommendation.get("last_updated", ""),
        publication_date=recommendation.get("publication_date", ""),
        access_type=recommendation.get("access_type", ""),
        formats=recommendation.get("formats", []),
        quality=recommendation.get("quality", {}),
        description=description_en,
        description_original=description_original,
        description_en=description_en,
        reason_recommended=recommendation.get("reason_recommended"),
        relevance_score=recommendation.get("final_score"),
        is_essential=bool(recommendation.get("is_essential", False)),
        source=recommendation.get("source"),
        api_url=recommendation.get("api_url"),
        primary_category=recommendation.get("primary_category"),
        categories=recommendation.get("categories"),
        category_confidence=recommendation.get("category_confidence"),
        category_method=recommendation.get("category_method"),
        schema_fields=recommendation.get("schema_fields", []),
        preview_available=_has_preview_payload(recommendation),
    )


def recommendation_response_from_state(state: GraphState) -> RecommendResponse:
    """Map recommendation workflow state to the public response model."""
    return RecommendResponse(
        recommendations=[
            recommendation_to_item(recommendation)
            for recommendation in state.get("scored_recommendations", [])
        ],
        data_gaps=state.get("gaps", []),
        quality_risks=[{"risk": risk} for risk in state.get("risks", [])],
    )


def catalog_response_from_datasets(datasets: Sequence[Dataset]) -> DatasetCatalogResponse:
    """Map catalog datasets to the public catalog response model."""
    items = [dataset_to_item(dataset, is_essential=False) for dataset in datasets]
    return DatasetCatalogResponse(datasets=items, total_count=len(items))


def full_import_progress_response(
    requested_source: str,
    progress_payload: Dict[str, Any],
) -> FullCatalogImportProgressResponse:
    """Map full-import progress data to the public progress schema."""
    return FullCatalogImportProgressResponse(
        requested_source=requested_source,
        **progress_payload,
    )
