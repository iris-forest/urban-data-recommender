"""LLM-based insight generation for datasets.

Generates human-readable descriptions, risk notes, and column insights
using OpenAI or Groq APIs (optional, behind feature flags).

Falls back to keyword-based heuristics if LLM is disabled or unavailable.
"""
from __future__ import annotations

import asyncio
from typing import Optional
import logging

from .config import Config
from .models import DatasetSummary

logger = logging.getLogger(__name__)


# =============================================================================
# LLM Client Initialization
# =============================================================================

def _get_llm_client():
    """Initialize and return LLM client based on config."""
    if not Config.ENABLE_LLM_INSIGHTS or Config.LLM_PROVIDER == "none":
        return None
    
    if Config.LLM_PROVIDER == "openai":
        try:
            from openai import OpenAI
            return OpenAI(api_key=Config.LLM_API_KEY)
        except ImportError:
            logger.warning("OpenAI client not installed; LLM insights disabled")
            return None
    elif Config.LLM_PROVIDER == "groq":
        try:
            from groq import Groq
            return Groq(api_key=Config.LLM_API_KEY)
        except ImportError:
            logger.warning("Groq client not installed; LLM insights disabled")
            return None
    
    return None


# =============================================================================
# Column Description Generation
# =============================================================================

def generate_column_description(
    column_name: str,
    column_sample_values: list[str] | None = None,
    dataset_title: str = "",
) -> str:
    """Generate a one-line description for a dataset column using LLM or heuristics.
    
    Args:
        column_name: Name of the column
        column_sample_values: Sample values (if available)
        dataset_title: Title of the dataset for context
    
    Returns:
        One-line human-readable description
    """
    client = _get_llm_client()
    
    if client:
        return _generate_with_llm(
            f"""Generate a one-line, plain-English description (under 12 words) for this column:

Column name: {column_name}
Dataset: {dataset_title}
Sample values: {column_sample_values[:3] if column_sample_values else 'N/A'}

Return only the description, nothing else.""",
            max_tokens=30,
        )
    else:
        return _generate_column_description_heuristic(column_name)


def _generate_column_description_heuristic(column_name: str) -> str:
    """Generate column description using keyword heuristics."""
    name_lower = column_name.lower()
    
    # Common column patterns
    patterns = {
        "id": "Unique identifier",
        "name": "Name or label",
        "date": "Date or timestamp",
        "count": "Number or count",
        "value": "Numeric value",
        "status": "Current status",
        "type": "Classification or type",
        "category": "Category or group",
        "location": "Geographic location",
        "coordinate": "GPS coordinate",
        "latitude": "North-south position",
        "longitude": "East-west position",
        "address": "Street address",
        "price": "Cost or price",
        "population": "Population count",
        "density": "Density measure",
        "distance": "Distance measurement",
        "time": "Time value",
        "duration": "Time span",
        "frequency": "How often",
        "rate": "Rate or ratio",
    }
    
    for pattern, description in patterns.items():
        if pattern in name_lower:
            return description
    
    # Default: title-case the column name
    return column_name.replace("_", " ").title()


# =============================================================================
# Risk Notes Generation
# =============================================================================

def generate_risk_notes(
    dataset_title: str,
    columns: list[str] | None = None,
    completeness: float = 100.0,
    timeliness: str = "unknown",
) -> list[str]:
    """Generate data quality risk notes using LLM or heuristics.
    
    Args:
        dataset_title: Title of the dataset
        columns: List of column names
        completeness: Completeness percentage (0-100)
        timeliness: How recent the data is (e.g., 'recent', 'outdated', 'unknown')
    
    Returns:
        List of risk notes (up to 3 bullet points)
    """
    client = _get_llm_client()
    
    if client:
        col_str = ", ".join(columns[:5]) if columns else "unknown"
        response = _generate_with_llm(
            f"""Generate 2-3 concise, actionable data quality risk notes for this dataset:

Title: {dataset_title}
Columns: {col_str}
Completeness: {completeness}%
Timeliness: {timeliness}

Format: Plain-text bullet list (one per line, starting with "-"). Keep each under 15 words.""",
            max_tokens=150,
        )
        return [line.strip() for line in response.split("\n") if line.strip().startswith("-")]
    else:
        return _generate_risk_notes_heuristic(completeness, timeliness)


def _generate_risk_notes_heuristic(completeness: float, timeliness: str) -> list[str]:
    """Generate risk notes using keyword heuristics."""
    risks = []
    
    if completeness < 80:
        risks.append(f"- Completeness is only {completeness}%; missing data may affect analysis")
    if completeness < 60:
        risks.append("- High missingness may bias indicators; validate results")
    
    if timeliness == "outdated":
        risks.append("- Data may be outdated; verify recency before use")
    elif timeliness == "unknown":
        risks.append("- Update frequency unknown; verify timeliness with data provider")
    
    if not risks:
        risks.append("- Review quality metadata before analysis")
    
    return risks[:3]


# =============================================================================
# Recommended Usage Generation
# =============================================================================

def generate_recommended_usage(
    dataset_title: str,
    description: str = "",
    themes: list[str] | None = None,
) -> str:
    """Generate recommended usage guidance using LLM or heuristics.
    
    Args:
        dataset_title: Title of the dataset
        description: Brief description
        themes: Extracted themes/categories
    
    Returns:
        One or two sentence usage recommendation
    """
    client = _get_llm_client()
    
    if client:
        themes_str = ", ".join(themes[:3]) if themes else "general"
        response = _generate_with_llm(
            f"""In one sentence (under 20 words), recommend a use case for this dataset:

Title: {dataset_title}
Description: {description}
Themes: {themes_str}

Return only the recommendation.""",
            max_tokens=30,
        )
        return response.strip()
    else:
        return _generate_recommended_usage_heuristic(dataset_title, themes)


def _generate_recommended_usage_heuristic(dataset_title: str, themes: list[str] | None = None) -> str:
    """Generate recommended usage using heuristics."""
    if themes and "population" in themes:
        return "Use for demographic analysis and population-based indicators"
    elif themes and "transport" in themes:
        return "Essential for accessibility and mobility analysis"
    elif themes and "housing" in themes:
        return "Useful for urban planning and real estate analysis"
    else:
        return f"Use for analysis and research related to {dataset_title.lower()}"


# =============================================================================
# LLM API Calls
# =============================================================================

def _generate_with_llm(prompt: str, max_tokens: int = 100) -> str:
    """Call LLM API with fallback error handling.
    
    Args:
        prompt: Prompt text
        max_tokens: Maximum response length
    
    Returns:
        Generated text or empty string on error
    """
    try:
        client = _get_llm_client()
        if not client:
            return ""
        
        if Config.LLM_PROVIDER == "openai":
            response = client.chat.completions.create(
                model=Config.LLM_MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
                temperature=0.3,
            )
        elif Config.LLM_PROVIDER == "groq":
            response = client.chat.completions.create(
                model=Config.LLM_MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
                temperature=0.3,
            )
        else:
            return ""
        
        return response.choices[0].message.content.strip()
    except Exception as e:
        logger.warning(f"LLM generation failed: {e}; falling back to heuristics")
        return ""


# =============================================================================
# Batch Enrichment
# =============================================================================

def enrich_dataset_summary(summary: DatasetSummary) -> DatasetSummary:
    """Enrich a dataset summary with LLM-generated insights.
    
    Generates improved descriptions for columns, risk notes, and usage recommendations.
    Falls back to heuristics if LLM is disabled or fails.
    
    Args:
        summary: DatasetSummary object
    
    Returns:
        Enriched DatasetSummary
    """
    if not Config.ENABLE_LLM_INSIGHTS:
        return summary
    
    try:
        # Enrich column descriptions
        enriched_columns = {}
        for col in summary.columns or []:
            enriched_columns[col] = generate_column_description(
                col,
                dataset_title=summary.title or ""
            )
        
        # Enrich risk notes if empty
        if not summary.risk_notes or len(summary.risk_notes) == 0:
            summary.risk_notes = generate_risk_notes(
                summary.title or "",
                columns=list(enriched_columns.keys()),
                completeness=100.0,
            )
        
        # Enrich recommended usage if empty
        if not summary.recommended_usage or summary.recommended_usage == "":
            summary.recommended_usage = generate_recommended_usage(
                summary.title or "",
                description=summary.description or "",
                themes=summary.tags,
            )
        
        return summary
    except Exception as e:
        logger.warning(f"Enrichment failed: {e}; returning original summary")
        return summary


# =============================================================================
# Toggle/Check Functions
# =============================================================================

def is_llm_enabled() -> bool:
    """Check if LLM insights are enabled and configured."""
    return (
        Config.ENABLE_LLM_INSIGHTS
        and Config.LLM_PROVIDER != "none"
        and Config.LLM_API_KEY != ""
    )


def get_insight_source() -> str:
    """Return the current insight generation source."""
    if is_llm_enabled():
        return f"{Config.LLM_PROVIDER} ({Config.LLM_MODEL})"
    return "heuristic (keyword-based)"
