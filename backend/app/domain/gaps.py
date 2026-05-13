"""Data gap detection."""
from __future__ import annotations

from typing import Any, Dict, List, Sequence


def identify_data_gaps(
    extracted_themes: Sequence[str],
    scored_recommendations: Sequence[Dict[str, Any]],
    selected_dataset_ids: Sequence[str] | None = None,
) -> List[Dict[str, Any]]:
    """Identify uncovered themes from selected or recommended datasets."""
    extracted = set(extracted_themes)
    selected_ids = set(selected_dataset_ids or [])

    if not scored_recommendations:
        return [
            {
                "theme_id": theme_id,
                "description": f"No datasets found for theme: {theme_id}",
                "suggested_workarounds": ["Consider combining data from related sources", "Check API availability"],
            }
            for theme_id in extracted
        ]

    coverage_pool = list(scored_recommendations)
    if selected_ids:
        selected_pool = [rec for rec in scored_recommendations if rec.get("dataset_id") in selected_ids]
        coverage_pool = selected_pool or coverage_pool
    else:
        coverage_pool = coverage_pool[:2]

    covered = set()
    for recommendation in coverage_pool:
        covered.update(recommendation["matching_themes"])

    return [
        {
            "theme_id": theme_id,
            "description": f"No selected dataset covers theme '{theme_id}'.",
            "suggested_workarounds": [
                "Expand selection to include lower-ranked but relevant datasets.",
                "Use proxy indicators from related themes while sourcing better coverage.",
                "Check Madrid and national open-data portals for supplemental tables.",
            ],
        }
        for theme_id in sorted(extracted - covered)
    ]

