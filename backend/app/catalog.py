"""Dataset catalog for the planner, centered on imported/API-backed sources.

Madrid CKAN and datos.gob.es sources are merged and deduplicated.
"""
from __future__ import annotations

import logging
from dataclasses import asdict
import json
from pathlib import Path
import re
from typing import Dict, List, Optional, Sequence, Tuple

from .config import Config
from .models import Dataset, DatasetSummary
from .storage import read_normalized_dataset_cache
from .themes import load_theme_glossary
from .domain.theme_matching import infer_dataset_theme_overlap

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SUMMARY_DIR = DATA_DIR / "summaries"
SUMMARY_FILE = SUMMARY_DIR / "summaries.json"
DEFAULT_SEARCH_LOCATION = "madrid"
FULL_CACHE_SOURCES = ("madrid_ckan", "datos_gob_es")
SEARCH_STOPWORDS = {
    "and",
    "are",
    "for",
    "last",
    "month",
    "months",
    "per",
    "the",
    "within",
    "with",
}


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").lower()).strip()


def _dataset_search_blob(dataset: Dataset) -> str:
    category_names = []
    for category in dataset.categories:
        if isinstance(category, dict):
            category_names.extend(category.keys())

    parts = [
        dataset.title,
        dataset.description,
        dataset.provider,
        dataset.primary_category,
        dataset.spatial_coverage,
        dataset.spatial_resolution,
        dataset.update_frequency,
        " ".join(dataset.themes),
        " ".join(category_names),
        dataset.source,
    ]
    return _normalize_text(" ".join(part for part in parts if part))


def _term_matches_blob(term: str, blob: str) -> bool:
    if " " in term:
        return term in blob
    return bool(re.search(rf"\b{re.escape(term)}\b", blob))


def _build_search_terms(indicator_text: str, extracted_themes: Optional[Sequence[str]] = None) -> List[str]:
    glossary = load_theme_glossary()
    terms: List[str] = [DEFAULT_SEARCH_LOCATION]

    if indicator_text:
        terms.extend(re.findall(r"[\wáéíóúñüÁÉÍÓÚÑÜ-]+", indicator_text.lower()))

    for theme_id in extracted_themes or []:
        theme_label = theme_id.replace("_", " ")
        terms.append(theme_label)
        terms.extend(glossary.get(theme_id, [])[:8])

    deduped: List[str] = []
    seen = set()
    for term in terms:
        normalized = _normalize_text(term)
        if not normalized or len(normalized) < 3:
            continue
        if normalized in SEARCH_STOPWORDS:
            continue
        if normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(normalized)

    return deduped


def _build_madrid_ckan_queries(indicator_text: str, extracted_themes: Optional[Sequence[str]] = None) -> List[str]:
    """Build short, source-friendly queries for Madrid CKAN.

    The CKAN search performs better with concise queries such as
    "madrid transporte" than with long free-text prompts.
    """
    glossary = load_theme_glossary()
    queries: List[str] = []
    seen = set()

    for theme_id in extracted_themes or []:
        keywords = glossary.get(theme_id, [])
        theme_label = theme_id.replace("_", " ")

        candidates = [theme_label]
        candidates.extend(keywords[:3])

        for candidate in candidates:
            normalized = _normalize_text(candidate)
            if not normalized:
                continue
            if normalized.startswith("madrid "):
                query = normalized
            else:
                query = f"madrid {normalized}"
            if query not in seen:
                seen.add(query)
                queries.append(query)

    if indicator_text:
        raw_terms = re.findall(r"[\wáéíóúñüÁÉÍÓÚÑÜ-]+", indicator_text.lower())[:3]
        if raw_terms:
            query = "madrid " + " ".join(raw_terms)
            if query not in seen:
                seen.add(query)
                queries.append(query)

    return queries


def _score_dataset_against_terms(
    dataset: Dataset,
    search_terms: Sequence[str],
    extracted_themes: Optional[Sequence[str]] = None,
) -> float:
    blob = _dataset_search_blob(dataset)
    title_blob = _normalize_text(dataset.title)
    theme_set = set(extracted_themes or [])
    dataset_theme_set = set(dataset.themes or [])

    term_hits = sum(1 for term in search_terms if _term_matches_blob(term, blob))
    title_hits = sum(1 for term in search_terms if _term_matches_blob(term, title_blob))
    direct_theme_overlap = theme_set.intersection(dataset_theme_set)
    inferred_theme_overlap = infer_dataset_theme_overlap(dataset, theme_set.difference(dataset_theme_set))
    theme_overlap = len(direct_theme_overlap.union(inferred_theme_overlap))

    quality_score = 0.0
    if dataset.quality:
        quality_score = (
            dataset.quality.completeness
            + dataset.quality.timeliness
            + dataset.quality.consistency
            + dataset.quality.documentation
        ) / 4.0

    recency_bonus = 0.0
    if dataset.last_updated:
        recency_bonus = 0.2 if dataset.last_updated >= "2025-01-01" else 0.0

    return (
        (term_hits * 0.45)
        + (title_hits * 0.75)
        + (theme_overlap * 2.0)
        + (quality_score * 0.5)
        + recency_bonus
    )


def load_full_catalog_cache(source: Optional[str] = None) -> List[Dataset]:
    """Load normalized full-catalog cache records, if available."""
    try:
        return read_normalized_dataset_cache(source=source)
    except Exception as exc:
        logger.warning("Full-catalog cache unavailable for %s: %s", source or "all sources", exc)
        return []


def _load_cache_by_source() -> Tuple[List[Dataset], set[str]]:
    cached: List[Dataset] = []
    cached_sources: set[str] = set()

    for source in FULL_CACHE_SOURCES:
        source_datasets = load_full_catalog_cache(source)
        if source_datasets:
            cached.extend(source_datasets)
            cached_sources.add(source)

    return cached, cached_sources


def search_relevant_datasets(
    indicator_text: str,
    extracted_themes: Optional[Sequence[str]] = None,
    limit: int = 20,
    datos_pages: int = 20,
) -> List[Dataset]:
    """Return datasets that best match the user input and extracted themes.

    This performs query-time search across enabled sources instead of loading the
    full catalog up front. Madrid CKAN is queried directly with keyword text.
    datos.gob.es is scanned page-by-page and locally ranked.
    """
    from .api_adapters import DatosGobEsAdapter, MadridCKANAdapter

    search_terms = _build_search_terms(indicator_text, extracted_themes)
    candidates: List[Dataset] = []
    cached_datasets, cached_sources = _load_cache_by_source()

    if cached_datasets:
        logger.info(
            "Including %s full-catalog cached datasets from %s",
            len(cached_datasets),
            ", ".join(sorted(cached_sources)),
        )
        candidates.extend(cached_datasets)

    # Explicit user imports should participate in recommendations even when
    # live API ingestion flags are disabled. They are already normalized to the
    # Dataset schema by the import adapters.
    if IMPORTED_API_DATASETS:
        logger.info("Including %s imported datasets in recommendation search", len(IMPORTED_API_DATASETS))
        candidates.extend(IMPORTED_API_DATASETS)

    if Config.ENABLE_MADRID_CKAN and "madrid_ckan" not in cached_sources:
        try:
            madrid_queries = _build_madrid_ckan_queries(indicator_text, extracted_themes)
            if not madrid_queries and indicator_text:
                madrid_queries = [f"madrid {indicator_text}".strip()]

            for query in madrid_queries[:6]:
                candidates.extend(
                    MadridCKANAdapter.fetch_datasets(
                        rows=Config.MADRID_CKAN_ROWS,
                        query=query,
                    )
                )
        except Exception as exc:
            logger.error(f"Madrid CKAN search failed: {exc}")

    if Config.ENABLE_DATOS_GOB_ES and "datos_gob_es" not in cached_sources:
        try:
            candidates.extend(DatosGobEsAdapter.fetch_all_datasets(max_pages=datos_pages))
        except Exception as exc:
            logger.error(f"datos.gob.es search failed: {exc}")

    summary_lookup = {summary.id: summary for summary in load_persisted_summaries()}
    ranked: List[Tuple[float, Dataset]] = []
    seen: set[str] = set()

    for dataset in candidates:
        key = dataset.dataset_id or dataset.title.lower().strip()
        if key in seen:
            continue
        seen.add(key)

        score = _score_dataset_against_terms(dataset, search_terms, extracted_themes)
        summary = summary_lookup.get(dataset.dataset_id)
        if summary:
            try:
                from .embeddings import similarity_for_summary

                semantic_score = similarity_for_summary(summary, indicator_text, extracted_themes)
                score += semantic_score * 2.2
            except Exception as exc:
                logger.debug("Semantic score unavailable for %s: %s", dataset.dataset_id, exc)
        if score <= 0:
            continue
        ranked.append((score, dataset))

    ranked.sort(
        key=lambda item: (
            item[0],
            item[1].quality.completeness if item[1].quality else 0.0,
            item[1].last_updated or "",
        ),
        reverse=True,
    )

    return [dataset for _, dataset in ranked[:limit]]


# Persisted imported datasets (in-memory). Populated by explicit import actions.
IMPORTED_API_DATASETS: List[Dataset] = []


def load_persisted_summaries() -> List[DatasetSummary]:
    """Load DatasetSummary records generated by the preprocessing script.

    The loader prefers the combined `summaries.json` file and falls back to
    an empty list if no summaries have been generated yet.
    """
    if not SUMMARY_FILE.exists():
        return []

    try:
        with SUMMARY_FILE.open("r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except Exception as exc:
        logger.warning("Failed to load persisted summaries: %s", exc)
        return []

    summaries: List[DatasetSummary] = []
    for item in payload if isinstance(payload, list) else []:
        if not isinstance(item, dict):
            continue
        try:
            summaries.append(DatasetSummary(**item))
        except TypeError as exc:
            logger.warning("Skipping invalid summary record: %s", exc)

    return summaries


def load_summary_dicts() -> List[Dict[str, object]]:
    """Return persisted summaries as dictionaries for API/UI consumers."""
    return [asdict(summary) for summary in load_persisted_summaries()]


def load_theme_dictionary() -> Dict[str, List[str]]:
    """Return the keyword-to-theme glossary used by the MVP."""
    return load_theme_glossary()


def load_catalog_from_apis(skip_sources: Optional[set[str]] = None) -> List[Dataset]:
    """Load datasets from enabled external APIs (Madrid CKAN and/or datos.gob.es)."""
    from .api_adapters import MadridCKANAdapter, DatosGobEsAdapter
    
    api_datasets = []
    skip_sources = skip_sources or set()
    
    if Config.ENABLE_MADRID_CKAN and "madrid_ckan" not in skip_sources:
        try:
            logger.info(f"Fetching from Madrid CKAN API (rows={Config.MADRID_CKAN_ROWS})")
            ckan_datasets = MadridCKANAdapter.fetch_datasets(
                rows=Config.MADRID_CKAN_ROWS,
                query=Config.MADRID_CKAN_QUERY or None,
            )
            api_datasets.extend(ckan_datasets)
            logger.info(f"Fetched {len(ckan_datasets)} datasets from Madrid CKAN")
        except Exception as e:
            logger.error(f"Failed to fetch from Madrid CKAN: {e}")
    
    if Config.ENABLE_DATOS_GOB_ES and "datos_gob_es" not in skip_sources:
        try:
            logger.info(f"Fetching from datos.gob.es API (page={Config.DATOS_GOB_ES_PAGE}, limit={Config.DATOS_GOB_ES_LIMIT})")
            datos_gob_datasets = DatosGobEsAdapter.fetch_datasets(
                page=Config.DATOS_GOB_ES_PAGE,
                limit=Config.DATOS_GOB_ES_LIMIT,
            )
            api_datasets.extend(datos_gob_datasets)
            logger.info(f"Fetched {len(datos_gob_datasets)} datasets from datos.gob.es")
        except Exception as e:
            logger.error(f"Failed to fetch from datos.gob.es: {e}")
    
    return api_datasets


def import_api_source(source: str, **kwargs) -> List[Dataset]:
    """Fetch datasets from a specific API source and persist them in memory.

    Args:
        source: one of 'madrid_ckan' or 'datos_gob_es'
        kwargs: forwarded to underlying adapter (rows, page, limit, query)

    Returns:
        List of newly imported Dataset objects (deduplicated against existing imported list).
    """
    from .api_adapters import MadridCKANAdapter, DatosGobEsAdapter, merge_and_deduplicate

    new_datasets: List[Dataset] = []

    if source == "madrid_ckan":
        rows = int(kwargs.get("rows", Config.MADRID_CKAN_ROWS))
        query = kwargs.get("query", Config.MADRID_CKAN_QUERY or None)
        try:
            fetched = MadridCKANAdapter.fetch_datasets(rows=rows, query=query)
            new_datasets.extend(fetched)
        except Exception as e:
            logger.error(f"Failed to import from Madrid CKAN: {e}")

    elif source == "datos_gob_es":
        max_pages = int(kwargs.get("max_pages", 20))
        try:
            fetched = DatosGobEsAdapter.fetch_all_datasets(max_pages=max_pages)
            new_datasets.extend(fetched)
        except Exception as e:
            logger.error(f"Failed to import from datos.gob.es: {e}")
    else:
        logger.warning(f"Unknown source requested for import: {source}")
        return []

    if not new_datasets:
        return []

    # Merge with existing imported datasets and deduplicate by title
    combined = merge_and_deduplicate([IMPORTED_API_DATASETS, new_datasets])

    # Replace imported list with merged result
    IMPORTED_API_DATASETS.clear()
    IMPORTED_API_DATASETS.extend(combined)

    return new_datasets


def clear_imported_api_source(source: Optional[str] = None) -> List[str]:
    """Clear in-memory imported datasets for one source or all sources.

    This intentionally does not delete import session files from disk; it only
    removes datasets from the active runtime catalog and updates the mapping.
    """
    from .storage import clear_import_mapping

    if source:
        removed_ids = [dataset.dataset_id for dataset in IMPORTED_API_DATASETS if dataset.source == source]
        IMPORTED_API_DATASETS[:] = [dataset for dataset in IMPORTED_API_DATASETS if dataset.source != source]
        clear_import_mapping(source)
        return removed_ids

    removed_ids = [dataset.dataset_id for dataset in IMPORTED_API_DATASETS]
    IMPORTED_API_DATASETS.clear()
    clear_import_mapping(None)
    return removed_ids


def get_full_catalog(include_apis: bool = True) -> List[Dataset]:
    """Get the combined active catalog.
    
    Args:
        include_apis: If True and API ingestion is enabled, merge API datasets.
    
    Returns:
        Sorted list of merged and deduplicated Dataset objects.
    """
    from .api_adapters import merge_and_deduplicate

    catalogs_to_merge: List[List[Dataset]] = []
    cached_sources: set[str] = set()

    if include_apis:
        cached_datasets, cached_sources = _load_cache_by_source()
        if cached_datasets:
            catalogs_to_merge.append(cached_datasets)
            logger.info(
                "Including %s full-catalog cached datasets from %s",
                len(cached_datasets),
                ", ".join(sorted(cached_sources)),
            )
    
    # Optionally load from APIs configured via flags
    if include_apis and Config.is_api_enabled():
        api_datasets = load_catalog_from_apis(skip_sources=cached_sources)
        if api_datasets:
            catalogs_to_merge.append(api_datasets)
            logger.info(f"Merging {len(api_datasets)} API datasets with active catalog")

    # Also include any explicitly imported API datasets (persisted in memory)
    if include_apis and IMPORTED_API_DATASETS:
        catalogs_to_merge.append(IMPORTED_API_DATASETS)
        logger.info(f"Including {len(IMPORTED_API_DATASETS)} persistently imported API datasets")
    
    if not catalogs_to_merge:
        logger.info("Final catalog size: 0 datasets (no API/imported datasets)")
        return []

    merged = merge_and_deduplicate(catalogs_to_merge)
    imported_count = len(IMPORTED_API_DATASETS) if include_apis else 0
    logger.info(
        "Final catalog size: %s datasets (imported: %s)",
        len(merged),
        imported_count,
    )
    
    return merged


def get_dataset_by_id(dataset_id: str, include_apis: bool = True) -> Optional[Dataset]:
    """Return one dataset from active imports/cache/API catalog by id."""
    normalized_id = (dataset_id or "").strip()
    if not normalized_id:
        return None

    for dataset in IMPORTED_API_DATASETS:
        if dataset.dataset_id == normalized_id:
            return dataset

    cached, _ = _load_cache_by_source()
    for dataset in cached:
        if dataset.dataset_id == normalized_id:
            return dataset

    for dataset in get_full_catalog(include_apis=include_apis):
        if dataset.dataset_id == normalized_id:
            return dataset

    return None
