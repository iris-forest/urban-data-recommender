"""API adapters for ingesting datasets from Madrid CKAN and datos.gob.es.

Converts external API responses to Dataset schema and handles normalization.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Iterator, List, Optional
from urllib.parse import urljoin

try:
    import requests
except ImportError:
    requests = None

from .models import Dataset, DatasetQuality
from .themes import extract_themes
from .theme_mappings import (
    map_datos_gob_theme_label,
    map_madrid_org_label,
    infer_categories_from_themes,
    infer_primary_category_from_themes,
)


logger = logging.getLogger(__name__)

# API Base URLs
MADRID_CKAN_API = "https://datos.madrid.es/api/3/action/"
DATOS_GOB_ES_API = "https://datos.gob.es/apidata/catalog/"


@dataclass(frozen=True)
class CatalogPage:
    """One raw API page plus its normalized Dataset records."""

    source: str
    page_index: int
    offset: int
    raw_payload: Dict[str, Any]
    datasets: List[Dataset]
    fetched_count: int
    total_count: Optional[int]
    snapshot_name: str


def normalize_quality_metrics(
    completeness: Optional[float] = None,
    timeliness: Optional[float] = None,
    consistency: Optional[float] = None,
    documentation: Optional[float] = None,
) -> DatasetQuality:
    """Normalize quality metrics to 0-1 scale, with sensible defaults."""
    return DatasetQuality(
        completeness=min(max(completeness or 0.75, 0.0), 1.0),
        timeliness=min(max(timeliness or 0.7, 0.0), 1.0),
        consistency=min(max(consistency or 0.75, 0.0), 1.0),
        documentation=min(max(documentation or 0.6, 0.0), 1.0),
    )


def safe_fetch(url: str, timeout: int = 10, params: Optional[Dict] = None) -> Optional[Dict]:
    """Safely fetch JSON from URL with error handling."""
    if requests is None:
        logger.warning("requests library not available; skipping API fetch")
        return None
    
    try:
        response = requests.get(url, timeout=timeout, params=params)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        logger.error(f"Error fetching {url}: {e}")
        return None


def _int_or_none(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def _first_text(value: Any) -> str:
    """Extract a readable string from API values that may be lists or dicts."""
    if isinstance(value, str):
        return value

    if isinstance(value, dict):
        for key in ("_value", "value", "text", "title", "name"):
            text = value.get(key)
            if isinstance(text, str) and text.strip():
                return text.strip()
        return ""

    if isinstance(value, list):
        english = []
        spanish = []
        fallback = []
        for item in value:
            if isinstance(item, dict):
                text = item.get("_value") or item.get("value") or item.get("text") or item.get("title") or item.get("name")
                if isinstance(text, str) and text.strip():
                    lang = (item.get("_lang") or item.get("lang") or "").lower()
                    if lang == "en":
                        english.append(text.strip())
                    elif lang == "es":
                        spanish.append(text.strip())
                    else:
                        fallback.append(text.strip())
            elif isinstance(item, str) and item.strip():
                fallback.append(item.strip())
        if english:
            return english[0]
        if spanish:
            return spanish[0]
        if fallback:
            return fallback[0]
        return ""

    if value is None:
        return ""

    return str(value)


def _text_list(value: Any) -> List[str]:
    """Extract a list of normalized strings from nested API values."""
    if isinstance(value, list):
        items: List[str] = []
        for item in value:
            text = _first_text(item)
            if text:
                items.append(text)
        return items

    text = _first_text(value)
    return [text] if text else []


def _normalize_date(value: Any) -> str:
    """Normalize API date strings to ISO YYYY-MM-DD."""
    text = _first_text(value).strip()
    if not text:
        return ""

    iso_match = re.match(r"^(\d{4})-(\d{2})-(\d{2})", text)
    if iso_match:
        return "-".join(iso_match.groups())

    spanish_months = {
        "ene": "01",
        "feb": "02",
        "mar": "03",
        "abr": "04",
        "may": "05",
        "jun": "06",
        "jul": "07",
        "ago": "08",
        "sep": "09",
        "sept": "09",
        "oct": "10",
        "nov": "11",
        "dic": "12",
    }
    localized_match = re.search(
        r"\b(\d{1,2})\s+([A-Za-zÁÉÍÓÚáéíóúñÑ]+)\s+(\d{4})\b",
        text,
    )
    if localized_match:
        day, month_label, year = localized_match.groups()
        month = spanish_months.get(month_label[:4].lower()) or spanish_months.get(month_label[:3].lower())
        if month:
            return f"{year}-{month}-{int(day):02d}"

    for date_format in ("%a, %d %b %Y %H:%M:%S %Z", "%d %b %Y", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(text, date_format).strftime("%Y-%m-%d")
        except ValueError:
            continue

    return text


def _resource_url(value: Dict[str, Any]) -> str:
    """Extract a direct source URL from CKAN/DCAT resource metadata."""
    for key in ("url", "downloadURL", "download_url", "accessURL", "access_url", "href"):
        url = _first_text(value.get(key))
        if url:
            return url
    return ""


def _resource_format(value: Dict[str, Any]) -> str:
    for key in ("format", "mediaType", "media_type", "mimetype", "mimetype_inner"):
        fmt = _first_text(value.get(key)).upper()
        if fmt:
            return fmt
    url = _resource_url(value).lower()
    for suffix, label in (
        (".geojson", "GEOJSON"),
        (".json", "JSON"),
        (".csv", "CSV"),
        (".tsv", "TSV"),
        (".xlsx", "XLSX"),
        (".xls", "XLS"),
    ):
        if suffix in url:
            return label
    return ""


def _schema_fields_from_value(value: Any) -> List[Dict[str, str]]:
    """Extract column metadata from schema-like API fragments when present."""
    if isinstance(value, dict):
        for key in ("fields", "columns", "schema_fields"):
            fields = _schema_fields_from_value(value.get(key))
            if fields:
                return fields
        name = _first_text(value.get("name") or value.get("id") or value.get("title"))
        if not name:
            return []
        return [
            {
                "name": name,
                "inferred_type": _first_text(value.get("type") or value.get("datatype")) or "unknown",
                "description": _first_text(value.get("description") or value.get("label")),
            }
        ]

    if isinstance(value, list):
        fields: List[Dict[str, str]] = []
        seen = set()
        for item in value:
            for field in _schema_fields_from_value(item):
                name = field.get("name", "").strip()
                if not name or name in seen:
                    continue
                seen.add(name)
                fields.append(field)
        return fields

    return []


def _resource_schema_fields(resource: Dict[str, Any]) -> List[Dict[str, str]]:
    for key in ("schema", "fields", "columns", "tableSchema"):
        fields = _schema_fields_from_value(resource.get(key))
        if fields:
            return fields
    return []


def _preview_resource_metadata(resource: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    url = _resource_url(resource)
    if not url:
        return None

    resource_id = _first_text(resource.get("id") or resource.get("identifier") or resource.get("_about"))
    return {
        "id": resource_id,
        "name": _first_text(resource.get("name") or resource.get("title")) or resource_id or "Source resource",
        "description": _first_text(resource.get("description")),
        "format": _resource_format(resource) or "UNKNOWN",
        "url": url,
        "schema_fields": _resource_schema_fields(resource),
    }


def _merge_schema_fields(resources: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    fields: List[Dict[str, str]] = []
    seen = set()
    for resource in resources:
        for field in resource.get("schema_fields", []):
            if not isinstance(field, dict):
                continue
            name = str(field.get("name", "")).strip()
            if not name or name in seen:
                continue
            seen.add(name)
            fields.append(
                {
                    "name": name,
                    "inferred_type": str(field.get("inferred_type") or field.get("type") or "unknown"),
                    "description": str(field.get("description") or ""),
                }
            )
    return fields


class MadridCKANAdapter:
    """Adapter for Madrid Open Data (CKAN) API."""
    
    BASE_URL = MADRID_CKAN_API
    
    @classmethod
    def fetch_datasets_page(
        cls,
        rows: int = 50,
        query: Optional[str] = None,
        start: int = 0,
    ) -> CatalogPage:
        """Fetch one CKAN package_search page and normalize its results."""
        params = {"rows": rows, "start": max(start, 0)}
        if query:
            params["q"] = query

        url = urljoin(cls.BASE_URL, "package_search")
        data = safe_fetch(url, params=params) or {}
        return cls.normalize_catalog_payload(
            data,
            rows=rows,
            start=start,
            snapshot_name=f"offset-{max(start, 0):06d}",
        )

    @classmethod
    def normalize_catalog_payload(
        cls,
        data: Dict[str, Any],
        rows: int = 100,
        start: int = 0,
        snapshot_name: Optional[str] = None,
    ) -> CatalogPage:
        """Normalize one raw CKAN package_search payload."""
        result = data.get("result", {}) if data.get("success") else {}
        packages = result.get("results", []) if isinstance(result, dict) else []
        if not isinstance(packages, list):
            packages = []

        datasets = []
        for pkg in packages:
            try:
                dataset = cls._normalize_package(pkg)
                if dataset:
                    datasets.append(dataset)
            except Exception as e:
                logger.warning(f"Error normalizing Madrid CKAN package {pkg.get('id')}: {e}")
                continue

        total_count = result.get("count") if isinstance(result, dict) else None
        page_index = max(start, 0) // max(rows, 1)
        return CatalogPage(
            source="madrid_ckan",
            page_index=page_index,
            offset=max(start, 0),
            raw_payload=data,
            datasets=datasets,
            fetched_count=len(packages),
            total_count=_int_or_none(total_count),
            snapshot_name=snapshot_name or f"offset-{max(start, 0):06d}",
        )

    @classmethod
    def fetch_datasets(cls, rows: int = 50, query: Optional[str] = None) -> List[Dataset]:
        """Fetch datasets from Madrid CKAN API and convert to Dataset schema."""
        page = cls.fetch_datasets_page(rows=rows, query=query, start=0)
        if not page.raw_payload or not page.raw_payload.get("success"):
            logger.warning("Madrid CKAN API returned no data or error")
            return []
        return page.datasets

    @classmethod
    def iter_all_dataset_pages(
        cls,
        rows: int = 100,
        query: Optional[str] = None,
    ) -> Iterator[CatalogPage]:
        """Yield all Madrid CKAN metadata pages."""
        start = 0
        fetched_total = 0

        while True:
            page = cls.fetch_datasets_page(rows=rows, query=query, start=start)
            if not page.raw_payload or not page.raw_payload.get("success"):
                break
            if page.fetched_count == 0:
                break

            yield page

            fetched_total += page.fetched_count
            if page.total_count is not None and fetched_total >= page.total_count:
                break
            if page.fetched_count < rows:
                break

            start += rows
    
    @classmethod
    def _normalize_package(cls, pkg: Dict) -> Optional[Dataset]:
        """Normalize a CKAN package to Dataset schema."""
        dataset_id = pkg.get("id")
        if not dataset_id:
            return None
        
        title = pkg.get("title", pkg.get("name", "Untitled"))
        description = pkg.get("notes", "")
        
        # Attempt to map organization/title to internal themes first
        org_title = pkg.get("organization", {}).get("title", "")
        mapped = map_madrid_org_label(org_title)
        mapped_themes = [t for t, _ in mapped]

        # Extract themes from title and description, prioritizing mapped themes
        combined_text = f"{title} {description}".lower()
        themes = extract_themes(combined_text, external_themes=mapped_themes)
        
        resources = pkg.get("resources", [])
        if isinstance(resources, dict):
            resources = [resources]
        if not isinstance(resources, list):
            resources = []

        preview_resources = [
            metadata
            for resource in resources
            if isinstance(resource, dict)
            for metadata in [_preview_resource_metadata(resource)]
            if metadata
        ]
        schema_fields = _merge_schema_fields(preview_resources)

        # Extract formats from resources
        formats = set()
        for res in resources:
            if not isinstance(res, dict):
                continue
            fmt = _resource_format(res)
            if fmt:
                formats.add(fmt)
        
        # Determine update frequency
        frequency_map = {
            "immediately": "real-time",
            "daily": "daily",
            "weekly": "weekly",
            "monthly": "monthly",
            "quarterly": "quarterly",
            "annually": "annual",
        }
        raw_freq = pkg.get("accrual_periodicity", "unknown").lower()
        update_frequency = next(
            (v for k, v in frequency_map.items() if k in raw_freq),
            "unknown",
        )
        
        # Get last update date
        last_updated = _normalize_date(pkg.get("metadata_modified", ""))
        
        # Get publication date
        publication_date = _normalize_date(pkg.get("metadata_created", ""))
        
        final_themes = themes or ["other"]
        categories = infer_categories_from_themes(final_themes)
        primary_category = infer_primary_category_from_themes(final_themes)

        return Dataset(
            dataset_id=f"madrid_ckan_{dataset_id}",
            title=title,
            provider=pkg.get("organization", {}).get("title", "Madrid Open Data"),
            themes=final_themes,
            spatial_coverage="Madrid city" if "madrid" in title.lower() else "Unknown",
            spatial_resolution="unknown",
            update_frequency=update_frequency,
            last_updated=last_updated,
            publication_date=publication_date,
            access_type="open",
            formats=sorted(list(formats)) or ["CSV"],
            quality=normalize_quality_metrics(
                completeness=0.8 if pkg.get("resources") else 0.5,
                timeliness=0.75,
                consistency=0.7,
                documentation=0.65,
            ),
            description=description,
            sample_preview=[],
            schema_fields=schema_fields,
            preview_resources=preview_resources,
            primary_category=primary_category,
            categories=categories,
            category_confidence=0.8 if mapped_themes else 0.5,
            category_method="agent",
            source="madrid_ckan",
            api_url=pkg.get("url", ""),
        )


class DatosGobEsAdapter:
    """Adapter for datos.gob.es API."""
    
    BASE_URL = DATOS_GOB_ES_API
    
    @classmethod
    def fetch_catalog_page(cls, page_index: int = 0) -> CatalogPage:
        """Fetch one page of datos.gob.es metadata and normalize its items."""
        url = urljoin(cls.BASE_URL, "dataset.json")
        params = {"_page": max(page_index, 0)}

        data = safe_fetch(url, params=params) or {}
        return cls.normalize_catalog_payload(
            data,
            page_index=page_index,
            snapshot_name=f"page-{max(page_index, 0):06d}",
        )

    @classmethod
    def normalize_catalog_payload(
        cls,
        data: Dict[str, Any],
        page_index: int = 0,
        snapshot_name: Optional[str] = None,
    ) -> CatalogPage:
        """Normalize one raw datos.gob.es dataset page payload."""
        result = data.get("result", {}) if isinstance(data, dict) else {}
        items = result.get("items", []) if isinstance(result, dict) else []
        if not isinstance(items, list):
            items = []

        datasets = []
        for dataset_data in items:
            try:
                dataset = cls._normalize_dataset(dataset_data)
                if dataset:
                    datasets.append(dataset)
            except Exception as e:
                logger.warning(f"Error normalizing datos.gob.es dataset: {e}")
                continue

        total_count = None
        if isinstance(result, dict):
            for key in ("totalItems", "total_items", "total", "count"):
                total_count = _int_or_none(result.get(key))
                if total_count is not None:
                    break

        return CatalogPage(
            source="datos_gob_es",
            page_index=max(page_index, 0),
            offset=max(page_index, 0),
            raw_payload=data,
            datasets=datasets,
            fetched_count=len(items),
            total_count=total_count,
            snapshot_name=snapshot_name or f"page-{max(page_index, 0):06d}",
        )

    @classmethod
    def fetch_datasets_page(cls, page_index: int = 0) -> List[Dataset]:
        """Fetch one page of datasets from datos.gob.es API and convert to Dataset schema."""
        page = cls.fetch_catalog_page(page_index=page_index)

        if not page.raw_payload:
            logger.warning("datos.gob.es API returned no data")
            return []

        return page.datasets

    @classmethod
    def fetch_datasets(cls, page: int = 1, limit: int = 50) -> List[Dataset]:
        """Fetch a single page of datasets from datos.gob.es.

        The API exposes a linked-data pagination scheme and currently returns
        10 items per page. `limit` is retained for API compatibility.
        """
        page_index = max(page - 1, 0)
        return cls.fetch_datasets_page(page_index=page_index)

    @classmethod
    def fetch_all_datasets(cls, max_pages: int = 20) -> List[Dataset]:
        """Fetch multiple pages from datos.gob.es until the page budget is exhausted."""
        datasets: List[Dataset] = []

        for page in cls.iter_all_dataset_pages(max_pages=max_pages):
            if not page.datasets:
                break
            datasets.extend(page.datasets)

        return datasets

    @classmethod
    def iter_all_dataset_pages(cls, max_pages: Optional[int] = None) -> Iterator[CatalogPage]:
        """Yield datos.gob.es pages until the catalog is exhausted."""
        page_index = 0
        fetched_total = 0

        while True:
            if max_pages is not None and page_index >= max_pages:
                break

            page = cls.fetch_catalog_page(page_index=page_index)
            if not page.raw_payload:
                break
            if page.fetched_count == 0:
                break

            yield page

            fetched_total += page.fetched_count
            if page.total_count is not None and fetched_total >= page.total_count:
                break
            if page.fetched_count < 10:
                break

            page_index += 1
    
    @classmethod
    def _normalize_dataset(cls, dataset_data: Dict) -> Optional[Dataset]:
        """Normalize a datos.gob.es dataset to Dataset schema."""
        raw_id = _first_text(dataset_data.get("identifier"))
        if not raw_id:
            raw_id = _first_text(dataset_data.get("_about"))

        # Backward compatibility for older payload variants that exposed _links.self.href
        if not raw_id:
            links = dataset_data.get("_links", {})
            if isinstance(links, dict):
                self_links = links.get("self", [])
                if isinstance(self_links, list) and self_links:
                    raw_id = _first_text(self_links[0].get("href"))

        if not raw_id:
            return None

        dataset_id = raw_id.rstrip("/").split("/")[-1] or "unknown"
        
        title = _first_text(dataset_data.get("title")) or "Untitled"
        description = _first_text(dataset_data.get("description"))
        keywords = _text_list(dataset_data.get("keyword"))
        theme_links = _text_list(dataset_data.get("theme"))
        
        # Map any supplied theme links/labels to internal themes first
        mapped = []
        for tl in theme_links:
            mapped.extend([t for t, _ in map_datos_gob_theme_label(tl)])

        # Extract themes from title and description, prioritizing mapped themes
        combined_text = f"{title} {description} {' '.join(keywords)} {' '.join(theme_links)}".lower()
        themes = extract_themes(combined_text, external_themes=mapped)
        
        # Extract formats
        formats = set()
        distributions = dataset_data.get("distribution", [])
        if isinstance(distributions, dict):
            distributions = [distributions]
        if not isinstance(distributions, list):
            distributions = []

        preview_resources = [
            metadata
            for distribution in distributions
            if isinstance(distribution, dict)
            for metadata in [_preview_resource_metadata(distribution)]
            if metadata
        ]
        schema_fields = _merge_schema_fields(preview_resources)

        for dist in distributions:
            if not isinstance(dist, dict):
                continue
            fmt = _resource_format(dist)
            if fmt:
                formats.add(fmt)
        
        # Get issued/modified dates
        last_updated = _normalize_date(dataset_data.get("modified") or dataset_data.get("issued"))
        publication_date = _normalize_date(dataset_data.get("issued", ""))
        
        final_themes = themes or ["other"]
        categories = infer_categories_from_themes(final_themes)
        primary_category = infer_primary_category_from_themes(final_themes)

        return Dataset(
            dataset_id=f"datos_gob_{dataset_id}",
            title=title,
            provider="datos.gob.es",
            themes=final_themes,
            spatial_coverage="Spain",
            spatial_resolution="unknown",
            update_frequency="unknown",
            last_updated=last_updated,
            publication_date=publication_date,
            access_type="open",
            formats=sorted(list(formats)) or ["CSV"],
            quality=normalize_quality_metrics(
                completeness=0.75,
                timeliness=0.7,
                consistency=0.7,
                documentation=0.6,
            ),
            description=description,
            sample_preview=[],
            schema_fields=schema_fields,
            preview_resources=preview_resources,
            primary_category=primary_category,
            categories=categories,
            category_confidence=0.8 if mapped else 0.5,
            category_method="agent",
            source="datos_gob_es",
            api_url=_first_text(dataset_data.get("_about")) or raw_id,
        )


def merge_and_deduplicate(catalogs: List[List[Dataset]]) -> List[Dataset]:
    """Merge multiple catalog lists and remove duplicates by title similarity and source."""
    merged = {}
    
    for catalog in catalogs:
        for dataset in catalog:
            # Create a canonical key from normalized title
            key = dataset.title.lower().strip()
            
            if key not in merged:
                merged[key] = dataset
            else:
                existing = merged[key]
                existing.quality = DatasetQuality(
                    completeness=max(existing.quality.completeness, dataset.quality.completeness),
                    timeliness=max(existing.quality.timeliness, dataset.quality.timeliness),
                    consistency=max(existing.quality.consistency, dataset.quality.consistency),
                    documentation=max(existing.quality.documentation, dataset.quality.documentation),
                )
                existing.themes = sorted(list(set(existing.themes + dataset.themes)))
                if not existing.api_url and dataset.api_url:
                    existing.api_url = dataset.api_url
                if not existing.primary_category and dataset.primary_category:
                    existing.primary_category = dataset.primary_category
    
    return sorted(list(merged.values()), key=lambda d: d.title)
