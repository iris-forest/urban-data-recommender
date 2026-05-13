"""Pure recommendation candidate shaping and scoring."""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, cast

from ..catalog_translation import ensure_dataset_translations
from ..models import Dataset
from .theme_matching import infer_dataset_theme_overlap


QUALITY_WEIGHT = 0.3
THEME_WEIGHT = 0.7
MULTI_THEME_ESSENTIAL_MIN_THEME_MATCH = 0.72
MULTI_THEME_ESSENTIAL_MIN_QUALITY = 0.70
MULTI_THEME_ESSENTIAL_MIN_FINAL = 0.74
SINGLE_THEME_ESSENTIAL_MIN_THEME_MATCH = 0.88
SINGLE_THEME_ESSENTIAL_MIN_QUALITY = 0.82
SINGLE_THEME_ESSENTIAL_MIN_FINAL = 0.84


def _recommendation_key(recommendation: Dict[str, Any]) -> str:
    return str(recommendation.get("dataset_id") or recommendation.get("title") or id(recommendation))


def _recommendation_search_priority(recommendation: Dict[str, Any]) -> tuple[int, int]:
    location_text = " ".join(
        str(recommendation.get(key, ""))
        for key in ("title", "provider", "spatial_coverage", "source")
    ).lower()
    local_priority = 0 if "madrid" in location_text else 1
    return local_priority, int(recommendation.get("search_rank", 1_000_000))


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
    """Mark the strongest available representative for each selected theme essential."""
    for theme_id in dict.fromkeys(extracted_themes):
        already_covered = any(
            recommendation.get("is_essential")
            and theme_id in recommendation.get("matching_themes", [])
            for recommendation in scored
        )
        if already_covered:
            continue

        eligible = [
            recommendation
            for recommendation in scored
            if theme_id in recommendation.get("matching_themes", [])
        ]
        if not eligible:
            continue

        best_match = max(
            eligible,
            key=lambda recommendation: (
                float(recommendation.get("final_score", 0.0)),
                float(recommendation.get("theme_match_score", 0.0)),
                float(recommendation.get("quality_score", 0.0)),
            ),
        )
        best_match["is_essential"] = True
        theme_label = theme_id.replace("_", " ")
        reason = str(best_match.get("reason_recommended", "")).strip()
        addendum = (
            f" Pre-selected as the strongest available dataset for the selected {theme_label} theme."
        )
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
) -> List[Dict[str, Any]]:
    """Score and rank candidate datasets with deterministic weighting."""
    scored: List[Dict[str, Any]] = []

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
        multi_theme_coverage = len(matching) >= 2 and len(extracted_themes) >= 2
        is_essential = (
            (
                multi_theme_coverage
                and theme_match >= MULTI_THEME_ESSENTIAL_MIN_THEME_MATCH
                and quality_score >= MULTI_THEME_ESSENTIAL_MIN_QUALITY
                and final_score >= MULTI_THEME_ESSENTIAL_MIN_FINAL
            )
            or (
                len(matching) == 1
                and theme_match >= SINGLE_THEME_ESSENTIAL_MIN_THEME_MATCH
                and quality_score >= SINGLE_THEME_ESSENTIAL_MIN_QUALITY
                and final_score >= SINGLE_THEME_ESSENTIAL_MIN_FINAL
            )
        )

        matched_labels = ", ".join(theme.replace("_", " ") for theme in matching)
        reason = f"Matches the indicator theme(s): {matched_labels}."
        if is_essential:
            reason += " Classified as essential because it has strong theme coverage and quality signals."
        else:
            reason += " Useful as an optional supporting dataset for the selected indicator."

        scored.append(
            {
                "dataset_id": candidate["dataset_id"],
                "title": candidate["title"],
                "provider": candidate.get("provider", ""),
                "themes": candidate.get("themes", []),
                "matching_themes": matching,
                "theme_match_score": round(theme_match, 3),
                "quality_score": round(quality_score, 3),
                "final_score": round(final_score, 3),
                "is_essential": is_essential,
                "reason_recommended": reason,
                "quality": quality,
                "description": candidate.get("description", ""),
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

    scored.sort(key=lambda item: item["final_score"], reverse=True)
    promoted = _promote_theme_coverage(scored, extracted_themes)
    return _ensure_selected_theme_essentials(promoted, extracted_themes)
