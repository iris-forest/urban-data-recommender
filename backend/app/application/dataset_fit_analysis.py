"""Analyze how selected datasets fit an indicator request."""
from __future__ import annotations

from dataclasses import dataclass
import json
import logging
import re
import unicodedata
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set

from ..api_schemas import (
    CrossDatasetFitSummary,
    DatasetFitAnalysisRequest,
    DatasetFitAnalysisResponse,
    DatasetFitColumnInsight,
    DatasetFitInsight,
)
from ..catalog_translation import ensure_dataset_translations
from ..catalog import get_dataset_by_id
from ..llm_insights import _generate_with_llm, is_llm_enabled
from ..models import Dataset, DatasetQuality
from ..preview import NO_ROW_PREVIEW_MESSAGE, build_dataset_preview

logger = logging.getLogger(__name__)

MAX_PROMPT_COLUMNS = 12
MAX_PROMPT_ROWS = 3

# Theme and role dictionaries are the shared vocabulary for deterministic fit
# analysis. They let the fallback path explain why a dataset matches an
# indicator even when LLM analysis is disabled.
THEME_ROLE_MAP: Dict[str, Set[str]] = {
    "accessibility_proximity": {"accessibility", "transport"},
    "transport_networks": {"transport"},
    "population": {"population"},
    "geographic_boundaries": {"geography", "geometry"},
    "green_space": {"green_space"},
    "water_management": {"water"},
    "air_quality": {"air_quality"},
    "heat_exposure": {"heat"},
    "land_use": {"land_use"},
    "socioeconomic_context": {"socioeconomic"},
    "housing_affordability": {"housing"},
    "employment": {"employment"},
    "health": {"health"},
    "education": {"education"},
}

ROLE_LABELS: Dict[str, str] = {
    "accessibility": "access or distance measures",
    "air_quality": "air quality or low-emission zone context",
    "category": "classification fields",
    "education": "education context",
    "employment": "employment context",
    "geography": "geographic join fields",
    "geometry": "geometry or coordinate fields",
    "green_space": "green space measures",
    "health": "health context",
    "heat": "heat or temperature context",
    "housing": "housing context",
    "identifier": "record identifiers",
    "land_use": "land use context",
    "measure": "numeric measure fields",
    "population": "population or resident counts",
    "socioeconomic": "socioeconomic context",
    "time": "time period fields",
    "transport": "transport network fields",
    "water": "water management context",
}

ROLE_KEYWORDS: Dict[str, Sequence[str]] = {
    "geometry": (
        "geometry",
        "geom",
        "geojson",
        "wkt",
        "latitude",
        "longitude",
        "latitud",
        "longitud",
        "lat",
        "lon",
        "lng",
        "coordinate",
        "coordenada",
        "x_coord",
        "y_coord",
    ),
    "geography": (
        "district",
        "distrito",
        "neighborhood",
        "neighbourhood",
        "barrio",
        "census",
        "tract",
        "section",
        "seccion",
        "municipality",
        "municipio",
        "postal",
        "zip",
        "address",
        "direccion",
        "boundary",
        "boundaries",
        "administrative",
    ),
    "time": (
        "date",
        "fecha",
        "time",
        "timestamp",
        "period",
        "periodo",
        "month",
        "mes",
        "year",
        "ano",
        "anio",
        "quarter",
        "trimestre",
        "updated",
        "last_updated",
    ),
    "population": (
        "population",
        "poblacion",
        "resident",
        "residents",
        "habitante",
        "habitantes",
        "inhabitant",
        "household",
        "hogar",
        "older adult",
        "senior",
        "elderly",
        "edad",
        "age",
    ),
    "green_space": (
        "green space",
        "green area",
        "park",
        "parks",
        "parque",
        "parques",
        "zona verde",
        "zonas verdes",
        "garden",
        "jardin",
        "vegetation",
        "vegetacion",
        "tree",
        "canopy",
        "open space",
    ),
    "water": (
        "water",
        "agua",
        "water management",
        "gestion del agua",
        "gestión del agua",
        "stormwater",
        "storm water",
        "wastewater",
        "waste water",
        "drainage",
        "drenaje",
        "sewer",
        "sewerage",
        "alcantarillado",
        "saneamiento",
        "irrigation",
        "riego",
        "flood",
        "flooding",
        "inundacion",
        "inundación",
    ),
    "transport": (
        "transport",
        "transit",
        "bus",
        "metro",
        "rail",
        "commuter",
        "station",
        "stations",
        "stop",
        "stops",
        "route",
        "line",
        "mobility",
        "cercanias",
        "autobus",
    ),
    "accessibility": (
        "accessibility",
        "access",
        "distance",
        "distancia",
        "proximity",
        "walking",
        "walk",
        "radius",
        "buffer",
        "meters",
        "metres",
    ),
    "air_quality": (
        "air quality",
        "pollution",
        "contaminacion",
        "emission",
        "emissions",
        "low emission",
        "low-emission",
        "lez",
        "zbe",
        "no2",
        "pm10",
        "pm2",
        "ozone",
        "o3",
        "aqi",
    ),
    "heat": (
        "heat",
        "temperature",
        "temperatura",
        "calor",
        "urban heat",
        "heat island",
        "isla de calor",
        "surface temperature",
        "thermal",
        "cooling",
    ),
    "land_use": (
        "land use",
        "zoning",
        "zoning",
        "parcel",
        "parcela",
        "cadastre",
        "catastro",
        "building",
        "urban form",
        "use class",
    ),
    "socioeconomic": (
        "socioeconomic",
        "socio economic",
        "income",
        "renta",
        "deprivation",
        "poverty",
        "vulnerability",
        "vulnerabilidad",
        "equity",
    ),
    "housing": (
        "housing",
        "residential",
        "vivienda",
        "rent",
        "rental",
        "affordability",
        "home",
    ),
    "employment": (
        "employment",
        "jobs",
        "unemployment",
        "labor",
        "labour",
        "workforce",
        "empleo",
        "paro",
    ),
    "health": (
        "health",
        "hospital",
        "clinic",
        "wellbeing",
        "salud",
        "sanitario",
    ),
    "education": (
        "education",
        "school",
        "student",
        "teacher",
        "university",
        "educacion",
        "colegio",
    ),
    "measure": (
        "count",
        "total",
        "value",
        "valor",
        "area",
        "superficie",
        "surface",
        "rate",
        "ratio",
        "percentage",
        "percent",
        "score",
        "indicator",
        "measure",
        "amount",
    ),
    "identifier": (
        "id",
        "identifier",
        "code",
        "codigo",
        "cod",
        "clave",
        "gid",
    ),
    "category": (
        "type",
        "tipo",
        "class",
        "category",
        "categoria",
        "status",
        "estado",
    ),
}

COLUMN_ROLE_PRIORITY = (
    "geometry",
    "geography",
    "time",
    "population",
    "green_space",
    "water",
    "transport",
    "accessibility",
    "air_quality",
    "land_use",
    "socioeconomic",
    "housing",
    "employment",
    "health",
    "education",
    "measure",
    "identifier",
    "category",
)


# Evidence is the normalized bundle used by both the heuristic and LLM paths:
# catalog metadata, preview payload, inferred column roles, and warnings.
@dataclass
class DatasetEvidence:
    dataset: Dataset
    preview: Dict[str, Any]
    column_insights: List[DatasetFitColumnInsight]
    metadata_roles: Set[str]
    warnings: List[str]

    @property
    def all_roles(self) -> Set[str]:
        roles = set(self.metadata_roles)
        roles.update(column.semantic_role for column in self.column_insights if column.semantic_role != "unknown")
        return roles


def analyze_selected_dataset_fit(request: DatasetFitAnalysisRequest) -> DatasetFitAnalysisResponse:
    """Analyze selected datasets with LLM-first behavior and heuristic fallback."""
    dataset_ids = _dedupe([dataset_id.strip() for dataset_id in request.dataset_ids if dataset_id.strip()])
    if not dataset_ids:
        raise ValueError("Select at least one dataset to analyze.")

    warnings: List[str] = []
    evidence: List[DatasetEvidence] = []
    snapshot_lookup = _snapshot_lookup(request.dataset_snapshots)

    # Resolve every selected dataset from the active backend catalog first. The
    # frontend snapshot is only a fallback for stale selections after a reload.
    for dataset_id in dataset_ids:
        dataset = get_dataset_by_id(dataset_id, include_apis=True)
        if dataset is None:
            dataset = _dataset_from_snapshot(snapshot_lookup.get(dataset_id))
            if dataset is None:
                warnings.append(f"Dataset '{dataset_id}' was not found and was skipped.")
                continue
            ensure_dataset_translations(dataset)
            warnings.append(f"'{dataset.title_en or dataset.title}' was analyzed from the selected dataset snapshot because it was not available in the live backend catalog.")

        dataset_evidence = _build_dataset_evidence(dataset, request.preview_rows)
        warnings.extend(dataset_evidence.warnings)
        evidence.append(dataset_evidence)

    if not evidence:
        raise ValueError("None of the selected datasets could be found.")

    heuristic_response = _build_heuristic_response(
        request=request,
        evidence=evidence,
        warnings=warnings,
    )

    llm_response = _build_llm_response(request, evidence, heuristic_response)
    if llm_response:
        llm_response.insight_source = "llm"
        llm_response.warnings = _dedupe([*warnings, *llm_response.warnings])
        if not llm_response.recommended_dataset_ids:
            llm_response.recommended_dataset_ids = _recommended_ids_from_insights(llm_response.datasets)
        return llm_response

    return heuristic_response


def _snapshot_lookup(snapshots: Sequence[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Index optional frontend dataset snapshots by id."""
    lookup: Dict[str, Dict[str, Any]] = {}
    for snapshot in snapshots:
        if not isinstance(snapshot, dict):
            continue
        dataset_id = str(snapshot.get("dataset_id") or snapshot.get("id") or "").strip()
        if dataset_id:
            lookup[dataset_id] = snapshot
    return lookup


def _dataset_from_snapshot(snapshot: Optional[Dict[str, Any]]) -> Optional[Dataset]:
    """Rebuild enough Dataset metadata from a frontend snapshot to analyze it."""
    if not snapshot:
        return None

    dataset_id = str(snapshot.get("dataset_id") or snapshot.get("id") or "").strip()
    title = str(snapshot.get("title") or snapshot.get("name") or "").strip()
    if not dataset_id or not title:
        return None

    quality_payload = snapshot.get("quality") if isinstance(snapshot.get("quality"), dict) else {}
    schema_fields = snapshot.get("schema_fields") or snapshot.get("schemaFields") or []

    return Dataset(
        dataset_id=dataset_id,
        title=title,
        provider=str(snapshot.get("provider") or ""),
        themes=list(snapshot.get("themes") or ([snapshot.get("theme")] if snapshot.get("theme") else [])),
        spatial_coverage=str(snapshot.get("spatial_coverage") or snapshot.get("spatialCoverage") or ""),
        spatial_resolution=str(snapshot.get("spatial_resolution") or snapshot.get("spatialResolution") or ""),
        update_frequency=str(snapshot.get("update_frequency") or snapshot.get("updateFrequency") or ""),
        last_updated=str(snapshot.get("last_updated") or snapshot.get("lastUpdate") or ""),
        access_type=str(snapshot.get("access_type") or snapshot.get("accessType") or "open"),
        formats=list(snapshot.get("formats") or []),
        quality=DatasetQuality(
            completeness=_snapshot_quality_value(quality_payload.get("completeness"), 0.75),
            timeliness=_snapshot_quality_value(quality_payload.get("timeliness"), 0.7),
            consistency=_snapshot_quality_value(quality_payload.get("consistency"), 0.7),
            documentation=_snapshot_quality_value(quality_payload.get("documentation"), 0.65),
        ),
        description=str(snapshot.get("description") or snapshot.get("usageExplanation") or ""),
        schema_fields=schema_fields if isinstance(schema_fields, list) else [],
        primary_category=str(snapshot.get("primary_category") or snapshot.get("category") or ""),
        categories=list(snapshot.get("categories") or []),
        category_confidence=float(snapshot.get("category_confidence") or snapshot.get("categoryConfidence") or 0.0),
        category_method=str(snapshot.get("category_method") or snapshot.get("categoryMethod") or "snapshot"),
        source=str(snapshot.get("source") or ""),
        api_url=str(snapshot.get("api_url") or snapshot.get("apiUrl") or ""),
    )


def _snapshot_quality_value(value: Any, fallback: float) -> float:
    if isinstance(value, str):
        normalized = _normalize_text(value)
        labels = {
            "recent": 0.85,
            "moderate": 0.6,
            "outdated": 0.35,
            "high": 0.9,
            "medium": 0.65,
            "low": 0.35,
            "excellent": 0.9,
            "good": 0.75,
            "limited": 0.4,
        }
        if normalized in labels:
            return labels[normalized]
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return fallback
    if numeric > 1:
        numeric = numeric / 100.0
    return max(0.0, min(1.0, numeric))


def _build_dataset_evidence(dataset: Dataset, preview_rows: int) -> DatasetEvidence:
    """Collect preview rows, schema fields, and metadata-derived role hints."""
    ensure_dataset_translations(dataset)
    warnings: List[str] = []
    try:
        preview = build_dataset_preview(dataset, max_rows=preview_rows)
    except Exception as exc:  # pragma: no cover - external preview failures are defensive
        logger.info("Dataset fit preview failed for %s: %s", dataset.dataset_id, exc)
        preview = {
            "dataset_id": dataset.dataset_id,
            "columns": dataset.schema_fields or [],
            "rows": dataset.sample_preview or [],
            "source_url": dataset.api_url or "",
            "resource_name": "",
            "resource_format": "",
            "message": NO_ROW_PREVIEW_MESSAGE,
        }
        warnings.append(f"Preview failed for '{dataset.title_en or dataset.title}'; using catalog metadata only.")

    if preview.get("message"):
        warnings.append(f"'{dataset.title_en or dataset.title}' has limited row preview data.")

    rows = preview.get("rows") or []
    columns = preview.get("columns") or []
    if not columns and rows:
        columns = [{"name": name, "inferred_type": "unknown", "description": ""} for name in rows[0]]

    column_insights = [
        _classify_column(column, rows)
        for column in columns
        if isinstance(column, dict) and str(column.get("name", "")).strip()
    ]

    metadata_blob = " ".join(
        [
            dataset.title,
            dataset.description,
            dataset.provider,
            dataset.primary_category,
            " ".join(dataset.themes or []),
            " ".join(str(category) for category in dataset.categories or []),
            dataset.spatial_coverage,
            dataset.spatial_resolution,
            dataset.update_frequency,
        ]
    )
    metadata_roles = _detect_roles(metadata_blob)
    for theme_id in dataset.themes or []:
        metadata_roles.update(THEME_ROLE_MAP.get(_normalize_theme_id(theme_id), set()))

    return DatasetEvidence(
        dataset=dataset,
        preview=preview,
        column_insights=column_insights,
        metadata_roles=metadata_roles,
        warnings=warnings,
    )


def _classify_column(column: Dict[str, Any], rows: Sequence[Dict[str, Any]]) -> DatasetFitColumnInsight:
    """Assign one semantic role to a column using its name, type, description, and samples."""
    name = str(column.get("name", "")).strip()
    inferred_type = str(column.get("inferred_type") or column.get("type") or "unknown")
    description = str(column.get("description") or "")
    sample_values = _sample_values_for_column(name, rows)
    detection_text = " ".join([name, description, " ".join(sample_values[:3]), inferred_type])
    role_scores = _detect_role_scores(detection_text)

    semantic_role = "unknown"
    confidence = 0.0
    for role in COLUMN_ROLE_PRIORITY:
        score = role_scores.get(role, 0.0)
        if score > confidence:
            semantic_role = role
            confidence = score

    if semantic_role == "unknown" and inferred_type in {"integer", "number"}:
        semantic_role = "measure"
        confidence = 0.45

    notes = ROLE_LABELS.get(semantic_role, "")
    return DatasetFitColumnInsight(
        name=name,
        inferred_type=inferred_type,
        semantic_role=semantic_role,
        sample_values=sample_values[:3],
        confidence=round(confidence, 2),
        notes=notes,
    )


def _sample_values_for_column(column_name: str, rows: Sequence[Dict[str, Any]]) -> List[str]:
    samples: List[str] = []
    normalized_target = _normalize_text(column_name)
    for row in rows:
        if not isinstance(row, dict):
            continue
        value = row.get(column_name)
        if value is None:
            for key, candidate in row.items():
                if _normalize_text(str(key)) == normalized_target:
                    value = candidate
                    break
        if value in ("", None):
            continue
        sample = str(value)
        if sample not in samples:
            samples.append(sample[:80])
        if len(samples) >= 3:
            break
    return samples


def _build_heuristic_response(
    request: DatasetFitAnalysisRequest,
    evidence: Sequence[DatasetEvidence],
    warnings: Sequence[str],
) -> DatasetFitAnalysisResponse:
    """Build deterministic fit recommendations when LLM output is unavailable."""
    required_roles = _required_roles(request)
    insights = [
        _build_dataset_fit_insight(item, required_roles, request)
        for item in evidence
    ]
    insights.sort(key=lambda insight: insight.fit_score, reverse=True)

    cross_summary = _build_cross_dataset_summary(
        request=request,
        evidence=evidence,
        insights=insights,
        required_roles=required_roles,
    )

    return DatasetFitAnalysisResponse(
        insight_source="heuristic",
        datasets=insights,
        recommended_dataset_ids=_recommended_ids_from_insights(insights),
        cross_dataset_summary=cross_summary,
        warnings=_dedupe(warnings),
    )


def _build_dataset_fit_insight(
    evidence: DatasetEvidence,
    required_roles: Set[str],
    request: DatasetFitAnalysisRequest,
) -> DatasetFitInsight:
    """Score one dataset and turn the evidence into user-facing guidance."""
    dataset = evidence.dataset
    roles = evidence.all_roles
    useful_columns = [
        column
        for column in evidence.column_insights
        if column.semantic_role in required_roles
        or column.semantic_role in {"geography", "geometry", "time", "identifier", "measure"}
    ][:8]

    fit_score = _score_fit(evidence, required_roles)
    role = _recommended_role(roles, required_roles, request.indicator_text, fit_score)
    missing = _missing_requirements(roles, required_roles)
    limitations = _limitations(evidence, required_roles, missing)
    quality_risks = _quality_risks(dataset, evidence)
    geo_fields = _column_names_for_roles(evidence.column_insights, {"geography", "geometry"})
    time_fields = _column_names_for_roles(evidence.column_insights, {"time"})
    join_keys = _column_names_for_roles(evidence.column_insights, {"geography", "identifier", "geometry"})[:5]

    return DatasetFitInsight(
        dataset_id=dataset.dataset_id,
        title=dataset.title_en or dataset.title,
        provider=dataset.provider,
        formats=dataset.formats,
        source_url=dataset.api_url or str(evidence.preview.get("source_url") or ""),
        fit_score=fit_score,
        recommended_role=role,
        fit_summary=_fit_summary(roles, required_roles),
        useful_columns=useful_columns,
        limitations=limitations,
        missing_requirements=missing,
        join_keys=join_keys,
        time_fields=time_fields,
        geo_fields=geo_fields,
        quality_risks=quality_risks,
        recommended_next_action=_next_action(role, join_keys, time_fields, request),
    )


def _required_roles(request: DatasetFitAnalysisRequest) -> Set[str]:
    """Infer the requirement areas the selected datasets should collectively cover."""
    roles: Set[str] = set()
    indicator_text = request.indicator_text or ""
    parsed = request.parsed_indicator or {}
    normalized_indicator = _normalize_text(indicator_text)

    for theme_id in request.selected_themes or []:
        normalized_theme = _normalize_theme_id(theme_id)
        roles.update(THEME_ROLE_MAP.get(normalized_theme, set()))

    roles.update(
        role
        for role in _detect_roles(indicator_text)
        if role not in {"identifier", "category", "measure"}
    )

    geographic_level = _normalize_text(str(parsed.get("geographic_level") or ""))
    if geographic_level and geographic_level not in {"unknown", "none"}:
        roles.add("geography")
    if re.search(r"\b(by|within|per)\s+(district|neighborhood|neighbourhood|census|tract|area|zone)\b", normalized_indicator):
        roles.add("geography")

    time_frame = _normalize_text(str(parsed.get("time_frame") or ""))
    if time_frame and time_frame not in {"unknown", "none"}:
        roles.add("time")
    if re.search(r"\b(last|past|previous)\s+\d+\s+(day|week|month|year)", normalized_indicator):
        roles.add("time")

    population = _normalize_text(str(parsed.get("population") or ""))
    if population and population not in {"unknown", "none"}:
        roles.add("population")
    if re.search(r"\b(per resident|resident|residents|population|older adult|older adults|inhabitant)", normalized_indicator):
        roles.add("population")

    return roles


def _score_fit(evidence: DatasetEvidence, required_roles: Set[str]) -> int:
    roles = evidence.all_roles
    score = 0.0
    thematic_required = required_roles.difference({"geography", "geometry", "time", "population"})
    covered_thematic = roles.intersection(thematic_required)

    if covered_thematic:
        score += 34.0 + min(16.0, 6.0 * (len(covered_thematic) - 1))
    elif not thematic_required and roles.intersection(required_roles):
        score += 24.0

    if "population" in required_roles and "population" in roles:
        score += 28.0
    if {"geography", "geometry"}.intersection(required_roles) and {"geography", "geometry"}.intersection(roles):
        score += 14.0
    if "time" in required_roles and "time" in roles:
        score += 9.0

    if evidence.column_insights:
        score += 7.0
    if evidence.preview.get("rows"):
        score += 5.0

    score += _dataset_quality_score(evidence.dataset) * 12.0

    if not roles.intersection(required_roles):
        score = min(score, 32.0)

    return int(round(max(0.0, min(100.0, score))))


def _dataset_quality_score(dataset: Dataset) -> float:
    quality = dataset.quality
    if not quality:
        return 0.5
    values = [
        _normalize_quality_value(quality.completeness),
        _normalize_quality_value(quality.timeliness),
        _normalize_quality_value(quality.consistency),
        _normalize_quality_value(quality.documentation),
    ]
    return sum(values) / len(values)


def _normalize_quality_value(value: Any) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return 0.5
    if numeric > 1:
        numeric = numeric / 100.0
    return max(0.0, min(1.0, numeric))


def _recommended_role(roles: Set[str], required_roles: Set[str], indicator_text: str, fit_score: int) -> str:
    if fit_score < 35:
        return "Not recommended for this indicator"
    if "green_space" in roles and "green_space" in required_roles:
        return "Core measure for green space area"
    if "water" in roles and "water" in required_roles:
        return "Water management context"
    if "population" in roles and "population" in required_roles:
        if "per" in _normalize_text(indicator_text):
            return "Denominator for per-resident normalization"
        return "Population context"
    if "transport" in roles.intersection(required_roles) or "accessibility" in roles.intersection(required_roles):
        return "Access and mobility measure"
    if "air_quality" in roles and "air_quality" in required_roles:
        return "Environmental zone or air quality context"
    if "heat" in roles and "heat" in required_roles:
        return "Heat or temperature context"
    if {"geography", "geometry"}.intersection(roles) and {"geography", "geometry"}.intersection(required_roles):
        return "Geographic join layer"
    if "land_use" in roles and "land_use" in required_roles:
        return "Land use context"
    if "socioeconomic" in roles and "socioeconomic" in required_roles:
        return "Equity and socioeconomic context"
    return "Supporting dataset"


def _fit_summary(roles: Set[str], required_roles: Set[str]) -> str:
    covered = _format_role_list(sorted(roles.intersection(required_roles)))
    if covered:
        return f"Contains {covered}."
    return "Weak direct evidence for this indicator; validate before use."


def _missing_requirements(roles: Set[str], required_roles: Set[str]) -> List[str]:
    missing = []
    for role in sorted(required_roles.difference(roles)):
        label = ROLE_LABELS.get(role, role.replace("_", " "))
        missing.append(f"No clear {label} found")
    return missing[:6]


def _limitations(evidence: DatasetEvidence, required_roles: Set[str], missing: Sequence[str]) -> List[str]:
    limitations: List[str] = []
    if not evidence.preview.get("rows"):
        limitations.append("No row sample was available, so column meaning is inferred from metadata.")
    if not evidence.column_insights:
        limitations.append("No schema fields were available for column-level inspection.")
    if "time" in required_roles and "time" not in evidence.all_roles:
        limitations.append("No clear time field was detected for aligning the requested time window.")
    if missing:
        limitations.append(_missing_requirements_limitation(evidence, required_roles))
    return _dedupe(limitations)[:4]


def _missing_requirements_limitation(evidence: DatasetEvidence, required_roles: Set[str]) -> str:
    missing_roles = sorted(required_roles.difference(evidence.all_roles).difference({"time"}))
    if not missing_roles:
        return "Missing fields should be confirmed against the source before calculating the indicator."

    missing_phrase = _format_role_list(missing_roles)
    covered_roles = sorted(evidence.all_roles.intersection(required_roles))
    if covered_roles:
        covered_phrase = _format_role_list(covered_roles)
        return (
            f"Covers {covered_phrase}, but does not clearly include {missing_phrase}; "
            "combine it with data that supplies those fields before calculating the indicator."
        )

    return (
        f"Does not clearly include {missing_phrase}; treat it as supporting context "
        "unless selected datasets supply those fields."
    )


def _quality_risks(dataset: Dataset, evidence: DatasetEvidence) -> List[str]:
    risks: List[str] = []
    quality = dataset.quality
    if quality:
        if _normalize_quality_value(quality.completeness) < 0.7:
            risks.append("Completeness is low enough to affect indicator reliability.")
        if _normalize_quality_value(quality.timeliness) < 0.55:
            risks.append("Source freshness may not match the requested analysis period.")
        if _normalize_quality_value(quality.consistency) < 0.6:
            risks.append("Consistency is limited; inspect values before combining.")
        if _normalize_quality_value(quality.documentation) < 0.55:
            risks.append("Documentation is limited; confirm definitions with the source.")
    if not evidence.preview.get("rows"):
        risks.append("Preview rows are unavailable; inspect the source file before production use.")
    return risks[:4]


def _next_action(
    role: str,
    join_keys: Sequence[str],
    time_fields: Sequence[str],
    request: DatasetFitAnalysisRequest,
) -> str:
    if "Not recommended" in role:
        return "Keep only if no stronger selected dataset covers this requirement."
    if "Denominator" in role:
        return "Join this dataset to the core measure by geography, then calculate the per-resident rate."
    if "green space" in role.lower():
        return "Use this dataset to calculate green space area, then normalize or filter with the other selected datasets."
    if "Environmental" in role:
        return "Use this dataset to identify the low-emission or air quality context before aggregating results."
    if "Geographic" in role:
        return "Use this layer to align selected datasets to the requested reporting geography."
    if join_keys:
        return f"Test joins using {', '.join(join_keys[:2])}."
    if time_fields and request.parsed_indicator.get("time_frame"):
        return f"Filter or aggregate by {', '.join(time_fields[:2])} for {request.parsed_indicator.get('time_frame')}."
    return "Inspect the source preview and confirm the fields before using it in the indicator workflow."


def _build_cross_dataset_summary(
    request: DatasetFitAnalysisRequest,
    evidence: Sequence[DatasetEvidence],
    insights: Sequence[DatasetFitInsight],
    required_roles: Set[str],
) -> CrossDatasetFitSummary:
    """Explain how the selected datasets work together as a small collection."""
    combined_roles: Set[str] = set()
    for item in evidence:
        combined_roles.update(item.all_roles)

    covered_roles = combined_roles.intersection(required_roles)
    missing_roles = required_roles.difference(combined_roles)
    gaps = [f"Missing {ROLE_LABELS.get(role, role.replace('_', ' '))}" for role in sorted(missing_roles)]

    geo_dataset_count = sum(1 for insight in insights if insight.geo_fields)
    join_strategy: List[str] = []
    if geo_dataset_count >= 2:
        join_strategy.append("Several selected datasets include geographic fields, so they can be compared once they are matched to the same reporting geography.")
    elif geo_dataset_count == 1:
        join_strategy.append("One selected dataset includes geographic fields that can anchor comparisons with the other selected datasets.")
    else:
        join_strategy.append("No clear shared geography is visible yet, so combining these datasets will require a confirmed geography key or geometry.")

    if "time" in required_roles:
        time_fields = [field for insight in insights for field in insight.time_fields]
        if time_fields:
            time_frame = request.parsed_indicator.get("time_frame") or "the requested period"
            join_strategy.append(f"Temporal fields are present, which supports comparison for {time_frame} after date definitions are checked.")
        else:
            join_strategy.append("No clear date fields were detected for the requested time window.")

    workflow = _recommended_workflow(insights, required_roles)
    summary = _cross_dataset_summary_text(covered_roles, required_roles)

    return CrossDatasetFitSummary(
        summary=summary,
        join_strategy=_dedupe(join_strategy),
        gaps=gaps or ["No major requirement gaps detected from metadata and preview rows."],
        recommended_workflow=workflow,
    )


def _cross_dataset_summary_text(covered_roles: Set[str], required_roles: Set[str]) -> str:
    if not required_roles:
        return "No specific indicator requirements were detected from the request, so review the selected datasets manually before analysis."

    requirement_text = _format_role_list(sorted(required_roles))
    if covered_roles == required_roles:
        return (
            f"Detected requirements: {requirement_text}. "
            f"All {len(required_roles)} are represented by the selected datasets."
        )

    missing_roles = required_roles.difference(covered_roles)
    covered_text = _format_role_list(sorted(covered_roles)) if covered_roles else "none"
    missing_text = _format_role_list(sorted(missing_roles))
    return (
        f"Detected requirements: {requirement_text}. "
        f"The selected datasets represent {len(covered_roles)} of {len(required_roles)}: {covered_text}. "
        f"Still missing: {missing_text}."
    )


def _recommended_workflow(insights: Sequence[DatasetFitInsight], required_roles: Set[str]) -> List[str]:
    workflow: List[str] = []
    roles = " ".join(insight.recommended_role.lower() for insight in insights)
    if "green_space" in required_roles:
        workflow.append("Start with the dataset that measures green space area or park coverage.")
    if "water" in required_roles:
        workflow.append("Use water, drainage, irrigation, or wastewater fields as the water management layer.")
    if "population" in required_roles:
        workflow.append("Join resident or population counts to normalize the measure.")
    if "air_quality" in required_roles:
        workflow.append("Apply the low-emission or air quality context as a filter or comparison layer.")
    if "heat" in required_roles:
        workflow.append("Use heat or temperature fields as the environmental comparison layer.")
    if {"transport", "accessibility"}.intersection(required_roles):
        workflow.append("Use transport or accessibility fields to calculate proximity before aggregation.")
    if "geographic" in roles or "geography" in required_roles:
        workflow.append("Aggregate the result to the requested geography after joins are validated.")
    if not workflow:
        workflow.append("Use the highest-scoring dataset first, then validate joins and missing fields.")
    return workflow


def _recommended_ids_from_insights(insights: Sequence[DatasetFitInsight]) -> List[str]:
    recommended = [insight.dataset_id for insight in insights if insight.fit_score >= 50]
    if recommended:
        return recommended
    return [insights[0].dataset_id] if insights else []


def _build_llm_response(
    request: DatasetFitAnalysisRequest,
    evidence: Sequence[DatasetEvidence],
    heuristic_response: DatasetFitAnalysisResponse,
) -> Optional[DatasetFitAnalysisResponse]:
    """Ask the configured LLM to refine the heuristic response, then validate it."""
    if not is_llm_enabled():
        return None

    evidence_payload = [_evidence_for_prompt(item) for item in evidence]
    prompt = f"""You are reviewing selected datasets for an urban planning indicator.

Indicator:
{request.indicator_text}

Parsed indicator context:
{json.dumps(request.parsed_indicator, ensure_ascii=False)}

Selected data themes:
{json.dumps(request.selected_themes, ensure_ascii=False)}

Dataset evidence from metadata, columns, and preview rows:
{json.dumps(evidence_payload, ensure_ascii=False)}

Heuristic baseline to refine:
{json.dumps(heuristic_response.dict(), ensure_ascii=False)}

Return one valid JSON object matching this shape exactly:
{{
  "insight_source": "llm",
  "datasets": [
    {{
      "dataset_id": "string",
      "title": "string",
      "provider": "string",
      "formats": ["string"],
      "source_url": "string",
      "fit_score": 0,
      "recommended_role": "string",
      "fit_summary": "one short sentence",
      "useful_columns": [
        {{
          "name": "string",
          "inferred_type": "string",
          "semantic_role": "string",
          "sample_values": ["string"],
          "confidence": 0.0,
          "notes": "string"
        }}
      ],
      "limitations": ["string"],
      "missing_requirements": ["string"],
      "join_keys": ["string"],
      "time_fields": ["string"],
      "geo_fields": ["string"],
      "quality_risks": ["string"],
      "recommended_next_action": "string"
    }}
  ],
  "recommended_dataset_ids": ["string"],
  "cross_dataset_summary": {{
    "summary": "string",
    "join_strategy": ["string"],
    "gaps": ["string"],
    "recommended_workflow": ["string"]
  }},
  "warnings": ["string"]
}}

Use only the evidence above. Do not invent columns. Keep all text concise and practical.
Do not repeat the dataset title or recommended_role inside fit_summary.
In cross_dataset_summary.summary, name the detected requirement areas instead of only giving a count.
In cross_dataset_summary.join_strategy, use concise English explanations. Do not include bracketed raw dataset titles or raw field-name examples there; keep raw columns in each dataset's useful_columns, join_keys, time_fields, and geo_fields.
When writing limitations, name the missing fields or themes directly instead of saying a dataset covers generic missing requirements."""

    raw_response = _generate_with_llm(prompt, max_tokens=2200)
    if not raw_response:
        return None

    payload = _extract_json_object(raw_response)
    if payload is None:
        return None

    try:
        response = DatasetFitAnalysisResponse(**payload)
    except Exception as exc:
        logger.warning("LLM dataset fit response failed validation: %s", exc)
        return None

    valid_ids = {item.dataset.dataset_id for item in evidence}
    response.datasets = [item for item in response.datasets if item.dataset_id in valid_ids]
    response.recommended_dataset_ids = [dataset_id for dataset_id in response.recommended_dataset_ids if dataset_id in valid_ids]
    if not response.datasets:
        return None
    return response


def _evidence_for_prompt(evidence: DatasetEvidence) -> Dict[str, Any]:
    dataset = evidence.dataset
    rows = evidence.preview.get("rows") or []
    return {
        "dataset_id": dataset.dataset_id,
        "title": dataset.title_en or dataset.title,
        "title_original": dataset.title_original or dataset.title,
        "provider": dataset.provider,
        "description": dataset.description[:500],
        "themes": dataset.themes,
        "category": dataset.primary_category,
        "quality": {
            "completeness": dataset.quality.completeness,
            "timeliness": dataset.quality.timeliness,
            "consistency": dataset.quality.consistency,
            "documentation": dataset.quality.documentation,
        },
        "columns": [
            column.dict()
            for column in evidence.column_insights[:MAX_PROMPT_COLUMNS]
        ],
        "sample_rows": [
            _trim_row(row)
            for row in rows[:MAX_PROMPT_ROWS]
            if isinstance(row, dict)
        ],
        "preview_message": evidence.preview.get("message"),
    }


def _trim_row(row: Dict[str, Any]) -> Dict[str, Any]:
    trimmed: Dict[str, Any] = {}
    for index, (key, value) in enumerate(row.items()):
        if index >= 8:
            break
        trimmed[str(key)] = str(value)[:120]
    return trimmed


def _extract_json_object(raw_response: str) -> Optional[Dict[str, Any]]:
    """Extract a JSON object from plain or fenced LLM output."""
    cleaned = raw_response.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned, flags=re.IGNORECASE).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        payload = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError as exc:
        logger.warning("Unable to parse LLM dataset fit JSON: %s", exc)
        return None
    return payload if isinstance(payload, dict) else None


def _column_names_for_roles(columns: Sequence[DatasetFitColumnInsight], roles: Set[str]) -> List[str]:
    return _dedupe([column.name for column in columns if column.semantic_role in roles])


def _format_role_list(roles: Sequence[str]) -> str:
    labels = [ROLE_LABELS.get(role, role.replace("_", " ")) for role in roles]
    if not labels:
        return "relevant fields"
    if len(labels) == 1:
        return labels[0]
    return ", ".join(labels[:-1]) + f", and {labels[-1]}"


def _detect_roles(text: str) -> Set[str]:
    return {role for role, score in _detect_role_scores(text).items() if score >= 0.5}


def _detect_role_scores(text: str) -> Dict[str, float]:
    """Return coarse keyword-confidence scores for each semantic role."""
    normalized = _normalize_text(text)
    scores: Dict[str, float] = {}
    if not normalized:
        return scores

    for role, keywords in ROLE_KEYWORDS.items():
        hits = 0
        for keyword in keywords:
            normalized_keyword = _normalize_text(keyword)
            if not normalized_keyword:
                continue
            if _keyword_in_text(normalized_keyword, normalized):
                hits += 1
        if hits:
            scores[role] = min(0.95, 0.5 + (hits * 0.15))

    return scores


def _keyword_in_text(keyword: str, text: str) -> bool:
    if len(keyword) <= 3:
        return bool(re.search(rf"\b{re.escape(keyword)}\b", text))
    return keyword in text


def _normalize_theme_id(theme_id: str) -> str:
    return _normalize_text(theme_id).replace("-", "_").replace(" ", "_")


def _normalize_text(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value or "")
    ascii_text = "".join(char for char in decomposed if not unicodedata.combining(char))
    normalized = re.sub(r"[_\-]+", " ", ascii_text.lower())
    return re.sub(r"\s+", " ", normalized).strip()


def _dedupe(items: Iterable[str]) -> List[str]:
    deduped: List[str] = []
    seen = set()
    for item in items:
        value = str(item).strip()
        if not value or value in seen:
            continue
        seen.add(value)
        deduped.append(value)
    return deduped
