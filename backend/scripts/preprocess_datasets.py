"""Preprocess active API-backed catalog entries into DatasetSummary records.

Produces per-dataset JSON summaries and a combined summaries file.
This is a lightweight, dependency-free script intended for local use and
as a starting point for later LLM enrichment and embedding computation.

Usage:
    python preprocess_datasets.py                    # Basic processing
    ENABLE_LLM_INSIGHTS=true python preprocess_datasets.py  # With LLM enrichment
"""
from __future__ import annotations

import json
import os
from dataclasses import asdict
from pathlib import Path
import sys
from typing import Any, Dict, List
from datetime import datetime, timezone

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.catalog import get_full_catalog
from app.models import DatasetSummary
from app.themes import extract_themes
from app.llm_insights import enrich_dataset_summary, is_llm_enabled


OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "summaries")


def ensure_out_dir() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)


def infer_column_type(values: List[Any]) -> str:
    # Very small heuristic inference: integer, float, date, string
    has_float = False
    has_int = False
    for v in values:
        if v is None:
            continue
        s = str(v).strip()
        if not s:
            continue
        # numeric checks
        try:
            int(s)
            has_int = True
            continue
        except Exception:
            pass
        try:
            float(s)
            has_float = True
            continue
        except Exception:
            pass
        # simple date-ish check
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d"):
            try:
                datetime.strptime(s, fmt)
                return "date"
            except Exception:
                continue

    if has_float and not has_int:
        return "float"
    if has_int and not has_float:
        return "integer"
    if has_int and has_float:
        return "float"
    return "string"


def make_column_descriptions(sample_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not sample_rows:
        return []

    # collect values per column
    cols: Dict[str, List[Any]] = {}
    for row in sample_rows:
        for k, v in row.items():
            cols.setdefault(k, []).append(v)

    descriptions: List[Dict[str, Any]] = []
    for col, vals in cols.items():
        inferred = infer_column_type(vals)
        samples = [str(v) for v in vals[:5] if v is not None]
        # simple human-friendly name
        human = col.replace("_", " ").capitalize()
        desc = f"{human}: {inferred}. Example values: {', '.join(samples[:3])}"
        descriptions.append({"name": col, "inferred_type": inferred, "description": desc})

    return descriptions


def generate_summary_from_dataset(dataset) -> DatasetSummary:
    # Use available preview rows as samples; empty if none
    sample_rows = getattr(dataset, "sample_preview", []) or []

    # build a compact text for theme extraction
    text_blob = " ".join(filter(None, [getattr(dataset, "title", ""), getattr(dataset, "description", "")]))
    # include column names in theme extraction for better tags
    if sample_rows:
        col_names = " ".join({k for r in sample_rows for k in r.keys()})
        text_blob = f"{text_blob} {col_names}"

    tags = extract_themes(text_blob, top_n=6)

    columns = make_column_descriptions(sample_rows)

    # risk heuristics
    risks: List[str] = []
    try:
        last_updated = getattr(dataset, "last_updated", "")
        if last_updated:
            # if year present and older than 2 years
            year = int(last_updated.split("-")[0])
            if year < datetime.now(timezone.utc).year - 2:
                risks.append(f"Data may be outdated; last updated {last_updated}.")
    except Exception:
        last_updated = getattr(dataset, "last_updated", "")

    if getattr(dataset, "access_type", "") and getattr(dataset, "access_type", "") != "open":
        risks.append(f"Access restrictions: {dataset.access_type}.")

    if getattr(dataset, "quality", None):
        q = dataset.quality
        if q.documentation < 0.6:
            risks.append("Documentation is limited; exercise caution interpreting fields.")
        if q.completeness < 0.6:
            risks.append("Dataset appears incomplete.")

    recommended: List[str] = []
    # basic recommended usage rules
    if "population" in (getattr(dataset, "themes", []) or []):
        recommended.append("Use for demographic summaries and rate calculations; join with spatial boundaries using district codes.")
    if "transport_networks" in (getattr(dataset, "themes", []) or []):
        recommended.append("Use for network analysis and accessibility; perform reprojection to project CRS before distance calculations.")

    summary = DatasetSummary(
        id=getattr(dataset, "dataset_id", getattr(dataset, "title", "unknown")).strip(),
        title=getattr(dataset, "title", ""),
        description=getattr(dataset, "description", ""),
        source=getattr(dataset, "source", ""),
        source_url=getattr(dataset, "api_url", ""),
        columns=columns,
        sample_rows=sample_rows,
        geo_coverage={
            "name": getattr(dataset, "spatial_coverage", ""),
            "resolution": getattr(dataset, "spatial_resolution", ""),
        },
        time_coverage={
            "frequency": getattr(dataset, "update_frequency", ""),
            "last_updated": getattr(dataset, "last_updated", ""),
        },
        license=getattr(dataset, "access_type", ""),
        tags=tags,
        risk_notes=risks,
        recommended_usage=recommended,
        embedding=None,
        file_link="",
        schema_version="1.0",
        active=getattr(dataset, "source", "") != "deprecated",
        last_updated=getattr(dataset, "last_updated", ""),
        match_reasons=[],
        size_bytes=None,
    )

    return summary


def write_summary(summary: DatasetSummary) -> None:
    payload = asdict(summary)
    # write per-dataset file
    out_path = os.path.join(OUT_DIR, f"{summary.id}.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)


def run() -> None:
    ensure_out_dir()
    catalog = get_full_catalog(include_apis=True)
    summaries: List[Dict[str, Any]] = []
    
    llm_enabled = is_llm_enabled()
    if llm_enabled:
        print("LLM enrichment enabled; generating insights...")
    else:
        print("Using heuristic-based summaries (LLM disabled)")

    for ds in catalog:
        summary = generate_summary_from_dataset(ds)
        
        # Optionally enrich with LLM
        if llm_enabled:
            summary = enrich_dataset_summary(summary)
        
        write_summary(summary)
        summaries.append(asdict(summary))

    # write combined file
    combined = os.path.join(OUT_DIR, "summaries.json")
    with open(combined, "w", encoding="utf-8") as fh:
        json.dump(summaries, fh, ensure_ascii=False, indent=2)

    print(f"Wrote {len(summaries)} summaries to {OUT_DIR}")


if __name__ == "__main__":
    run()
