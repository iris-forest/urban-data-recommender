"""Application service for indicator analysis and dataset recommendations."""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, cast

from ..catalog import get_full_catalog, search_relevant_datasets
from ..domain.gaps import identify_data_gaps
from ..domain.indicator import parse_indicator_text, validate_indicator_text
from ..domain.recommendations import candidate_from_dataset, score_candidate_recommendations
from ..domain.risks import identify_quality_risks
from ..domain.theme_extraction import extract_themes_with_confidence, fallback_theme_confidence
from ..models import GraphState


def _ensure_debug_trace(state: GraphState) -> List[str]:
    if "debug_trace" not in state:
        state["debug_trace"] = []
    return cast(List[str], state["debug_trace"])


def normalize_input_state(state: GraphState) -> GraphState:
    """Normalize and validate input text."""
    text, errors = validate_indicator_text(state.get("indicator_text", ""))
    state["errors"] = errors
    if not errors:
        state["indicator_text"] = text
    return state


def parse_indicator_state(state: GraphState) -> GraphState:
    """Parse indicator text for geography, time, population, and attributes."""
    if state.get("errors"):
        return state

    parsed = parse_indicator_text(state.get("indicator_text", ""))
    state["parsed_indicator"] = {
        "geographic_level": parsed.geographic_level,
        "time_frame": parsed.time_frame,
        "population": parsed.population,
        "attributes": parsed.attributes,
    }
    return state


def extract_themes_state(state: GraphState) -> GraphState:
    """Extract themes from parsed attributes and original indicator text."""
    if state.get("errors"):
        return state

    text = state.get("indicator_text", "")
    parsed_attrs = cast(List[str], state.get("parsed_indicator", {}).get("attributes", []))
    combined = " ".join([text, *parsed_attrs])

    theme_confidence, method = extract_themes_with_confidence(combined, top_n=5)
    state["extracted_themes"] = list(theme_confidence.keys())
    state["theme_confidence"] = theme_confidence
    _ensure_debug_trace(state).append(
        f"extract_themes_node: {len(state['extracted_themes'])} themes, method={method}"
    )
    return state


def fallback_theme_extraction_state(state: GraphState) -> GraphState:
    """Fallback to simple keyword theme extraction when no themes were found."""
    if state.get("errors") or state.get("extracted_themes"):
        return state

    simple_themes, theme_confidence = fallback_theme_confidence(state.get("indicator_text", ""))
    if simple_themes:
        state["extracted_themes"] = simple_themes
        state["theme_confidence"] = theme_confidence
        _ensure_debug_trace(state).append(
            f"fallback_theme_extraction_node: {len(simple_themes)} themes extracted"
        )
    return state


def fetch_catalog_state(state: GraphState) -> GraphState:
    """Prepare the query-time catalog search path."""
    catalog = get_full_catalog(include_apis=False)
    _ensure_debug_trace(state).append(
        f"fetch_catalog_node: ready for query-time search (active catalog baseline={len(catalog)} datasets)"
    )
    return state


def filter_candidates_state(state: GraphState) -> GraphState:
    """Search for relevant datasets using indicator text and extracted themes."""
    extracted = set(state.get("extracted_themes", []))
    indicator_text = state.get("indicator_text", "")

    if not extracted:
        state["candidate_datasets"] = []
        _ensure_debug_trace(state).append("filter_candidates_node: no candidates (no themes)")
        return state

    catalog = search_relevant_datasets(
        indicator_text=indicator_text,
        extracted_themes=sorted(extracted),
        limit=80,
        datos_pages=20,
    )
    candidates: List[Dict[str, Any]] = []
    for search_rank, dataset in enumerate(catalog):
        candidate = candidate_from_dataset(dataset, extracted)
        if candidate is None:
            continue
        candidate["search_rank"] = search_rank
        candidates.append(candidate)

    state["candidate_datasets"] = candidates
    _ensure_debug_trace(state).append(
        f"filter_candidates_node: {len(state['candidate_datasets'])} candidates from query-time search"
    )
    return state


def score_recommendations_state(state: GraphState) -> GraphState:
    """Score and rank candidate datasets."""
    candidates = cast(Sequence[Dict[str, Any]], state.get("candidate_datasets", []))
    if not candidates:
        state["scored_recommendations"] = []
        return state

    scored = score_candidate_recommendations(
        candidates=candidates,
        theme_confidence=state.get("theme_confidence", {}),
        extracted_themes=state.get("extracted_themes", []),
    )
    state["scored_recommendations"] = scored
    _ensure_debug_trace(state).append(
        f"score_recommendations_node: {len(scored)} scored, {sum(1 for item in scored if item['is_essential'])} essential"
    )
    return state


def identify_gaps_state(state: GraphState) -> GraphState:
    """Identify uncovered themes from selected or recommended datasets."""
    gaps = identify_data_gaps(
        extracted_themes=state.get("extracted_themes", []),
        scored_recommendations=state.get("scored_recommendations", []),
        selected_dataset_ids=state.get("selected_dataset_ids", []),
    )
    state["gaps"] = gaps
    _ensure_debug_trace(state).append(f"identify_gaps_node: {len(gaps)} gaps identified")
    return state


def identify_risks_state(state: GraphState) -> GraphState:
    """Identify quality and freshness risks from scored recommendations."""
    risks = identify_quality_risks(state.get("scored_recommendations", []))
    state["risks"] = risks
    _ensure_debug_trace(state).append(f"identify_risks_node: {len(risks)} risks identified")
    return state


def format_output_state(state: GraphState) -> GraphState:
    """Populate compatibility output buckets for agent consumers."""
    if not state.get("selected_dataset_ids"):
        state["selected_dataset_ids"] = [
            recommendation["dataset_id"]
            for recommendation in state.get("scored_recommendations", [])[:5]
        ]

    scored = state.get("scored_recommendations", [])
    state["essential_recommendations"] = [item for item in scored if item.get("is_essential")]
    state["optional_recommendations"] = [item for item in scored if not item.get("is_essential")]
    _ensure_debug_trace(state).append(
        "format_output_node: complete, "
        f"{len(state['essential_recommendations'])} essential, "
        f"{len(state['optional_recommendations'])} optional"
    )
    return state


def analyze_indicator_state(indicator_text: str) -> GraphState:
    """Analyze an indicator and return the compatibility state payload."""
    state: GraphState = {"indicator_text": indicator_text}
    state = normalize_input_state(state)
    if state.get("errors"):
        return state

    state = parse_indicator_state(state)
    state = extract_themes_state(state)
    if not state.get("extracted_themes"):
        state = fallback_theme_extraction_state(state)
    return state


def recommend_datasets_state(
    indicator_text: str,
    extracted_themes: Optional[Sequence[str]] = None,
    selected_dataset_ids: Optional[Sequence[str]] = None,
) -> GraphState:
    """Run the recommendation workflow and return the compatibility state payload."""
    selected_themes = list(dict.fromkeys(extracted_themes or []))
    state: GraphState = {
        "indicator_text": indicator_text,
        "extracted_themes": selected_themes,
        "theme_confidence": {theme_id: 1.0 for theme_id in selected_themes},
        "selected_dataset_ids": list(selected_dataset_ids or []),
    }

    if not extracted_themes:
        state = analyze_indicator_state(indicator_text)
        if state.get("errors"):
            return state
        if selected_dataset_ids:
            state["selected_dataset_ids"] = list(selected_dataset_ids)

    state = filter_candidates_state(state)
    state = score_recommendations_state(state)
    state = identify_gaps_state(state)
    state = identify_risks_state(state)
    return state
