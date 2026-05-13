"""LangGraph compatibility wrapper for the recommendation workflow.

The implementation lives in domain modules and application services. This
module keeps the original node function names and `run_recommendation_agent`
entry point available for scripts and tests.
"""
from __future__ import annotations

from typing import Dict

from langgraph.graph import END, StateGraph

from .application.recommend_datasets import (
    extract_themes_state,
    fallback_theme_extraction_state,
    fetch_catalog_state,
    filter_candidates_state,
    format_output_state,
    identify_gaps_state,
    identify_risks_state,
    normalize_input_state,
    parse_indicator_state,
    score_recommendations_state,
)
# Imported here as a compatibility re-export for older smoke tests.
from .domain.theme_extraction import extract_themes_with_confidence
from .models import GraphState


def normalize_input_node(state: GraphState) -> GraphState:
    """Normalize and validate input text."""
    return normalize_input_state(state)


def parse_indicator_node(state: GraphState) -> GraphState:
    """Parse indicator text for geography, time, population, and attributes."""
    return parse_indicator_state(state)


def extract_themes_node(state: GraphState) -> GraphState:
    """Extract themes from parsed attributes and indicator text."""
    return extract_themes_state(state)


def fallback_theme_extraction_node(state: GraphState) -> GraphState:
    """Fallback to simple keyword theme extraction when no themes were found."""
    return fallback_theme_extraction_state(state)


def fetch_catalog_node(state: GraphState) -> GraphState:
    """Prepare the query-time catalog search path."""
    return fetch_catalog_state(state)


def filter_candidates_node(state: GraphState) -> GraphState:
    """Search for relevant datasets using indicator text and extracted themes."""
    return filter_candidates_state(state)


def score_recommendations_node(state: GraphState) -> GraphState:
    """Score and rank candidate datasets with deterministic weighting."""
    return score_recommendations_state(state)


def identify_gaps_node(state: GraphState) -> GraphState:
    """Identify uncovered themes from selected or recommended datasets."""
    return identify_gaps_state(state)


def identify_risks_node(state: GraphState) -> GraphState:
    """Identify risk notes from quality and freshness signals."""
    return identify_risks_state(state)


def format_output_node(state: GraphState) -> GraphState:
    """Populate compatibility output buckets for agent consumers."""
    return format_output_state(state)


def route_on_validation(state: GraphState) -> str:
    """Route to format_output if validation failed, else continue."""
    if state.get("errors"):
        return "format_output"
    return "parse_indicator"


def route_on_themes(state: GraphState) -> str:
    """Route to fallback if no themes extracted."""
    if state.get("extracted_themes"):
        return "fetch_catalog"
    return "fallback_theme_extraction"


def route_after_filter(state: GraphState) -> str:
    """Route to format_output if no candidates, else score."""
    if state.get("candidate_datasets"):
        return "score_recommendations"
    return "format_output"


def build_recommendation_graph() -> StateGraph:
    """Build the LangGraph StateGraph for recommendation workflow."""
    graph = StateGraph(GraphState)

    graph.add_node("normalize_input", normalize_input_node)
    graph.add_node("parse_indicator", parse_indicator_node)
    graph.add_node("extract_themes", extract_themes_node)
    graph.add_node("fallback_theme_extraction", fallback_theme_extraction_node)
    graph.add_node("fetch_catalog", fetch_catalog_node)
    graph.add_node("filter_candidates", filter_candidates_node)
    graph.add_node("score_recommendations", score_recommendations_node)
    graph.add_node("identify_gaps", identify_gaps_node)
    graph.add_node("identify_risks", identify_risks_node)
    graph.add_node("format_output", format_output_node)

    graph.set_entry_point("normalize_input")
    graph.add_conditional_edges(
        "normalize_input",
        route_on_validation,
        {
            "parse_indicator": "parse_indicator",
            "format_output": "format_output",
        },
    )
    graph.add_edge("parse_indicator", "extract_themes")
    graph.add_conditional_edges(
        "extract_themes",
        route_on_themes,
        {
            "fetch_catalog": "fetch_catalog",
            "fallback_theme_extraction": "fallback_theme_extraction",
        },
    )
    graph.add_edge("fallback_theme_extraction", "fetch_catalog")
    graph.add_edge("fetch_catalog", "filter_candidates")
    graph.add_conditional_edges(
        "filter_candidates",
        route_after_filter,
        {
            "score_recommendations": "score_recommendations",
            "format_output": "format_output",
        },
    )
    graph.add_edge("score_recommendations", "identify_gaps")
    graph.add_edge("identify_gaps", "identify_risks")
    graph.add_edge("identify_risks", "format_output")
    graph.add_edge("format_output", END)

    return graph


recommendation_graph = build_recommendation_graph().compile()


def run_recommendation_agent(indicator_text: str) -> Dict:
    """Execute the recommendation workflow and return the original state shape."""
    initial_state: GraphState = {
        "indicator_text": indicator_text,
        "parsed_indicator": {},
        "extracted_themes": [],
        "theme_confidence": {},
        "candidate_datasets": [],
        "scored_recommendations": [],
        "selected_dataset_ids": [],
        "gaps": [],
        "risks": [],
        "errors": [],
        "debug_trace": [],
    }
    return recommendation_graph.invoke(initial_state)
