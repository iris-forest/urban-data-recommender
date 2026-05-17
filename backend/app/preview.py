"""Lazy dataset preview helpers.

The import path stores only metadata and resource hints. This module fetches a
small row sample on demand for the detail panel, keeping catalog imports fast.
"""
from __future__ import annotations

import csv
from io import StringIO
import json
import logging
import re
import time
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlparse

try:
    import requests
except ImportError:  # pragma: no cover - covered by graceful fallback behavior
    requests = None

from .models import Dataset
from .preview_cache import get_cached_preview, preview_cache_key, set_cached_preview

logger = logging.getLogger(__name__)

NO_ROW_PREVIEW_MESSAGE = "No row preview available from this API record. Open source record to inspect files."
MAX_PREVIEW_ROWS = 10
MAX_PREVIEW_BYTES = 1_000_000
SUPPORTED_TABULAR_FORMATS = {"CSV", "TSV", "TXT"}
SUPPORTED_JSON_FORMATS = {"JSON", "GEOJSON"}


def build_dataset_preview(
    dataset: Dataset,
    max_rows: int = 5,
    *,
    allow_fetch: bool = True,
    use_cache: bool = True,
) -> Dict[str, Any]:
    """Build schema and row preview payload for one dataset."""
    row_limit = max(1, min(max_rows, MAX_PREVIEW_ROWS))
    cache_key = preview_cache_key(dataset.dataset_id, row_limit)
    if use_cache:
        cached = get_cached_preview(cache_key)
        if cached is not None:
            return dict(cached)

    started = time.monotonic()
    schema_fields = _normalize_schema_fields(getattr(dataset, "schema_fields", []))
    selected_resource = _select_preview_resource(getattr(dataset, "preview_resources", []))
    source_url = (selected_resource or {}).get("url") or dataset.api_url
    catalog_rows = _normalize_rows(getattr(dataset, "sample_preview", []))[:row_limit]
    rows = list(catalog_rows)
    fetch_error = ""
    preview_source = "catalog_sample" if rows else "none"

    if allow_fetch and not rows and selected_resource:
        try:
            fetched = _fetch_resource_rows(selected_resource, row_limit)
            if fetched:
                rows = fetched
                preview_source = "fetched_resource"
        except Exception as exc:  # pragma: no cover - defensive around flaky external APIs
            fetch_error = str(exc)
            logger.info(
                "Preview fetch failed for %s from %s: %s",
                dataset.dataset_id,
                selected_resource.get("url", ""),
                exc,
            )

    inferred_fields = _infer_schema_from_rows(rows)
    columns = _merge_schema_fields(schema_fields, inferred_fields)
    message = None if rows else NO_ROW_PREVIEW_MESSAGE

    if fetch_error and not rows:
        logger.debug("Preview fallback for %s after fetch error: %s", dataset.dataset_id, fetch_error)

    elapsed_ms = int((time.monotonic() - started) * 1000)
    if elapsed_ms > 500:
        logger.info(
            "Preview built for %s in %sms (source=%s, rows=%s)",
            dataset.dataset_id,
            elapsed_ms,
            preview_source,
            len(rows),
        )

    payload = {
        "dataset_id": dataset.dataset_id,
        "columns": columns,
        "rows": rows[:row_limit],
        "source_url": source_url or "",
        "resource_name": (selected_resource or {}).get("name", ""),
        "resource_format": (selected_resource or {}).get("format", ""),
        "message": message,
        "preview_source": preview_source,
    }
    if use_cache:
        set_cached_preview(cache_key, payload)
    return payload


def _select_preview_resource(resources: Iterable[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    candidates = [resource for resource in resources if isinstance(resource, dict) and resource.get("url")]
    if not candidates:
        return None

    def priority(resource: Dict[str, Any]) -> Tuple[int, int]:
        fmt = _format_label(resource)
        if fmt in SUPPORTED_TABULAR_FORMATS:
            return (0, 0 if fmt == "CSV" else 1)
        if fmt in SUPPORTED_JSON_FORMATS:
            return (1, 0 if fmt == "GEOJSON" else 1)
        return (2, 0)

    return sorted(candidates, key=priority)[0]


def _fetch_resource_rows(resource: Dict[str, Any], max_rows: int) -> List[Dict[str, Any]]:
    url = str(resource.get("url", "")).strip()
    if not _is_http_url(url) or requests is None:
        return []

    content, content_type = _download_preview_bytes(url)
    fmt = _format_label(resource, content_type)
    if fmt in SUPPORTED_TABULAR_FORMATS:
        delimiter = "\t" if fmt == "TSV" else None
        return _parse_csv_rows(content, max_rows, delimiter=delimiter)
    if fmt in SUPPORTED_JSON_FORMATS:
        return _parse_json_rows(content, max_rows)
    return []


def _download_preview_bytes(url: str) -> Tuple[bytes, str]:
    assert requests is not None
    headers = {"Range": f"bytes=0-{MAX_PREVIEW_BYTES - 1}"}
    response = requests.get(url, headers=headers, timeout=10, stream=True)
    try:
        response.raise_for_status()
        chunks: List[bytes] = []
        total = 0
        for chunk in response.iter_content(chunk_size=65536):
            if not chunk:
                continue
            remaining = MAX_PREVIEW_BYTES - total
            if remaining <= 0:
                break
            chunks.append(chunk[:remaining])
            total += len(chunk[:remaining])
        return b"".join(chunks), response.headers.get("content-type", "")
    finally:
        response.close()


def _parse_csv_rows(content: bytes, max_rows: int, delimiter: Optional[str] = None) -> List[Dict[str, Any]]:
    text = _decode_preview_bytes(content)
    if not text.strip():
        return []

    sample = text[:8192]
    if delimiter is None:
        try:
            delimiter = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
        except csv.Error:
            delimiter = ","

    reader = csv.DictReader(StringIO(text), delimiter=delimiter)
    if not reader.fieldnames:
        return []

    rows: List[Dict[str, Any]] = []
    for row in reader:
        cleaned = {
            str(key).strip(): _clean_cell(value)
            for key, value in row.items()
            if key is not None and str(key).strip()
        }
        if any(value not in ("", None) for value in cleaned.values()):
            rows.append(cleaned)
        if len(rows) >= max_rows:
            break
    return rows


def _parse_json_rows(content: bytes, max_rows: int) -> List[Dict[str, Any]]:
    text = _decode_preview_bytes(content)
    if not text.strip():
        return []
    payload = json.loads(text)
    records = _extract_json_records(payload)
    rows: List[Dict[str, Any]] = []
    for record in records:
        if isinstance(record, dict):
            rows.append({str(key): _clean_cell(value) for key, value in record.items()})
        if len(rows) >= max_rows:
            break
    return rows


def _extract_json_records(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]

    if not isinstance(payload, dict):
        return []

    if isinstance(payload.get("features"), list):
        rows = []
        for feature in payload["features"]:
            if not isinstance(feature, dict):
                continue
            properties = feature.get("properties", {})
            row = dict(properties) if isinstance(properties, dict) else {}
            geometry = feature.get("geometry", {})
            if isinstance(geometry, dict) and geometry.get("type"):
                row.setdefault("geometry_type", geometry.get("type"))
            if row:
                rows.append(row)
        return rows

    for path in (
        ("result", "records"),
        ("result", "items"),
        ("records",),
        ("items",),
        ("data",),
    ):
        value: Any = payload
        for key in path:
            value = value.get(key) if isinstance(value, dict) else None
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]

    return [payload]


def _normalize_schema_fields(fields: Iterable[Dict[str, Any]]) -> List[Dict[str, str]]:
    normalized: List[Dict[str, str]] = []
    seen = set()
    for field in fields:
        if not isinstance(field, dict):
            continue
        name = str(field.get("name", "")).strip()
        if not name or name in seen:
            continue
        seen.add(name)
        normalized.append(
            {
                "name": name,
                "inferred_type": str(field.get("inferred_type") or field.get("type") or "unknown"),
                "description": str(field.get("description") or ""),
            }
        )
    return normalized


def _infer_schema_from_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    names: List[str] = []
    seen = set()
    for row in rows:
        for name in row:
            if name not in seen:
                seen.add(name)
                names.append(name)

    fields = []
    for name in names:
        sample_values = [row.get(name) for row in rows if row.get(name) not in ("", None)]
        fields.append(
            {
                "name": name,
                "inferred_type": _infer_type(sample_values),
                "description": "",
            }
        )
    return fields


def _merge_schema_fields(
    metadata_fields: List[Dict[str, str]],
    inferred_fields: List[Dict[str, str]],
) -> List[Dict[str, str]]:
    merged = list(metadata_fields)
    known = {field["name"] for field in merged}
    for field in inferred_fields:
        if field["name"] in known:
            for existing in merged:
                if existing["name"] == field["name"] and existing["inferred_type"] == "unknown":
                    existing["inferred_type"] = field["inferred_type"]
            continue
        merged.append(field)
        known.add(field["name"])
    return merged


def _normalize_rows(rows: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        normalized.append({str(key): _clean_cell(value) for key, value in row.items()})
    return normalized


def _clean_cell(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return json.dumps(value, ensure_ascii=False)


def _infer_type(values: List[Any]) -> str:
    if not values:
        return "unknown"
    if all(isinstance(value, bool) for value in values):
        return "boolean"
    if all(isinstance(value, int) and not isinstance(value, bool) for value in values):
        return "integer"
    if all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in values):
        return "number"

    text_values = [str(value).strip() for value in values if str(value).strip()]
    if text_values and all(re.match(r"^\d{4}-\d{2}-\d{2}", value) for value in text_values):
        return "date"
    return "text"


def _format_label(resource: Dict[str, Any], content_type: str = "") -> str:
    fmt = str(resource.get("format") or "").upper()
    url = str(resource.get("url") or "").lower()
    combined = f"{fmt} {content_type.lower()} {url}"
    if "geojson" in combined:
        return "GEOJSON"
    if "json" in combined:
        return "JSON"
    if "tsv" in combined or "tab-separated" in combined:
        return "TSV"
    if "csv" in combined or "comma-separated" in combined:
        return "CSV"
    if "text/plain" in combined or fmt == "TXT":
        return "TXT"
    return fmt or "UNKNOWN"


def _is_http_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _decode_preview_bytes(content: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="replace")
