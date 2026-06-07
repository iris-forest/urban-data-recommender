"""Build downloadable dataset packages from selected summaries.

The current repository does not ship raw dataset files, so the package builder
creates a metadata bundle with per-dataset README files, a manifest, and the
persisted summary JSON for each selected dataset.
"""
from __future__ import annotations

from dataclasses import asdict
from io import BytesIO
import json
import mimetypes
import re
import zipfile
from typing import Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import urlparse

try:
    import requests
except ImportError:  # pragma: no cover - package download degrades gracefully
    requests = None

from .catalog import load_persisted_summaries
from .dataset_metadata import (
    dataset_resources,
    infer_dataset_data_types,
    infer_dataset_provenance,
)
from .models import DatasetSummary, Dataset

MAX_RESOURCE_BYTES = 25_000_000
MAX_RESOURCES_PER_DATASET = 8
DOWNLOAD_CHUNK_SIZE = 65_536
DOWNLOAD_TIMEOUT = (5, 20)
RESERVED_TEST_HOST_SUFFIXES = (".test", ".invalid", ".localhost")


def _summary_index() -> Dict[str, DatasetSummary]:
    return {summary.id: summary for summary in load_persisted_summaries()}


def _dataset_index() -> Dict[str, Dataset]:
    from .catalog import get_full_catalog

    return {dataset.dataset_id: dataset for dataset in get_full_catalog(include_apis=True)}


def _dataset_to_summary(dataset: Dataset) -> DatasetSummary:
    return DatasetSummary(
        id=dataset.dataset_id,
        title=dataset.title,
        description=dataset.description,
        source=dataset.source,
        source_url=dataset.api_url,
        tags=sorted(set([dataset.primary_category, *dataset.themes]) - {""}),
        columns=dataset.schema_fields,
        sample_rows=dataset.sample_preview,
        risk_notes=[],
        recommended_usage=[
            f"Use for {dataset.spatial_resolution} level analysis in {dataset.spatial_coverage}.",
            f"Review the {dataset.update_frequency} update cadence before combining with other sources.",
        ],
        last_updated=dataset.last_updated,
    )


def _quality_payload(dataset: Dataset) -> Dict[str, float]:
    return {
        "completeness": dataset.quality.completeness,
        "timeliness": dataset.quality.timeliness,
        "consistency": dataset.quality.consistency,
        "documentation": dataset.quality.documentation,
    }


def _manifest_entry(
    summary: DatasetSummary,
    dataset: Optional[Dataset],
    dataset_notes: Optional[Dict[str, str]] = None,
) -> Dict[str, object]:
    entry: Dict[str, object] = asdict(summary)
    note = (dataset_notes or {}).get(summary.id, "").strip()
    if note:
        entry["domain_knowledge_note"] = note
    if dataset is None:
        return entry

    entry.update(
        {
            "dataset_id": dataset.dataset_id,
            "provider": dataset.provider,
            "category": dataset.primary_category or "Uncategorized",
            "categories": dataset.categories,
            "themes": dataset.themes,
            "coverage": dataset.spatial_coverage,
            "spatial_resolution": dataset.spatial_resolution,
            "update_frequency": dataset.update_frequency,
            "quality": _quality_payload(dataset),
            "source": dataset.source,
            "source_url": dataset.api_url or summary.source_url,
            "formats": dataset.formats,
            "resources": dataset_resources(dataset),
            "provenance": infer_dataset_provenance(dataset),
            "data_types": infer_dataset_data_types(dataset),
            "access_type": dataset.access_type,
            "columns": dataset.schema_fields or summary.columns,
            "sample_rows": dataset.sample_preview or summary.sample_rows,
            "usage_notes": [
                f"Recommended for {dataset.spatial_resolution} analysis.",
                f"Source provider: {dataset.provider}.",
            ],
        }
    )
    return entry


def _summary_to_readme(summary: DatasetSummary, dataset: Optional[Dataset] = None) -> str:
    dataset = dataset or _dataset_index().get(summary.id)
    lines: List[str] = [
        f"# {summary.title}",
        "",
        summary.description or "No description available.",
        "",
        "## Quick Facts",
        f"- Dataset ID: {summary.id}",
        f"- Source: {dataset.source if dataset else summary.source}",
        f"- Source URL: {(dataset.api_url if dataset else summary.source_url) or 'n/a'}",
        f"- Provider: {dataset.provider if dataset else 'n/a'}",
        f"- Category: {(dataset.primary_category if dataset else '') or 'Uncategorized'}",
        f"- Coverage: {dataset.spatial_coverage if dataset else 'n/a'}",
        f"- Last updated: {summary.last_updated or 'n/a'}",
        f"- Active: {'yes' if summary.active else 'no'}",
        "",
        "## Tags",
        f"{', '.join(summary.tags) if summary.tags else 'n/a'}",
        "",
        "## Recommended Usage",
    ]

    if summary.recommended_usage:
        for item in summary.recommended_usage:
            lines.append(f"- {item}")
    else:
        lines.append("- No generated recommendations yet.")

    lines.extend([
        "",
        "## Risks and Limitations",
    ])
    if summary.risk_notes:
        for item in summary.risk_notes:
            lines.append(f"- {item}")
    else:
        lines.append("- No generated risk notes yet.")

    lines.extend([
        "",
        "## Columns",
    ])
    if summary.columns:
        for column in summary.columns:
            if not isinstance(column, dict):
                continue
            name = column.get("name", "")
            inferred_type = column.get("inferred_type", "")
            description = column.get("description", "")
            lines.append(f"- {name} ({inferred_type}): {description}")
    else:
        lines.append("- No column summary available.")

    lines.extend([
        "",
        "## Sample Rows",
    ])
    if summary.sample_rows:
        for row in summary.sample_rows[:5]:
            lines.append(f"- {json.dumps(row, ensure_ascii=False)}")
    else:
        lines.append("- No sample rows available.")

    if dataset is not None:
        quality = _quality_payload(dataset)
        lines.extend([
            "",
            "## Original Catalog Entry",
            f"- Provider: {dataset.provider}",
            f"- Category: {dataset.primary_category or 'Uncategorized'}",
            f"- Source: {dataset.source}",
            f"- URL: {dataset.api_url or 'n/a'}",
            f"- Themes: {', '.join(dataset.themes)}",
            f"- Coverage: {dataset.spatial_coverage}",
            f"- Resolution: {dataset.spatial_resolution}",
            f"- Update frequency: {dataset.update_frequency}",
            f"- Access type: {dataset.access_type}",
            f"- Provenance: {infer_dataset_provenance(dataset)}",
            f"- Data type tags: {', '.join(infer_dataset_data_types(dataset))}",
            f"- Quality: completeness={quality['completeness']}, timeliness={quality['timeliness']}, consistency={quality['consistency']}, documentation={quality['documentation']}",
        ])

    return "\n".join(lines).strip() + "\n"


def _resolve_summaries(dataset_ids: Sequence[str]) -> List[Tuple[DatasetSummary, Optional[Dataset]]]:
    summary_map = _summary_index()
    dataset_map = _dataset_index()
    resolved: List[Tuple[DatasetSummary, Optional[Dataset]]] = []

    for dataset_id in dataset_ids:
        summary = summary_map.get(dataset_id)
        dataset = dataset_map.get(dataset_id)
        if not summary and dataset:
            summary = _dataset_to_summary(dataset)
        if not summary:
            continue
        resolved.append((summary, dataset))

    return resolved


def build_dataset_package(
    dataset_ids: Sequence[str],
    package_name: str = "urban-planner-dataset-package",
    dataset_notes: Optional[Dict[str, str]] = None,
) -> bytes:
    """Build an in-memory zip archive for the selected dataset ids."""
    buffer = BytesIO()
    resolved = _resolve_summaries(dataset_ids)
    manifest = build_package_manifest(
        dataset_ids,
        package_name=package_name,
        resolved=resolved,
        dataset_notes=dataset_notes,
    )

    resource_downloads: List[Dict[str, object]] = []

    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        zf.writestr(
            "README.md",
            "\n".join(
                [
                    f"# {package_name}",
                    "",
                    "This package contains selected dataset metadata, generated documentation, and source files when their public URLs could be downloaded.",
                    "If a source file could not be bundled, see dataset_downloads.json and the per-dataset source URLs for manual acquisition details.",
                    "",
                    "Included files:",
                    "- manifest.json",
                    "- dataset_downloads.json",
                    "- summaries/*.json",
                    "- docs/*.md",
                    "- datasets/* when source files are downloadable",
                    "",
                ]
            ).strip() + "\n",
        )

        for summary, dataset in resolved:
            zf.writestr(f"summaries/{summary.id}.json", json.dumps(asdict(summary), ensure_ascii=False, indent=2))
            zf.writestr(f"docs/{summary.id}.md", _summary_to_readme(summary, dataset))
            if dataset is not None:
                _write_dataset_resources(zf, summary, dataset, resource_downloads)

        zf.writestr("dataset_downloads.json", json.dumps(resource_downloads, ensure_ascii=False, indent=2))

    buffer.seek(0)
    return buffer.read()


def _write_dataset_resources(
    zf: zipfile.ZipFile,
    summary: DatasetSummary,
    dataset: Dataset,
    report: List[Dict[str, object]],
) -> None:
    resources = dataset_resources(dataset)
    if not resources:
        report.append(
            {
                "dataset_id": summary.id,
                "resource_name": "",
                "url": dataset.api_url or summary.source_url or "",
                "included": False,
                "path": "",
                "bytes": 0,
                "reason": "No downloadable source resources were listed for this dataset.",
            }
        )
        return

    used_paths = set()
    for index, resource in enumerate(resources[:MAX_RESOURCES_PER_DATASET]):
        path, content, entry = _download_resource_file(summary, resource, index, used_paths)
        if path and content is not None:
            zf.writestr(path, content)
            used_paths.add(path)
        report.append(entry)

    if len(resources) > MAX_RESOURCES_PER_DATASET:
        report.append(
            {
                "dataset_id": summary.id,
                "resource_name": "",
                "url": "",
                "included": False,
                "path": "",
                "bytes": 0,
                "reason": f"Only the first {MAX_RESOURCES_PER_DATASET} listed resources were considered.",
            }
        )


def _download_resource_file(
    summary: DatasetSummary,
    resource: Dict[str, str],
    index: int,
    used_paths: set,
) -> Tuple[Optional[str], Optional[bytes], Dict[str, object]]:
    url = str(resource.get("url") or "").strip()
    resource_name = str(resource.get("name") or "").strip() or f"Source file {index + 1}"
    entry: Dict[str, object] = {
        "dataset_id": summary.id,
        "resource_name": resource_name,
        "format": str(resource.get("format") or "").strip(),
        "url": url,
        "included": False,
        "path": "",
        "bytes": 0,
        "reason": "",
    }

    if _is_source_record_resource(resource):
        entry["reason"] = "Catalog record link is included in the manifest, not bundled as a dataset file."
        return None, None, entry
    if requests is None:
        entry["reason"] = "Python requests is not installed, so source files could not be downloaded."
        return None, None, entry
    if not _is_http_url(url):
        entry["reason"] = "Resource URL is not an HTTP(S) download link."
        return None, None, entry
    if _is_reserved_test_url(url):
        entry["reason"] = "Reserved test URL was not fetched."
        return None, None, entry

    content, content_type, reason = _download_resource_bytes(url)
    if content is None:
        entry["reason"] = reason
        return None, None, entry

    path = _unique_resource_path(summary, resource, index, content_type, used_paths)
    entry.update(
        {
            "included": True,
            "path": path,
            "bytes": len(content),
            "reason": "Downloaded from source URL.",
        }
    )
    return path, content, entry


def _download_resource_bytes(url: str) -> Tuple[Optional[bytes], str, str]:
    assert requests is not None
    try:
        response = requests.get(url, timeout=DOWNLOAD_TIMEOUT, stream=True)
        try:
            response.raise_for_status()
            content_type = response.headers.get("content-type", "")
            content_length = _parse_int(response.headers.get("content-length"))
            if content_length and content_length > MAX_RESOURCE_BYTES:
                return None, content_type, f"Source file is larger than the {MAX_RESOURCE_BYTES // 1_000_000} MB package limit."

            chunks: List[bytes] = []
            total = 0
            for chunk in response.iter_content(chunk_size=DOWNLOAD_CHUNK_SIZE):
                if not chunk:
                    continue
                total += len(chunk)
                if total > MAX_RESOURCE_BYTES:
                    return None, content_type, f"Source file exceeded the {MAX_RESOURCE_BYTES // 1_000_000} MB package limit."
                chunks.append(chunk)
            return b"".join(chunks), content_type, ""
        finally:
            response.close()
    except Exception as exc:  # pragma: no cover - network availability is intentionally best-effort
        return None, "", f"Source file download failed: {exc}"


def _unique_resource_path(
    summary: DatasetSummary,
    resource: Dict[str, str],
    index: int,
    content_type: str,
    used_paths: set,
) -> str:
    dataset_dir = _safe_path_part(summary.id, "dataset")
    filename = _resource_filename(resource, index, content_type)
    base_path = f"datasets/{dataset_dir}/{filename}"
    if base_path not in used_paths:
        return base_path

    stem, dot, extension = filename.rpartition(".")
    stem = stem if dot else filename
    suffix = f".{extension}" if dot else ""
    counter = 2
    while True:
        candidate = f"datasets/{dataset_dir}/{stem}-{counter}{suffix}"
        if candidate not in used_paths:
            return candidate
        counter += 1


def _resource_filename(resource: Dict[str, str], index: int, content_type: str) -> str:
    url_path = urlparse(str(resource.get("url") or "")).path
    url_name = url_path.rsplit("/", 1)[-1] if url_path else ""
    raw_name = str(resource.get("name") or "").strip() or url_name or f"resource-{index + 1}"
    filename = _safe_path_part(raw_name, f"resource-{index + 1}")
    if "." not in filename:
        filename += _resource_extension(resource, url_name, content_type)
    return f"{index + 1:02d}-{filename}"


def _resource_extension(resource: Dict[str, str], url_name: str, content_type: str) -> str:
    fmt = str(resource.get("format") or "").strip().lower().replace(".", "")
    format_extensions = {
        "csv": ".csv",
        "tsv": ".tsv",
        "txt": ".txt",
        "json": ".json",
        "geojson": ".geojson",
        "xls": ".xls",
        "xlsx": ".xlsx",
        "xml": ".xml",
        "zip": ".zip",
        "pdf": ".pdf",
        "kml": ".kml",
        "shp": ".shp",
    }
    if fmt in format_extensions:
        return format_extensions[fmt]

    suffix = _extension_from_url_name(url_name)
    if suffix:
        return suffix

    guessed = mimetypes.guess_extension(content_type.split(";", 1)[0].strip()) if content_type else ""
    return guessed or ".dat"


def _extension_from_url_name(value: str) -> str:
    candidate = value.rsplit("/", 1)[-1].split("?", 1)[0]
    if "." not in candidate:
        return ""
    suffix = "." + candidate.rsplit(".", 1)[-1].lower()
    return suffix if re.match(r"^\.[a-z0-9]{1,8}$", suffix) else ""


def _safe_path_part(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value).strip()).strip(".-_")
    return (cleaned or fallback)[:120]


def _is_source_record_resource(resource: Dict[str, str]) -> bool:
    name = str(resource.get("name") or "").strip().lower()
    fmt = str(resource.get("format") or "").strip()
    return name == "source record" and not fmt


def _is_http_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _is_reserved_test_url(value: str) -> bool:
    hostname = (urlparse(value).hostname or "").lower()
    return hostname == "example.test" or any(hostname.endswith(suffix) for suffix in RESERVED_TEST_HOST_SUFFIXES)


def _parse_int(value: object) -> int:
    try:
        return int(str(value or "").strip())
    except ValueError:
        return 0


def build_package_manifest(
    dataset_ids: Sequence[str],
    package_name: str = "urban-planner-dataset-package",
    resolved: Optional[List[Tuple[DatasetSummary, Optional[Dataset]]]] = None,
    dataset_notes: Optional[Dict[str, str]] = None,
) -> Dict[str, object]:
    """Build the JSON manifest used by both zip and standalone JSON export."""
    resolved = resolved if resolved is not None else _resolve_summaries(dataset_ids)
    return {
        "package_name": package_name,
        "dataset_count": len(resolved),
        "datasets": [
            _manifest_entry(summary, dataset, dataset_notes=dataset_notes)
            for summary, dataset in resolved
        ],
    }


def build_package_for_query(
    dataset_ids: Optional[Sequence[str]] = None,
    query: str = "",
    limit: int = 5,
    dataset_notes: Optional[Dict[str, str]] = None,
) -> Tuple[bytes, List[str]]:
    """Build a package from explicit dataset ids or from a semantic search query."""
    resolved_ids: List[str] = []

    if dataset_ids:
        resolved_ids = [dataset_id for dataset_id in dataset_ids if dataset_id]
    elif query.strip():
        from .embeddings import semantic_search_summaries

        summaries = load_persisted_summaries()
        matches = semantic_search_summaries(query, summaries, limit=limit)
        resolved_ids = [match.summary.id for match in matches]

    archive = build_dataset_package(resolved_ids, dataset_notes=dataset_notes)
    return archive, resolved_ids
