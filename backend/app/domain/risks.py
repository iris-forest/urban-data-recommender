"""Data quality risk detection."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Sequence, cast


RISK_TIMELESSNESS_THRESHOLD = 0.70
RISK_DOCUMENTATION_THRESHOLD = 0.80
RISK_COMPLETENESS_THRESHOLD = 0.75
RISK_CONSISTENCY_THRESHOLD = 0.75
RISK_STALE_DAYS_THRESHOLD = 120


def identify_quality_risks(scored_recommendations: Sequence[Dict[str, Any]]) -> List[str]:
    """Identify risk notes from quality and freshness signals."""
    risks: List[str] = []
    today = datetime.now().date()

    for recommendation in scored_recommendations:
        quality = cast(Dict[str, float], recommendation.get("quality", {}))
        title = recommendation.get("title", recommendation.get("dataset_id", "dataset"))

        timeliness = quality.get("timeliness", 1.0)
        if timeliness < RISK_TIMELESSNESS_THRESHOLD:
            risks.append(f"{title}: low freshness signal (timeliness={timeliness:.2f}).")

        documentation = quality.get("documentation", 1.0)
        if documentation < RISK_DOCUMENTATION_THRESHOLD:
            risks.append(f"{title}: limited documentation (documentation={documentation:.2f}).")

        completeness = quality.get("completeness", 1.0)
        if completeness < RISK_COMPLETENESS_THRESHOLD:
            risks.append(f"{title}: potential missing data (completeness={completeness:.2f}).")

        consistency = quality.get("consistency", 1.0)
        if consistency < RISK_CONSISTENCY_THRESHOLD:
            risks.append(f"{title}: consistency concerns (consistency={consistency:.2f}).")

        last_updated = recommendation.get("last_updated", "")
        try:
            updated = datetime.strptime(last_updated, "%Y-%m-%d").date()
            days_old = (today - updated).days
            if days_old > RISK_STALE_DAYS_THRESHOLD:
                risks.append(f"{title}: dataset appears stale (last updated {days_old} days ago).")
        except (TypeError, ValueError):
            pass

    return risks

