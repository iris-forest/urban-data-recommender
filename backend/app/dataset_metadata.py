"""Derived dataset metadata used across API and package exports."""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List

from .models import Dataset


KNOWN_GOVERNMENT_SOURCES = {
    "madrid_ckan",
    "datos_gob_es",
}


def dataset_resources(dataset: Dataset) -> List[Dict[str, str]]:
    """Return public, linkable resource metadata from preview resources."""
    resources: List[Dict[str, str]] = []
    seen_urls = set()

    for index, resource in enumerate(getattr(dataset, "preview_resources", []) or []):
        if not isinstance(resource, dict):
            continue
        url = str(resource.get("url") or "").strip()
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        resource_id = str(resource.get("id") or "").strip()
        name = str(resource.get("name") or "").strip() or f"Source file {index + 1}"
        resources.append(
            {
                "id": resource_id,
                "name": name,
                "description": str(resource.get("description") or "").strip(),
                "format": str(resource.get("format") or "").strip().upper(),
                "url": url,
            }
        )

    if not resources and getattr(dataset, "api_url", ""):
        resources.append(
            {
                "id": "",
                "name": "Source record",
                "description": "",
                "format": "",
                "url": dataset.api_url,
            }
        )

    return resources


def infer_dataset_provenance(dataset: Dataset) -> str:
    """Infer a stable provenance label from source and catalog text."""
    source = (getattr(dataset, "source", "") or "").strip().lower()
    if source in KNOWN_GOVERNMENT_SOURCES:
        return "Official Government"

    text = _combined_text(
        source,
        dataset.provider,
        dataset.title,
        dataset.description,
        *(dataset.themes or []),
    )

    if _has_any(text, "crowd", "crowdsourced", "openstreetmap", "osm"):
        return "Community-Generated"
    if _has_any(text, "participatory", "participacion", "participación"):
        return "Participatory Data"
    if _has_any(text, "ngo", "non profit", "non-profit", "foundation", "fundacion", "fundación", "asociacion", "asociación"):
        return "Non-Profit / NGO"
    if _has_any(text, "research", "university", "universidad", "institute", "instituto", "observatory", "observatorio"):
        return "Research Organization"

    return "Catalog Metadata"


def infer_dataset_data_types(dataset: Dataset) -> List[str]:
    """Infer data-nature tags without changing scoring behavior."""
    text = _combined_text(
        dataset.provider,
        dataset.title,
        dataset.description,
        dataset.primary_category,
        *(dataset.themes or []),
        *(dataset.formats or []),
    )
    formats = {str(fmt).strip().upper() for fmt in (dataset.formats or []) if str(fmt).strip()}
    tags: List[str] = []

    has_qualitative = _has_any(
        text,
        "qualitative",
        "interview",
        "interviews",
        "perception",
        "comment",
        "comments",
        "satisfaction",
        "narrative",
        "complaint",
    )
    has_quantitative = bool(
        formats.intersection({"CSV", "TSV", "XLS", "XLSX", "JSON", "GEOJSON", "SHP", "KML"})
        or getattr(dataset, "schema_fields", [])
        or getattr(dataset, "sample_preview", [])
    )

    if _has_any(text, "survey", "surveys", "encuesta", "encuestas"):
        tags.append("Survey Data")
    if _has_any(text, "crowd", "crowdsourced", "openstreetmap", "osm"):
        tags.append("Crowdsourced")
    if _has_any(text, "participatory", "participacion", "participación"):
        tags.append("Participatory Data")

    if has_qualitative and has_quantitative:
        tags.insert(0, "Mixed Methods")
    elif has_qualitative:
        tags.insert(0, "Qualitative")
    else:
        tags.insert(0, "Quantitative")

    return _dedupe(tags)


def infer_record_provenance(record: Dict[str, Any]) -> str:
    """Infer provenance for recommendation dictionaries before Dataset hydration."""
    source = str(record.get("source") or "").strip().lower()
    if source in KNOWN_GOVERNMENT_SOURCES:
        return "Official Government"

    text = _combined_text(
        source,
        record.get("provider"),
        record.get("title"),
        record.get("description"),
        *(record.get("themes") or []),
    )
    if _has_any(text, "crowd", "crowdsourced", "openstreetmap", "osm"):
        return "Community-Generated"
    if _has_any(text, "participatory", "participacion", "participación"):
        return "Participatory Data"
    if _has_any(text, "ngo", "non profit", "non-profit", "foundation", "fundacion", "fundación", "asociacion", "asociación"):
        return "Non-Profit / NGO"
    if _has_any(text, "research", "university", "universidad", "institute", "instituto", "observatory", "observatorio"):
        return "Research Organization"
    return "Catalog Metadata"


def infer_record_data_types(record: Dict[str, Any]) -> List[str]:
    """Infer data-nature tags for recommendation dictionaries."""
    formats = [str(fmt) for fmt in (record.get("formats") or [])]
    text = _combined_text(
        record.get("provider"),
        record.get("title"),
        record.get("description"),
        record.get("primary_category"),
        *(record.get("themes") or []),
        *formats,
    )
    has_qualitative = _has_any(
        text,
        "qualitative",
        "interview",
        "interviews",
        "perception",
        "comment",
        "comments",
        "satisfaction",
        "narrative",
        "complaint",
    )
    has_quantitative = bool(
        {fmt.upper() for fmt in formats}.intersection({"CSV", "TSV", "XLS", "XLSX", "JSON", "GEOJSON", "SHP", "KML"})
        or record.get("schema_fields")
        or record.get("sample_preview")
    )
    tags: List[str] = []
    if _has_any(text, "survey", "surveys", "encuesta", "encuestas"):
        tags.append("Survey Data")
    if _has_any(text, "crowd", "crowdsourced", "openstreetmap", "osm"):
        tags.append("Crowdsourced")
    if _has_any(text, "participatory", "participacion", "participación"):
        tags.append("Participatory Data")
    if has_qualitative and has_quantitative:
        tags.insert(0, "Mixed Methods")
    elif has_qualitative:
        tags.insert(0, "Qualitative")
    else:
        tags.insert(0, "Quantitative")
    return _dedupe(tags)


def _combined_text(*parts: Any) -> str:
    return " ".join(str(part or "") for part in parts).lower()


def _has_any(text: str, *needles: str) -> bool:
    return any(re.search(rf"\b{re.escape(needle)}\b", text) for needle in needles)


def _dedupe(items: Iterable[str]) -> List[str]:
    seen = set()
    deduped: List[str] = []
    for item in items:
        if not item or item in seen:
            continue
        seen.add(item)
        deduped.append(item)
    return deduped
