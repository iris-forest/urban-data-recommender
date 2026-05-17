"""Build downloadable dataset packages from selected summaries.

The current repository does not ship raw dataset files, so the package builder
creates a metadata bundle with per-dataset README files, a manifest, and the
persisted summary JSON for each selected dataset.
"""
from __future__ import annotations

from dataclasses import asdict
from io import BytesIO
import json
import zipfile
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from .catalog import load_persisted_summaries
from .dataset_metadata import (
    dataset_resources,
    infer_dataset_data_types,
    infer_dataset_provenance,
)
from .models import DatasetSummary, Dataset


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

    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        zf.writestr(
            "README.md",
            "\n".join(
                [
                    f"# {package_name}",
                    "",
                    "This package contains generated dataset documentation and summary metadata.",
                    "Raw source files are not bundled in this repository snapshot; see the per-dataset source URLs and notes for acquisition details.",
                    "",
                    "Included files:",
                    "- manifest.json",
                    "- summaries/*.json",
                    "- docs/*.md",
                    "",
                ]
            ).strip() + "\n",
        )

        for summary, dataset in resolved:
            zf.writestr(f"summaries/{summary.id}.json", json.dumps(asdict(summary), ensure_ascii=False, indent=2))
            zf.writestr(f"docs/{summary.id}.md", _summary_to_readme(summary, dataset))

    buffer.seek(0)
    return buffer.read()


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
