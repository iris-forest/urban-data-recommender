#!/usr/bin/env python
"""Endpoint contract smoke tests for the integrated planner API.

Run from the backend directory:
    ../.venv/bin/python scripts/test_contract.py
"""
from __future__ import annotations

import json
import zipfile
from io import BytesIO
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

import app.catalog as catalog_module
import app.storage as storage
from app.agent import extract_themes_with_confidence, identify_risks_node, score_recommendations_node
from app.api_mappers import dataset_to_item
from app.api_adapters import CatalogPage, MadridCKANAdapter
from app.catalog_translation import ensure_record_translations
from app.api import app
from app.catalog import IMPORTED_API_DATASETS
from app.config import Config
from app.domain.recommendations import candidate_from_dataset, score_candidate_recommendations
from app.full_catalog_import import FULL_IMPORT_MANAGER, FullCatalogImportManager
from app.models import Dataset, DatasetQuality
from app.storage import read_mapping, write_mapping
from app.theme_mappings import map_datos_gob_theme_label, map_madrid_org_label
from app.themes import load_theme_glossary


client = TestClient(app)


def _fake_imported_dataset() -> Dataset:
    return Dataset(
        dataset_id="test_imported_bus_access",
        title="Imported Bus Accessibility Stops",
        provider="Contract Test Source",
        themes=["transport_networks", "accessibility_proximity"],
        spatial_coverage="Madrid city",
        spatial_resolution="stop",
        update_frequency="weekly",
        last_updated="2026-05-01",
        access_type="open",
        formats=["CSV"],
        quality=DatasetQuality(
            completeness=0.91,
            timeliness=0.9,
            consistency=0.86,
            documentation=0.82,
        ),
        description="Imported stop locations for bus accessibility analysis.",
        sample_preview=[
            {"stop_id": "28079-001", "stop_name": "Goya", "district": "Salamanca"},
            {"stop_id": "28079-002", "stop_name": "Sol", "district": "Centro"},
        ],
        schema_fields=[
            {"name": "stop_id", "inferred_type": "text", "description": "Stop identifier"},
            {"name": "stop_name", "inferred_type": "text", "description": "Stop name"},
            {"name": "district", "inferred_type": "text", "description": "Madrid district"},
        ],
        preview_resources=[
            {
                "id": "resource-1",
                "name": "Stops CSV",
                "format": "CSV",
                "url": "https://example.test/stops.csv",
                "schema_fields": [
                    {"name": "stop_id", "inferred_type": "text", "description": "Stop identifier"},
                    {"name": "stop_name", "inferred_type": "text", "description": "Stop name"},
                    {"name": "district", "inferred_type": "text", "description": "Madrid district"},
                ],
            }
        ],
        primary_category="Transport",
        categories=[{"Transport": 1.0}],
        category_confidence=1.0,
        category_method="test",
        source="madrid_ckan",
        api_url="https://example.test/bus-access",
    )


def _fake_theme_dataset(theme_id: str, keyword: str) -> Dataset:
    return Dataset(
        dataset_id=f"mislabelled_{theme_id}",
        title=f"{keyword.title()} coverage dataset",
        provider="Contract Test Source",
        themes=["unrelated_theme"],
        spatial_coverage="Madrid city",
        spatial_resolution="district",
        update_frequency="monthly",
        last_updated="2026-05-01",
        access_type="open",
        formats=["CSV"],
        quality=DatasetQuality(
            completeness=0.9,
            timeliness=0.86,
            consistency=0.84,
            documentation=0.8,
        ),
        description=f"Coverage table for Madrid district indicators involving {keyword}.",
        primary_category="Other",
        categories=[{"Other": 0.2}],
        category_confidence=0.2,
        category_method="test",
        source="contract_test",
        api_url="https://example.test/theme-dataset",
    )


def _fake_fit_analysis_dataset() -> Dataset:
    return Dataset(
        dataset_id="test_green_space_residents",
        title="Green Space Area and Residents by District",
        provider="Contract Test Source",
        themes=["green_space", "population"],
        spatial_coverage="Madrid city",
        spatial_resolution="district",
        update_frequency="monthly",
        last_updated="2026-05-01",
        access_type="open",
        formats=["CSV"],
        quality=DatasetQuality(
            completeness=0.94,
            timeliness=0.9,
            consistency=0.88,
            documentation=0.82,
        ),
        description="District-level green space area and resident population counts.",
        sample_preview=[
            {
                "district": "Centro",
                "green_area_m2": 50200,
                "residents": 140000,
                "date": "2026-04-01",
            },
            {
                "district": "Retiro",
                "green_area_m2": 89000,
                "residents": 118000,
                "date": "2026-04-01",
            },
        ],
        schema_fields=[
            {"name": "district", "inferred_type": "text", "description": "Madrid district"},
            {"name": "green_area_m2", "inferred_type": "number", "description": "Green space area in square meters"},
            {"name": "residents", "inferred_type": "integer", "description": "Resident population"},
            {"name": "date", "inferred_type": "date", "description": "Observation date"},
        ],
        primary_category="Environment",
        categories=[{"Environment": 0.8}, {"Population": 0.2}],
        category_confidence=0.8,
        category_method="test",
        source="contract_test",
        api_url="https://example.test/green-space-residents",
    )


def test_datasets_contract() -> None:
    IMPORTED_API_DATASETS.clear()
    IMPORTED_API_DATASETS.append(_fake_imported_dataset())

    response = client.get("/datasets?include_apis=true")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total_count"] >= 1

    item = next(
        dataset
        for dataset in payload["datasets"]
        if dataset["dataset_id"] == "test_imported_bus_access"
    )
    required = {
        "dataset_id",
        "title",
        "provider",
        "themes",
        "quality",
        "primary_category",
        "source",
    }
    assert required.issubset(item), item
    assert isinstance(item["quality"]["completeness"], float)
    assert item["preview_available"] is True
    assert item["schema_fields"][0]["name"] == "stop_id"


def test_catalog_translation_fields_keep_both_languages() -> None:
    record = ensure_record_translations(
        {
            "title": "Calidad del aire. Estaciones de control",
            "description": "Información sobre calidad del aire por distrito.",
        }
    )
    assert record["title_original"] == "Calidad del aire. Estaciones de control"
    assert "Air quality" in record["title_en"]
    assert "Stations" in record["title_en"]
    assert record["description_original"] == "Información sobre calidad del aire por distrito."
    assert "Air quality" in record["description_en"]


def test_analyze_contract() -> None:
    response = client.post(
        "/analyze",
        json={
            "indicator_text": "Share of residents within five minutes walking distance from a bus stop in Madrid neighborhoods",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["parsed_indicator"]["geographic_level"] == "Madrid city (neighbourhood level)"
    assert payload["parsed_indicator"]["population"] == "Residents"
    assert "transport_networks" in payload["extracted_themes"]
    assert "accessibility_proximity" in payload["extracted_themes"]
    assert isinstance(payload["theme_confidence"]["transport_networks"], float)


def test_analyze_contract_for_rolling_time_window() -> None:
    response = client.post(
        "/analyze",
        json={
            "indicator_text": (
                "Average walking distance for older adults with access to metro or commuter rail stations "
                "within 800 meters by census tract, for the last 12 months."
            ),
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["parsed_indicator"]["geographic_level"] == "Madrid city (census tract level)"
    assert payload["parsed_indicator"]["time_frame"] == "Last 12 months"
    assert payload["parsed_indicator"]["population"] == "Older adults"
    assert "transport_networks" in payload["extracted_themes"]
    assert "accessibility_proximity" in payload["extracted_themes"]


def test_analyze_contract_for_explicit_year() -> None:
    response = client.post(
        "/analyze",
        json={
            "indicator_text": "Number of schools near parks by district in 2024.",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["parsed_indicator"]["time_frame"] == "2024"
    assert payload["parsed_indicator"]["geographic_level"] == "Madrid city (district level)"
    assert "education" in payload["extracted_themes"]
    assert "green_space" in payload["extracted_themes"]


def test_dataset_item_preview_availability_mapping() -> None:
    dataset = _fake_imported_dataset()
    assert dataset_to_item(dataset).preview_available is True

    dataset = _fake_imported_dataset()
    dataset.schema_fields = []
    assert dataset_to_item(dataset).preview_available is True

    dataset = _fake_imported_dataset()
    dataset.schema_fields = []
    dataset.preview_resources = []
    assert dataset_to_item(dataset).preview_available is True

    dataset = _fake_imported_dataset()
    dataset.schema_fields = []
    dataset.preview_resources = []
    dataset.sample_preview = []
    assert dataset_to_item(dataset).preview_available is False


def test_recommend_contract_and_imported_dataset_participation() -> None:
    IMPORTED_API_DATASETS.clear()
    IMPORTED_API_DATASETS.append(_fake_imported_dataset())

    response = client.post(
        "/recommend",
        json={
            "indicator_text": "Share of residents within five minutes of bus stops in Madrid neighborhoods",
            "extracted_themes": ["transport_networks", "accessibility_proximity"],
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert "recommendations" in payload
    assert "data_gaps" in payload
    assert "quality_risks" in payload

    imported = [
        item
        for item in payload["recommendations"]
        if item["dataset_id"] == "test_imported_bus_access"
    ]
    assert imported, json.dumps(payload["recommendations"], indent=2)
    assert imported[0]["primary_category"] == "Transport"
    assert imported[0]["is_essential"] in {True, False}


def test_package_contract_for_imported_ids() -> None:
    IMPORTED_API_DATASETS.clear()
    IMPORTED_API_DATASETS.append(_fake_imported_dataset())

    response = client.post(
        "/package/create",
        json={"dataset_ids": ["test_imported_bus_access"]},
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"

    with zipfile.ZipFile(BytesIO(response.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["dataset_count"] == 1
        categories = {item["dataset_id"]: item["category"] for item in manifest["datasets"]}
        assert categories["test_imported_bus_access"] == "Transport"
        assert manifest["datasets"][0]["columns"][0]["name"] == "stop_id"

    manifest_response = client.post(
        "/package/manifest",
        json={"dataset_ids": ["test_imported_bus_access"]},
    )
    assert manifest_response.status_code == 200, manifest_response.text
    assert manifest_response.json() == manifest


def test_dataset_preview_contract() -> None:
    IMPORTED_API_DATASETS.clear()
    IMPORTED_API_DATASETS.append(_fake_imported_dataset())

    response = client.get("/datasets/test_imported_bus_access/preview?rows=1")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["dataset_id"] == "test_imported_bus_access"
    assert payload["columns"][0]["name"] == "stop_id"
    assert payload["rows"] == [{"stop_id": "28079-001", "stop_name": "Goya", "district": "Salamanca"}]
    assert payload["message"] is None


def test_dataset_fit_analysis_contract_heuristic() -> None:
    IMPORTED_API_DATASETS.clear()
    IMPORTED_API_DATASETS.append(_fake_fit_analysis_dataset())

    original_llm_config = (
        Config.ENABLE_LLM_INSIGHTS,
        Config.LLM_PROVIDER,
        Config.LLM_API_KEY,
    )
    Config.ENABLE_LLM_INSIGHTS = False
    Config.LLM_PROVIDER = "none"
    Config.LLM_API_KEY = ""

    try:
        response = client.post(
            "/datasets/analyze-fit",
            json={
                "indicator_text": (
                    "Green space area per resident within low-emission zones by district, "
                    "for the last 12 months."
                ),
                "selected_themes": ["green_space", "population", "air_quality"],
                "dataset_ids": ["test_green_space_residents"],
                "parsed_indicator": {
                    "geographic_level": "Madrid district",
                    "time_frame": "Last 12 months",
                    "population": "Residents",
                    "attributes": ["green space area", "low-emission zones"],
                },
                "preview_rows": 2,
            },
        )
    finally:
        (
            Config.ENABLE_LLM_INSIGHTS,
            Config.LLM_PROVIDER,
            Config.LLM_API_KEY,
        ) = original_llm_config

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["insight_source"] == "heuristic"
    assert payload["recommended_dataset_ids"] == ["test_green_space_residents"]
    assert payload["datasets"][0]["fit_score"] >= 80
    assert not payload["datasets"][0]["fit_summary"].startswith("Green Space Area")
    assert not payload["datasets"][0]["fit_summary"].startswith(payload["datasets"][0]["recommended_role"])
    assert payload["datasets"][0]["formats"] == ["CSV"]
    assert payload["datasets"][0]["source_url"] == "https://example.test/green-space-residents"
    roles = {column["semantic_role"] for column in payload["datasets"][0]["useful_columns"]}
    assert {"green_space", "population", "geography", "time"}.issubset(roles)
    limitations = payload["datasets"][0]["limitations"]
    assert not any("missing indicator requirements" in item.lower() for item in limitations)
    assert any("air quality" in item.lower() or "low-emission" in item.lower() for item in limitations)
    gaps = payload["cross_dataset_summary"]["gaps"]
    assert any("air quality" in gap.lower() for gap in gaps)
    assert not any("access" in gap.lower() or "land use" in gap.lower() for gap in gaps)
    summary = payload["cross_dataset_summary"]["summary"]
    assert summary.startswith("Detected requirements:")
    assert "green space" in summary.lower()
    assert "population" in summary.lower()
    join_strategy = payload["cross_dataset_summary"]["join_strategy"]
    assert not any("(" in item and ":" in item for item in join_strategy)
    assert not any(item.lower().startswith("align records") for item in join_strategy)


def test_dataset_fit_analysis_uses_snapshot_when_catalog_missing() -> None:
    IMPORTED_API_DATASETS.clear()

    response = client.post(
        "/datasets/analyze-fit",
        json={
            "indicator_text": "Population per district for the last 12 months.",
            "selected_themes": ["population"],
            "dataset_ids": ["snapshot_population"],
            "dataset_snapshots": [
                {
                    "id": "snapshot_population",
                    "name": "Selected Resident Counts by District",
                    "provider": "Snapshot Source",
                    "themes": ["population"],
                    "spatialCoverage": "Madrid",
                    "spatialResolution": "district",
                    "updateFrequency": "monthly",
                    "lastUpdate": "01-05-2026",
                    "accessType": "open",
                    "category": "Population",
                    "quality": {
                        "completeness": 92,
                        "timeliness": "recent",
                        "consistency": "high",
                        "documentation": "good",
                    },
                    "description": "Resident counts by district.",
                    "schemaFields": [
                        {"name": "district", "inferred_type": "text", "description": "Madrid district"},
                        {"name": "residents", "inferred_type": "integer", "description": "Resident count"},
                    ],
                }
            ],
            "parsed_indicator": {
                "geographic_level": "Madrid district",
                "time_frame": "Last 12 months",
                "population": "Residents",
                "attributes": [],
            },
            "preview_rows": 2,
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["datasets"][0]["dataset_id"] == "snapshot_population"
    assert payload["datasets"][0]["fit_score"] >= 60
    assert any("snapshot" in warning.lower() for warning in payload["warnings"])


def test_dataset_fit_analysis_counts_water_management_coverage() -> None:
    IMPORTED_API_DATASETS.clear()

    original_llm_config = (
        Config.ENABLE_LLM_INSIGHTS,
        Config.LLM_PROVIDER,
        Config.LLM_API_KEY,
    )
    Config.ENABLE_LLM_INSIGHTS = False
    Config.LLM_PROVIDER = "none"
    Config.LLM_API_KEY = ""

    try:
        response = client.post(
            "/datasets/analyze-fit",
            json={
                "indicator_text": "Water management and drainage capacity by district.",
                "selected_themes": ["water_management"],
                "dataset_ids": ["snapshot_water_management"],
                "dataset_snapshots": [
                    {
                        "id": "snapshot_water_management",
                        "name": "Drainage and Wastewater Capacity by District",
                        "provider": "Snapshot Source",
                        "themes": ["water_management"],
                        "spatialCoverage": "Madrid",
                        "spatialResolution": "district",
                        "updateFrequency": "monthly",
                        "lastUpdate": "01-05-2026",
                        "accessType": "open",
                        "category": "Water",
                        "quality": {
                            "completeness": 90,
                            "timeliness": "recent",
                            "consistency": "high",
                            "documentation": "good",
                        },
                        "description": "Water management, drainage, sewer, and wastewater indicators by district.",
                        "schemaFields": [
                            {"name": "district", "inferred_type": "text", "description": "Madrid district"},
                            {"name": "drainage_capacity_m3", "inferred_type": "number", "description": "Drainage capacity"},
                            {"name": "wastewater_volume_m3", "inferred_type": "number", "description": "Wastewater volume"},
                        ],
                    }
                ],
                "parsed_indicator": {
                    "geographic_level": "Madrid district",
                    "time_frame": "Unknown",
                    "population": "Unknown",
                    "attributes": ["drainage capacity"],
                },
                "preview_rows": 2,
            },
        )
    finally:
        (
            Config.ENABLE_LLM_INSIGHTS,
            Config.LLM_PROVIDER,
            Config.LLM_API_KEY,
        ) = original_llm_config

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["insight_source"] == "heuristic"
    assert payload["datasets"][0]["recommended_role"] == "Water management context"
    roles = {column["semantic_role"] for column in payload["datasets"][0]["useful_columns"]}
    assert "water" in roles
    gaps = payload["cross_dataset_summary"]["gaps"]
    assert not any("water management" in gap.lower() for gap in gaps)


def test_unmapped_catalog_records_do_not_default_to_population() -> None:
    page = MadridCKANAdapter.normalize_catalog_payload(
        {
            "success": True,
            "result": {
                "count": 1,
                "results": [
                    {
                        "id": "neutral-record",
                        "title": "Administrative concessions",
                        "name": "administrative-concessions",
                        "notes": "General contract concessions without thematic fields.",
                        "organization": {"title": "General Services"},
                        "resources": [],
                    }
                ],
            },
        },
        rows=1,
    )

    assert page.datasets[0].themes == ["other"]
    assert page.datasets[0].primary_category == "Other"


def _mapped_theme_ids(mapped: list[tuple[str, float]]) -> list[str]:
    return [theme_id for theme_id, _ in mapped]


def test_water_and_green_provider_metadata_maps_to_both_themes() -> None:
    page = MadridCKANAdapter.normalize_catalog_payload(
        {
            "success": True,
            "result": {
                "count": 1,
                "results": [
                    {
                        "id": "green-concessions",
                        "title": "Concesiones demaniales",
                        "name": "concesiones-demaniales",
                        "notes": "Concesiones asociadas a servicios municipales.",
                        "organization": {"title": "Dirección General de Gestión del Agua y Zonas Verdes"},
                        "resources": [],
                    }
                ],
            },
        },
        rows=1,
    )

    dataset = page.datasets[0]
    assert "water_management" in dataset.themes
    assert "green_space" in dataset.themes
    assert dataset.primary_category == "Water"


def test_water_green_category_mapping_handles_accents_and_keeps_sector_publico_unmapped() -> None:
    for mapper in (map_madrid_org_label, map_datos_gob_theme_label):
        for label in ("gestion del agua y zonas verdes", "gestión del agua y zonas verdes"):
            mapped_theme_ids = _mapped_theme_ids(mapper(label))
            assert "water_management" in mapped_theme_ids
            assert "green_space" in mapped_theme_ids

    assert map_datos_gob_theme_label("sector publico") == []
    assert map_madrid_org_label("sector publico") == []


def test_legacy_population_cache_fallback_is_repaired() -> None:
    dataset = storage._dataset_from_cache_record(
        {
            "dataset_id": "cached_green_space",
            "title": "Zonas verdes urbanas",
            "provider": "datos.gob.es",
            "themes": ["population"],
            "spatial_coverage": "Spain",
            "spatial_resolution": "unknown",
            "update_frequency": "unknown",
            "last_updated": "2026-04-14",
            "access_type": "open",
            "formats": ["CSV"],
            "quality": {
                "completeness": 0.75,
                "timeliness": 0.7,
                "consistency": 0.7,
                "documentation": 0.6,
            },
            "description": "Capa informativa que representa las zonas verdes urbanas.",
            "sample_preview": [],
            "schema_fields": [],
            "preview_resources": [],
            "primary_category": "Population",
            "categories": [{"Population": 1.0}],
            "category_confidence": 0.5,
            "category_method": "agent",
            "source": "datos_gob_es",
            "api_url": "https://example.test/zonas-verdes",
        }
    )

    assert dataset.themes == ["green_space"]
    assert dataset.primary_category == "Environment"
    assert dataset.category_method == "cache_repair"


def test_theme_fixture_contract() -> None:
    fixture_path = Path(__file__).resolve().parents[1] / "app" / "schemas" / "indicator_theme_fixtures.json"
    fixtures = json.loads(fixture_path.read_text(encoding="utf-8"))
    assert fixtures

    for fixture in fixtures:
        confidence, _ = extract_themes_with_confidence(fixture["indicator_text"])
        extracted = set(confidence)
        expected = set(fixture["expected_themes"])
        assert expected.issubset(extracted), {
            "indicator_text": fixture["indicator_text"],
            "expected": sorted(expected),
            "extracted": sorted(extracted),
        }


def test_theme_inference_recovers_mislabelled_catalog_records() -> None:
    for theme_id, keywords in load_theme_glossary().items():
        keyword = next(keyword for keyword in keywords if len(keyword) >= 4)
        candidate = candidate_from_dataset(
            _fake_theme_dataset(theme_id, keyword),
            extracted_themes={theme_id},
        )
        assert candidate is not None, theme_id
        assert theme_id in candidate["matching_themes"], candidate
        assert theme_id in candidate["themes"], candidate


def test_scoring_promotes_coverage_for_multi_theme_indicators() -> None:
    candidates = [
        {
            "dataset_id": "air_quality_context",
            "title": "Air Quality Context",
            "matching_themes": ["air_quality"],
            "quality": {"completeness": 0.8, "timeliness": 0.75, "consistency": 0.7, "documentation": 0.65},
            "search_rank": 5,
        },
        {
            "dataset_id": "green_space_surface",
            "title": "Green Space Surface",
            "matching_themes": ["green_space"],
            "quality": {"completeness": 0.8, "timeliness": 0.75, "consistency": 0.7, "documentation": 0.65},
            "search_rank": 0,
        },
    ]

    scored = score_candidate_recommendations(
        candidates=candidates,
        theme_confidence={"air_quality": 1.0, "green_space": 0.55},
        extracted_themes=["air_quality", "green_space"],
    )

    first_two_themes = {
        theme
        for recommendation in scored[:2]
        for theme in recommendation["matching_themes"]
    }
    assert first_two_themes == {"air_quality", "green_space"}
    assert scored[0]["dataset_id"] == "green_space_surface"


def test_selected_theme_representatives_are_essential() -> None:
    candidates = [
        {
            "dataset_id": "air_quality_context",
            "title": "Air Quality Context",
            "matching_themes": ["air_quality"],
            "quality": {"completeness": 0.76, "timeliness": 0.72, "consistency": 0.7, "documentation": 0.68},
            "search_rank": 0,
        },
        {
            "dataset_id": "green_space_surface",
            "title": "Green Space Surface",
            "matching_themes": ["green_space"],
            "quality": {"completeness": 0.76, "timeliness": 0.72, "consistency": 0.7, "documentation": 0.68},
            "search_rank": 1,
        },
    ]

    scored = score_candidate_recommendations(
        candidates=candidates,
        theme_confidence={"air_quality": 1.0, "green_space": 1.0},
        extracted_themes=["air_quality", "green_space"],
    )

    essentials_by_theme = {
        theme
        for recommendation in scored
        if recommendation["is_essential"]
        for theme in recommendation["matching_themes"]
    }
    assert essentials_by_theme == {"air_quality", "green_space"}


def test_theme_coverage_prefers_madrid_representatives() -> None:
    candidates = [
        {
            "dataset_id": "spain_air_green_context",
            "title": "Spain Air And Green Context",
            "matching_themes": ["air_quality", "green_space"],
            "quality": {"completeness": 0.9, "timeliness": 0.9, "consistency": 0.9, "documentation": 0.9},
            "spatial_coverage": "Spain",
            "source": "datos_gob_es",
            "search_rank": 0,
        },
        {
            "dataset_id": "madrid_air_quality",
            "title": "Madrid Air Quality Stations",
            "matching_themes": ["air_quality"],
            "quality": {"completeness": 0.8, "timeliness": 0.75, "consistency": 0.7, "documentation": 0.65},
            "spatial_coverage": "Madrid city",
            "source": "madrid_ckan",
            "search_rank": 1,
        },
        {
            "dataset_id": "madrid_green_space",
            "title": "Madrid Green Space Surface",
            "matching_themes": ["green_space"],
            "quality": {"completeness": 0.8, "timeliness": 0.75, "consistency": 0.7, "documentation": 0.65},
            "spatial_coverage": "Madrid city",
            "source": "madrid_ckan",
            "search_rank": 2,
        },
    ]

    scored = score_candidate_recommendations(
        candidates=candidates,
        theme_confidence={"air_quality": 1.0, "green_space": 0.55},
        extracted_themes=["air_quality", "green_space"],
    )
    first_two_ids = [recommendation["dataset_id"] for recommendation in scored[:2]]
    assert first_two_ids == ["madrid_air_quality", "madrid_green_space"]


def test_scoring_thresholds_and_risk_signals() -> None:
    state = {
        "candidate_datasets": [
            {
                "dataset_id": "strong_transport_access",
                "title": "Strong Transport Access",
                "matching_themes": ["transport_networks", "accessibility_proximity"],
                "quality": {"completeness": 0.92, "timeliness": 0.9, "consistency": 0.88, "documentation": 0.86},
            },
            {
                "dataset_id": "weak_transport_access",
                "title": "Weak Transport Access",
                "matching_themes": ["transport_networks", "accessibility_proximity"],
                "quality": {"completeness": 0.55, "timeliness": 0.5, "consistency": 0.5, "documentation": 0.45},
            },
        ],
        "theme_confidence": {"transport_networks": 1.0, "accessibility_proximity": 0.9},
        "extracted_themes": ["transport_networks", "accessibility_proximity"],
    }

    scored_state = score_recommendations_node(state)
    scored = {item["dataset_id"]: item for item in scored_state["scored_recommendations"]}
    assert scored["strong_transport_access"]["is_essential"] is True
    assert scored["weak_transport_access"]["is_essential"] is False

    risk_state = identify_risks_node({"scored_recommendations": [scored["weak_transport_access"]]})
    assert len(risk_state["risks"]) >= 4


def test_clear_import_contract() -> None:
    original_mapping = read_mapping()
    IMPORTED_API_DATASETS.clear()
    IMPORTED_API_DATASETS.append(_fake_imported_dataset())

    try:
        response = client.delete("/import/madrid-ckan")
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["cleared_count"] == 1
        assert payload["dataset_ids"] == ["test_imported_bus_access"]
        assert IMPORTED_API_DATASETS == []
    finally:
        write_mapping(original_mapping)


def test_full_catalog_cache_storage_contract() -> None:
    with TemporaryDirectory() as tmpdir:
        cache_base = Path(tmpdir) / "cache"
        dataset = _fake_imported_dataset()

        raw_path = storage.write_raw_cache_snapshot(
            "madrid_ckan",
            "page-0001",
            {"success": True, "result": {"count": 1}},
            cache_base_dir=cache_base,
        )
        normalized_path = storage.write_normalized_dataset_cache(
            "madrid_ckan",
            [dataset],
            cache_base_dir=cache_base,
        )
        manifest = storage.update_cache_manifest_source(
            "madrid_ckan",
            {
                "status": "ready",
                "fetched_count": 1,
                "normalized_count": 1,
                "raw_snapshot_count": 1,
            },
            cache_base_dir=cache_base,
        )

        assert raw_path == cache_base / "raw" / "madrid_ckan" / "page-0001.json"
        assert normalized_path == cache_base / "normalized" / "madrid_ckan.jsonl"
        assert storage.get_cache_manifest_path(cache_base) == cache_base / "manifest.json"
        assert manifest["sources"]["madrid_ckan"]["normalized_count"] == 1

        cached = storage.read_normalized_dataset_cache("madrid_ckan", cache_base_dir=cache_base)
        assert len(cached) == 1
        assert cached[0].dataset_id == dataset.dataset_id
        assert cached[0].quality.completeness == dataset.quality.completeness


def test_orphaned_full_import_manifest_is_retryable() -> None:
    with TemporaryDirectory() as tmpdir:
        cache_base = Path(tmpdir) / "cache"
        storage.update_cache_manifest_source(
            "madrid_ckan",
            {
                "status": "running",
                "fetched_count": 0,
                "normalized_count": 0,
                "raw_snapshot_count": 0,
                "started_at": "2026-05-10T12:00:00",
            },
            cache_base_dir=cache_base,
        )

        manager = FullCatalogImportManager(cache_base_dir=cache_base)
        progress = manager.get_progress("madrid_ckan")
        manifest = storage.read_cache_manifest(cache_base)

        assert progress.status == "failed"
        assert "interrupted" in (progress.last_error or "")
        assert manifest["sources"]["madrid_ckan"]["status"] == "failed"


def test_existing_local_catalog_file_marks_source_available() -> None:
    with TemporaryDirectory() as tmpdir:
        cache_base = Path(tmpdir) / "cache"
        dataset = _fake_imported_dataset()
        storage.write_normalized_dataset_cache("madrid_ckan", [dataset], cache_base_dir=cache_base)
        storage.update_cache_manifest_source(
            "madrid_ckan",
            {
                "status": "running",
                "fetched_count": 0,
                "normalized_count": 0,
                "raw_snapshot_count": 0,
                "started_at": "2026-05-10T12:00:00",
            },
            cache_base_dir=cache_base,
        )

        manager = FullCatalogImportManager(cache_base_dir=cache_base)
        progress = manager.get_progress("madrid_ckan")

        assert progress.status == "completed"
        assert progress.normalized_count == 1
        assert progress.cache_updated_at is not None
        assert progress.finished_at == progress.cache_updated_at


def test_full_catalog_import_endpoint_and_cache_search() -> None:
    with TemporaryDirectory() as tmpdir:
        cache_base = Path(tmpdir) / "cache"
        dataset = _fake_imported_dataset()
        original_cache_base = FULL_IMPORT_MANAGER.cache_base_dir
        original_progress = dict(FULL_IMPORT_MANAGER._progress)
        original_iter = MadridCKANAdapter.__dict__["iter_all_dataset_pages"]
        original_catalog_reader = catalog_module.read_normalized_dataset_cache

        def fake_iter_all_dataset_pages(cls, rows: int = 100, query: str | None = None):
            yield CatalogPage(
                source="madrid_ckan",
                page_index=0,
                offset=0,
                raw_payload={"success": True, "result": {"count": 1, "results": [{"id": "fake"}]}},
                datasets=[dataset],
                fetched_count=1,
                total_count=1,
                snapshot_name="offset-000000",
            )

        try:
            FULL_IMPORT_MANAGER.cache_base_dir = cache_base
            FULL_IMPORT_MANAGER._progress.clear()
            MadridCKANAdapter.iter_all_dataset_pages = classmethod(fake_iter_all_dataset_pages)
            catalog_module.read_normalized_dataset_cache = (
                lambda source=None: storage.read_normalized_dataset_cache(source, cache_base_dir=cache_base)
            )

            response = client.post("/import/madrid-ckan/full")
            assert response.status_code == 200, response.text

            progress_response = client.get("/import/madrid-ckan/full/progress")
            assert progress_response.status_code == 200, progress_response.text
            progress_payload = progress_response.json()
            if progress_payload["status"] != "completed":
                FULL_IMPORT_MANAGER.run("madrid_ckan")
                progress_payload = client.get("/import/madrid-ckan/full/progress").json()

            assert progress_payload["status"] == "completed"
            assert progress_payload["fetched_count"] == 1
            assert progress_payload["normalized_count"] == 1
            assert progress_payload["raw_snapshot_count"] == 1

            matches = catalog_module.search_relevant_datasets(
                indicator_text="Bus stop accessibility in Madrid neighborhoods",
                extracted_themes=["transport_networks", "accessibility_proximity"],
                limit=5,
            )
            assert [match.dataset_id for match in matches] == [dataset.dataset_id]

            rebuild_response = client.post("/import/madrid-ckan/full/rebuild")
            assert rebuild_response.status_code == 200, rebuild_response.text
            rebuild_payload = client.get("/import/madrid-ckan/full/progress").json()
            if rebuild_payload["status"] != "completed":
                FULL_IMPORT_MANAGER.rebuild_from_raw("madrid_ckan")
                rebuild_payload = client.get("/import/madrid-ckan/full/progress").json()

            assert rebuild_payload["status"] == "completed"
            assert rebuild_payload["normalized_count"] == 1
            assert rebuild_payload["raw_snapshot_count"] == 1
        finally:
            FULL_IMPORT_MANAGER.cache_base_dir = original_cache_base
            FULL_IMPORT_MANAGER._progress.clear()
            FULL_IMPORT_MANAGER._progress.update(original_progress)
            MadridCKANAdapter.iter_all_dataset_pages = original_iter
            catalog_module.read_normalized_dataset_cache = original_catalog_reader


if __name__ == "__main__":
    test_datasets_contract()
    test_catalog_translation_fields_keep_both_languages()
    test_analyze_contract()
    test_analyze_contract_for_rolling_time_window()
    test_dataset_item_preview_availability_mapping()
    test_recommend_contract_and_imported_dataset_participation()
    test_package_contract_for_imported_ids()
    test_dataset_preview_contract()
    test_dataset_fit_analysis_contract_heuristic()
    test_dataset_fit_analysis_uses_snapshot_when_catalog_missing()
    test_dataset_fit_analysis_counts_water_management_coverage()
    test_unmapped_catalog_records_do_not_default_to_population()
    test_water_and_green_provider_metadata_maps_to_both_themes()
    test_water_green_category_mapping_handles_accents_and_keeps_sector_publico_unmapped()
    test_legacy_population_cache_fallback_is_repaired()
    test_theme_fixture_contract()
    test_theme_inference_recovers_mislabelled_catalog_records()
    test_scoring_promotes_coverage_for_multi_theme_indicators()
    test_selected_theme_representatives_are_essential()
    test_theme_coverage_prefers_madrid_representatives()
    test_scoring_thresholds_and_risk_signals()
    test_clear_import_contract()
    test_full_catalog_cache_storage_contract()
    test_orphaned_full_import_manifest_is_retryable()
    test_existing_local_catalog_file_marks_source_available()
    test_full_catalog_import_endpoint_and_cache_search()
    print("Contract smoke tests passed.")
