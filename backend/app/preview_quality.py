"""Preview-row profiling helpers for fit-review mini EDA."""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Set

MISSING_LITERALS = frozenset(
    {
        "",
        "na",
        "n/a",
        "null",
        "none",
        "-",
        "nan",
        "nat",
        "#n/a",
        "missing",
        "unknown",
    }
)

PLACEHOLDER_LITERALS = frozenset(
    {
        "tbd",
        "todo",
        "pending",
        "not available",
        "not applicable",
        "n/d",
        "nd",
        "xxx",
        "999",
        "0",
    }
)

MAX_COLUMN_PROFILES = 20


def is_missing_value(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        normalized = value.strip().lower()
        if not normalized:
            return True
        return normalized in MISSING_LITERALS
    return False


def is_placeholder_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        normalized = value.strip().lower()
        return normalized in PLACEHOLDER_LITERALS
    return False


def _column_names(rows: Sequence[Mapping[str, Any]], columns: Optional[Sequence[str]]) -> List[str]:
    if columns:
        return [str(name) for name in columns if name]
    names: List[str] = []
    seen: Set[str] = set()
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        for key in row.keys():
            key_text = str(key)
            if key_text not in seen:
                seen.add(key_text)
                names.append(key_text)
    return names


def _infer_value_type(values: Sequence[Any]) -> str:
    non_missing = [value for value in values if not is_missing_value(value)]
    if not non_missing:
        return "unknown"
    if all(isinstance(value, bool) for value in non_missing):
        return "boolean"
    if all(isinstance(value, int) and not isinstance(value, bool) for value in non_missing):
        return "numeric"
    if all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in non_missing):
        return "numeric"
    text_values = [str(value).strip() for value in non_missing if str(value).strip()]
    if text_values and all(re.match(r"^\d{4}(-\d{2}-\d{2})?", value) for value in text_values):
        return "date_like"
    lowered = {str(value).strip().lower() for value in text_values}
    if lowered <= {"true", "false", "yes", "no", "1", "0"}:
        return "boolean"
    return "text"


def build_column_profiles(
    rows: Sequence[Mapping[str, Any]],
    *,
    columns: Optional[Sequence[str]] = None,
    max_columns: int = MAX_COLUMN_PROFILES,
) -> List[Dict[str, Any]]:
    """Per-column stats for preview rows."""
    normalized_rows = [row for row in rows if isinstance(row, Mapping)]
    column_names = _column_names(normalized_rows, columns)[:max_columns]
    row_count = len(normalized_rows)
    profiles: List[Dict[str, Any]] = []

    for column in column_names:
        values = [row.get(column) for row in normalized_rows]
        missing_count = sum(1 for value in values if is_missing_value(value))
        missing_pct = round((missing_count / row_count) * 100, 1) if row_count else 0.0
        placeholder_count = sum(1 for value in values if is_placeholder_value(value))
        non_missing = [value for value in values if not is_missing_value(value)]
        distinct_count = len({str(value) for value in non_missing})
        sample_values = []
        seen_samples: Set[str] = set()
        for value in non_missing:
            text = str(value).strip()
            if not text or text in seen_samples:
                continue
            seen_samples.add(text)
            sample_values.append(text)
            if len(sample_values) >= 3:
                break

        flags: List[str] = []
        if row_count and missing_pct >= 50:
            flags.append("mostly_missing")
        if placeholder_count:
            flags.append("suspicious_placeholder")
        if non_missing and distinct_count == 1:
            flags.append("uniform")

        profiles.append(
            {
                "name": column,
                "inferred_type": _infer_value_type(values),
                "missing_count": missing_count,
                "missing_pct": missing_pct,
                "placeholder_count": placeholder_count,
                "distinct_count": distinct_count,
                "sample_values": sample_values,
                "flags": flags,
            }
        )

    return profiles


def analyze_preview_missingness(
    rows: Sequence[Mapping[str, Any]],
    *,
    columns: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    """Summarize missing, placeholder, and uniform values across preview rows."""
    normalized_rows = [row for row in rows if isinstance(row, Mapping)]
    column_names = _column_names(normalized_rows, columns)
    row_count = len(normalized_rows)

    columns_affected: List[str] = []
    columns_with_placeholders: List[str] = []
    uniform_columns: List[str] = []
    mostly_missing_columns: List[str] = []
    rows_with_missing = 0
    column_missingness: Dict[str, Dict[str, Any]] = {}

    for column in column_names:
        values = [row.get(column) for row in normalized_rows]
        missing_count = sum(1 for value in values if is_missing_value(value))
        missing_pct = round((missing_count / row_count) * 100, 1) if row_count else 0.0
        column_missingness[column] = {
            "missing_count": missing_count,
            "missing_pct": missing_pct,
        }
        if missing_count:
            columns_affected.append(column)
        if missing_pct >= 50 and row_count:
            mostly_missing_columns.append(column)
        if any(is_placeholder_value(value) for value in values):
            columns_with_placeholders.append(column)

        non_missing = [value for value in values if not is_missing_value(value)]
        if non_missing and len({str(value) for value in non_missing}) == 1:
            uniform_columns.append(column)

    for row in normalized_rows:
        if any(is_missing_value(row.get(column)) for column in column_names):
            rows_with_missing += 1

    profile_notes: List[str] = []
    if row_count == 0:
        profile_notes.append("No preview rows were available for profiling.")
    elif rows_with_missing:
        profile_notes.append(
            f"{rows_with_missing} of {row_count} preview row(s) contain missing or empty values."
        )
    if columns_affected and row_count:
        top_affected = sorted(
            columns_affected,
            key=lambda name: column_missingness[name]["missing_count"],
            reverse=True,
        )[:4]
        detail = ", ".join(
            f"`{name}` ({column_missingness[name]['missing_count']})" for name in top_affected
        )
        profile_notes.append(f"Most affected columns: {detail}.")
    if columns_with_placeholders:
        profile_notes.append(
            "Placeholder-like values detected in: "
            + ", ".join(columns_with_placeholders[:4])
            + ("." if len(columns_with_placeholders) <= 4 else ", and others.")
        )
    if uniform_columns:
        profile_notes.append(
            "Uniform value across the sample in: "
            + ", ".join(uniform_columns[:4])
            + ("." if len(uniform_columns) <= 4 else ", and others.")
        )

    return {
        "row_count": row_count,
        "rows_with_missing": rows_with_missing,
        "columns_affected": columns_affected,
        "columns_with_placeholders": columns_with_placeholders,
        "mostly_missing_columns": mostly_missing_columns,
        "uniform_columns": uniform_columns,
        "column_missingness": column_missingness,
        "profile_notes": profile_notes,
    }


def build_profile_notes_from_columns(column_profiles: Sequence[Mapping[str, Any]]) -> List[str]:
    """Human-readable bullets from column profile flags."""
    notes: List[str] = []
    for profile in column_profiles:
        flags = profile.get("flags") or []
        name = str(profile.get("name") or "")
        if not name or not flags:
            continue
        if "mostly_missing" in flags:
            notes.append(f"Column `{name}` is mostly missing in the preview sample.")
        elif "uniform" in flags:
            notes.append(f"Column `{name}` has a uniform value across the preview sample.")
        elif "suspicious_placeholder" in flags:
            notes.append(f"Column `{name}` contains placeholder-like values.")
    return notes[:3]


def build_eda_profile(
    preview: Mapping[str, Any],
    *,
    preview_rows_requested: int,
) -> Dict[str, Any]:
    rows = [row for row in preview.get("rows", []) if isinstance(row, Mapping)]
    columns = preview.get("columns") or []
    column_names = [
        str(column.get("name"))
        for column in columns
        if isinstance(column, Mapping) and column.get("name")
    ]
    stats = analyze_preview_missingness(rows, columns=column_names or None)
    column_profiles = build_column_profiles(rows, columns=column_names or None)
    metadata_only = not rows and bool(preview.get("message"))
    preview_source = str(preview.get("preview_source") or "none")
    profile_notes = list(stats.get("profile_notes", []))
    profile_notes.extend(build_profile_notes_from_columns(column_profiles))
    # Deduplicate while preserving order
    seen: Set[str] = set()
    unique_notes: List[str] = []
    for note in profile_notes:
        if note not in seen:
            seen.add(note)
            unique_notes.append(note)

    return {
        "rows_analyzed": len(rows),
        "columns_analyzed": len(column_profiles) if column_profiles else len(column_names),
        "preview_rows_requested": preview_rows_requested,
        "metadata_only": metadata_only,
        "preview_source": preview_source,
        "preview_stats": stats,
        "column_profiles": column_profiles,
        "profile_notes": unique_notes,
    }
