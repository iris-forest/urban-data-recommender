"""Storage layer for managing imported datasets and source-to-datasets mappings.

Handles:
- Reading/writing datasets_mapping.json (source → dataset IDs)
- Writing per-dataset metadata CSVs
- Directory structure: backend/imports/{timestamp}/{source}/{dataset_id}.csv
"""

import json
import csv
import logging
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime
from .catalog_translation import ensure_dataset_translations
from .models import Dataset, DatasetQuality
from .theme_mappings import infer_categories_from_themes, infer_primary_category_from_themes
from .themes import _normalize_text, extract_themes

logger = logging.getLogger(__name__)

# Base directory for imports
IMPORTS_BASE_DIR = Path(__file__).parent.parent.parent / "imports"
MAPPING_FILE = IMPORTS_BASE_DIR / "datasets_mapping.json"

# Base directory for full-catalog cache output. The cache is intentionally
# under backend/data so it stays repo-local and covered by existing gitignore
# runtime-output rules.
CACHE_BASE_DIR = Path(__file__).resolve().parent.parent / "data" / "cache"
RAW_CACHE_DIR = CACHE_BASE_DIR / "raw"
NORMALIZED_CACHE_DIR = CACHE_BASE_DIR / "normalized"
CACHE_MANIFEST_FILE = CACHE_BASE_DIR / "manifest.json"
LEGACY_FALLBACK_REPAIR_HINTS = (
    "accesibilidad",
    "air quality",
    "arbolado",
    "autobus",
    "bicicleta",
    "calidad del aire",
    "catastro",
    "emision",
    "green",
    "jardin",
    "metro",
    "parque",
    "transporte",
    "urbanismo",
    "vegetacion",
    "vivienda",
    "zona verde",
    "zonas verdes",
)
LEGACY_POPULATION_EVIDENCE_HINTS = (
    "censo",
    "demograf",
    "habitante",
    "hogar",
    "household",
    "inhabitant",
    "padron",
    "padrón",
    "poblacion",
    "población",
    "population",
    "resident",
)

_NORMALIZED_DATASET_CACHE: Dict[Tuple[Tuple[str, int, int], ...], List[Dataset]] = {}


def _safe_cache_component(value: str) -> str:
    """Validate a cache path component such as source or snapshot name."""
    if not value or value in {".", ".."} or "/" in value or "\\" in value:
        raise ValueError(f"Invalid cache path component: {value!r}")
    return value


def _cache_base(cache_base_dir: Optional[Path] = None) -> Path:
    return Path(cache_base_dir) if cache_base_dir is not None else CACHE_BASE_DIR


def get_cache_manifest_path(cache_base_dir: Optional[Path] = None) -> Path:
    """Return the full-catalog cache manifest path."""
    return _cache_base(cache_base_dir) / "manifest.json"


def get_raw_cache_dir(source: str, cache_base_dir: Optional[Path] = None) -> Path:
    """Return the raw snapshot cache directory for a source."""
    return _cache_base(cache_base_dir) / "raw" / _safe_cache_component(source)


def get_raw_cache_snapshot_path(
    source: str,
    snapshot_name: str,
    cache_base_dir: Optional[Path] = None,
) -> Path:
    """Return the raw JSON snapshot path for a source page or batch."""
    safe_name = _safe_cache_component(snapshot_name)
    if not safe_name.endswith(".json"):
        safe_name = f"{safe_name}.json"
    return get_raw_cache_dir(source, cache_base_dir) / safe_name


def get_normalized_cache_path(source: str, cache_base_dir: Optional[Path] = None) -> Path:
    """Return the normalized Dataset JSONL path for a source."""
    return _cache_base(cache_base_dir) / "normalized" / f"{_safe_cache_component(source)}.jsonl"


def ensure_cache_dir(source: Optional[str] = None, cache_base_dir: Optional[Path] = None) -> Path:
    """Ensure the full-catalog cache directory structure exists."""
    base_dir = _cache_base(cache_base_dir)
    (base_dir / "raw").mkdir(parents=True, exist_ok=True)
    (base_dir / "normalized").mkdir(parents=True, exist_ok=True)
    if source:
        get_raw_cache_dir(source, cache_base_dir).mkdir(parents=True, exist_ok=True)
    return base_dir


def write_raw_cache_snapshot(
    source: str,
    snapshot_name: str,
    payload: Dict[str, Any],
    cache_base_dir: Optional[Path] = None,
) -> Path:
    """Write a raw API payload snapshot for later normalization rebuilds."""
    ensure_cache_dir(source, cache_base_dir)
    snapshot_path = get_raw_cache_snapshot_path(source, snapshot_name, cache_base_dir)
    temp_path = snapshot_path.with_suffix(".tmp")

    try:
        with temp_path.open("w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        temp_path.replace(snapshot_path)
        logger.info("Wrote raw cache snapshot: %s", snapshot_path)
        return snapshot_path
    except Exception as e:
        logger.error("Failed to write raw cache snapshot %s: %s", snapshot_path, e)
        raise


def read_raw_cache_snapshots(
    source: str,
    cache_base_dir: Optional[Path] = None,
) -> List[Tuple[Path, Dict[str, Any]]]:
    """Read raw API payload snapshots for a source in snapshot-name order."""
    raw_dir = get_raw_cache_dir(source, cache_base_dir)
    if not raw_dir.exists():
        return []

    snapshots: List[Tuple[Path, Dict[str, Any]]] = []
    for path in sorted(raw_dir.glob("*.json")):
        try:
            with path.open("r", encoding="utf-8") as f:
                payload = json.load(f)
            if isinstance(payload, dict):
                snapshots.append((path, payload))
        except Exception as e:
            logger.warning("Skipping invalid raw cache snapshot %s: %s", path, e)
    return snapshots


def write_normalized_dataset_cache(
    source: str,
    datasets: List[Dataset],
    cache_base_dir: Optional[Path] = None,
) -> Path:
    """Write normalized Dataset records to source-scoped JSONL."""
    ensure_cache_dir(source, cache_base_dir)
    normalized_path = get_normalized_cache_path(source, cache_base_dir)
    temp_path = normalized_path.with_suffix(".jsonl.tmp")

    try:
        with temp_path.open("w", encoding="utf-8") as f:
            for dataset in datasets:
                ensure_dataset_translations(dataset)
                f.write(json.dumps(asdict(dataset), ensure_ascii=False) + "\n")
        temp_path.replace(normalized_path)
        logger.info("Wrote normalized dataset cache: %s", normalized_path)
        return normalized_path
    except Exception as e:
        logger.error("Failed to write normalized dataset cache %s: %s", normalized_path, e)
        raise


def _dataset_from_cache_record(record: Dict[str, Any]) -> Dataset:
    data = dict(record)
    _repair_legacy_theme_fallback(data)
    quality = data.get("quality", {})
    if isinstance(quality, dict):
        data["quality"] = DatasetQuality(
            completeness=float(quality.get("completeness", 0.0) or 0.0),
            timeliness=float(quality.get("timeliness", 0.0) or 0.0),
            consistency=float(quality.get("consistency", 0.0) or 0.0),
            documentation=float(quality.get("documentation", 0.0) or 0.0),
        )
    return Dataset(**data)


def _repair_legacy_theme_fallback(data: Dict[str, Any]) -> None:
    """Correct old cache records that used population as the default theme."""
    themes = data.get("themes")
    if themes != ["population"]:
        return

    parts: List[str] = [
        str(data.get("title") or ""),
        str(data.get("description") or ""),
        str(data.get("provider") or ""),
        str(data.get("source") or ""),
    ]

    for field in data.get("schema_fields") or []:
        if isinstance(field, dict):
            parts.extend(str(field.get(key) or "") for key in ("name", "title", "description", "label"))

    for resource in data.get("preview_resources") or []:
        if isinstance(resource, dict):
            parts.extend(str(resource.get(key) or "") for key in ("name", "title", "description", "format"))

    text_blob = " ".join(part for part in parts if part)
    normalized_blob = _normalize_text(text_blob)
    if not any(hint in normalized_blob for hint in LEGACY_FALLBACK_REPAIR_HINTS):
        return

    inferred = extract_themes(text_blob, top_n=5)
    if "population" in inferred and not any(hint in normalized_blob for hint in LEGACY_POPULATION_EVIDENCE_HINTS):
        inferred = [theme for theme in inferred if theme != "population"]

    if inferred == ["population"]:
        return

    repaired_themes = inferred or ["other"]
    data["themes"] = repaired_themes
    data["primary_category"] = infer_primary_category_from_themes(repaired_themes)
    data["categories"] = infer_categories_from_themes(repaired_themes)
    data["category_method"] = "cache_repair"
    data["category_confidence"] = 0.7 if inferred else 0.0


def read_normalized_dataset_cache(
    source: Optional[str] = None,
    cache_base_dir: Optional[Path] = None,
) -> List[Dataset]:
    """Read normalized Dataset records from one source or all cached sources."""
    if source:
        paths = [get_normalized_cache_path(source, cache_base_dir)]
    else:
        normalized_dir = _cache_base(cache_base_dir) / "normalized"
        paths = sorted(normalized_dir.glob("*.jsonl")) if normalized_dir.exists() else []

    signature = _normalized_cache_signature(paths)
    cached = _NORMALIZED_DATASET_CACHE.get(signature)
    if cached is not None:
        return list(cached)

    datasets: List[Dataset] = []
    for path in paths:
        if not path.exists():
            continue
        try:
            with path.open("r", encoding="utf-8") as f:
                for line_number, line in enumerate(f, start=1):
                    if not line.strip():
                        continue
                    try:
                        datasets.append(_dataset_from_cache_record(json.loads(line)))
                    except Exception as e:
                        logger.warning("Skipping invalid cache record %s:%s: %s", path, line_number, e)
        except Exception as e:
            logger.error("Failed to read normalized dataset cache %s: %s", path, e)
            raise

    _NORMALIZED_DATASET_CACHE[signature] = list(datasets)
    if len(_NORMALIZED_DATASET_CACHE) > 8:
        for stale_key in list(_NORMALIZED_DATASET_CACHE.keys())[:-8]:
            _NORMALIZED_DATASET_CACHE.pop(stale_key, None)
    return datasets


def _normalized_cache_signature(paths: List[Path]) -> Tuple[Tuple[str, int, int], ...]:
    """Return a cache key that changes when normalized cache files change."""
    signature: List[Tuple[str, int, int]] = []
    for path in paths:
        try:
            stat = path.stat()
        except FileNotFoundError:
            continue
        signature.append((str(path.resolve()), stat.st_mtime_ns, stat.st_size))
    return tuple(signature)


def read_cache_manifest(cache_base_dir: Optional[Path] = None) -> Dict[str, Any]:
    """Read the full-catalog cache manifest, returning an empty schema if absent."""
    manifest_path = get_cache_manifest_path(cache_base_dir)
    if not manifest_path.exists():
        return {"version": 1, "sources": {}}

    try:
        with manifest_path.open("r", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception as e:
        logger.warning("Failed to read cache manifest %s: %s", manifest_path, e)
        return {"version": 1, "sources": {}}

    if not isinstance(payload, dict):
        return {"version": 1, "sources": {}}
    payload.setdefault("version", 1)
    payload.setdefault("sources", {})
    return payload


def write_cache_manifest(
    manifest: Dict[str, Any],
    cache_base_dir: Optional[Path] = None,
) -> Path:
    """Write the full-catalog cache manifest atomically."""
    ensure_cache_dir(cache_base_dir=cache_base_dir)
    manifest_path = get_cache_manifest_path(cache_base_dir)
    temp_path = manifest_path.with_suffix(".tmp")

    try:
        with temp_path.open("w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
        temp_path.replace(manifest_path)
        logger.info("Wrote cache manifest: %s", manifest_path)
        return manifest_path
    except Exception as e:
        logger.error("Failed to write cache manifest %s: %s", manifest_path, e)
        raise


def update_cache_manifest_source(
    source: str,
    metadata: Dict[str, Any],
    cache_base_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """Merge source metadata into the cache manifest and persist it."""
    safe_source = _safe_cache_component(source)
    manifest = read_cache_manifest(cache_base_dir)
    sources = manifest.setdefault("sources", {})
    source_manifest = dict(sources.get(safe_source, {}))
    source_manifest.update(metadata)
    source_manifest["updated_at"] = datetime.utcnow().isoformat()
    sources[safe_source] = source_manifest
    write_cache_manifest(manifest, cache_base_dir)
    return manifest


def ensure_imports_dir():
    """Ensure the imports directory exists."""
    IMPORTS_BASE_DIR.mkdir(parents=True, exist_ok=True)


def get_mapping_file_path() -> Path:
    """Get path to the global datasets mapping file."""
    return MAPPING_FILE


def read_mapping() -> Dict[str, List[str]]:
    """Read the global datasets mapping file.
    
    Returns:
        Dict with source → [dataset_ids] or empty dict if file doesn't exist.
    """
    ensure_imports_dir()
    if not MAPPING_FILE.exists():
        return {}
    
    try:
        with open(MAPPING_FILE, "r") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to read mapping file: {e}")
        return {}


def write_mapping(mapping: Dict[str, List[str]]):
    """Write the global datasets mapping file (overwrites).
    
    Args:
        mapping: Dict with source → [dataset_ids]
    """
    ensure_imports_dir()
    try:
        # Write to temp file first, then rename (atomic-ish on most filesystems)
        temp_file = MAPPING_FILE.with_suffix(".tmp")
        with open(temp_file, "w") as f:
            json.dump(mapping, f, indent=2)
        temp_file.replace(MAPPING_FILE)
        logger.info(f"Updated mapping file: {MAPPING_FILE}")
    except Exception as e:
        logger.error(f"Failed to write mapping file: {e}")
        raise


def create_import_session_dir() -> Path:
    """Create a timestamped directory for this import session.
    
    Returns:
        Path to the new session directory.
    """
    ensure_imports_dir()
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    session_dir = IMPORTS_BASE_DIR / timestamp
    session_dir.mkdir(parents=True, exist_ok=True)
    return session_dir


def write_dataset_metadata_csv(
    session_dir: Path,
    source: str,
    dataset: Dataset,
) -> Path:
    """Write a single dataset's metadata to CSV.
    
    Args:
        session_dir: Path to the session directory
        source: Source name (madrid_ckan, datos_gob_es, etc.)
        dataset: Dataset object to write
    
    Returns:
        Path to the written CSV file
    """
    # Create source subdirectory
    ensure_dataset_translations(dataset)
    source_dir = session_dir / source
    source_dir.mkdir(parents=True, exist_ok=True)
    
    # Write metadata as CSV
    csv_path = source_dir / f"{dataset.dataset_id}.csv"
    
    try:
        with open(csv_path, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=[
                "dataset_id",
                "title",
                "title_original",
                "title_en",
                "provider",
                "themes",
                "spatial_coverage",
                "spatial_resolution",
                "update_frequency",
                "last_updated",
                "access_type",
                "formats",
                "primary_category",
                "categories",
                "category_confidence",
                "category_method",
                "completeness",
                "timeliness",
                "consistency",
                "documentation",
                "description",
                "description_original",
                "description_en",
                "translation_method",
                "translation_version",
                "source",
                "api_url",
            ])
            writer.writeheader()
            writer.writerow({
                "dataset_id": dataset.dataset_id,
                "title": dataset.title,
                "title_original": dataset.title_original,
                "title_en": dataset.title_en,
                "provider": dataset.provider,
                "themes": json.dumps(dataset.themes),
                "spatial_coverage": dataset.spatial_coverage,
                "spatial_resolution": dataset.spatial_resolution,
                "update_frequency": dataset.update_frequency,
                "last_updated": dataset.last_updated,
                "access_type": dataset.access_type,
                "formats": json.dumps(dataset.formats),
                "primary_category": dataset.primary_category or "Uncategorized",
                "categories": json.dumps(dataset.categories),
                "category_confidence": dataset.category_confidence,
                "category_method": dataset.category_method,
                "completeness": dataset.quality.completeness,
                "timeliness": dataset.quality.timeliness,
                "consistency": dataset.quality.consistency,
                "documentation": dataset.quality.documentation,
                "description": dataset.description,
                "description_original": dataset.description_original,
                "description_en": dataset.description_en,
                "translation_method": dataset.translation_method,
                "translation_version": dataset.translation_version,
                "source": dataset.source,
                "api_url": dataset.api_url,
            })
        logger.info(f"Wrote dataset metadata: {csv_path}")
        return csv_path
    except Exception as e:
        logger.error(f"Failed to write dataset CSV {csv_path}: {e}")
        raise


def write_imported_datasets(source: str, datasets: List[Dataset]) -> Dict:
    """Write imported datasets to disk and update mapping file.
    
    Args:
        source: Source name (madrid_ckan, datos_gob_es, etc.)
        datasets: List of Dataset objects imported from this source
    
    Returns:
        Dict with session_dir, written_count, dataset_ids
    
    Raises:
        Exception if write fails
    """
    ensure_imports_dir()
    
    # Create session directory
    session_dir = create_import_session_dir()
    dataset_ids = []
    
    # Write each dataset's metadata CSV
    for dataset in datasets:
        write_dataset_metadata_csv(session_dir, source, dataset)
        dataset_ids.append(dataset.dataset_id)
    
    # Update global mapping file with this source
    mapping = read_mapping()
    mapping[source] = dataset_ids
    write_mapping(mapping)
    
    return {
        "session_dir": str(session_dir),
        "written_count": len(dataset_ids),
        "dataset_ids": dataset_ids,
    }


def get_datasets_for_source(source: str) -> List[str]:
    """Get list of dataset IDs for a specific source from the mapping.
    
    Args:
        source: Source name (madrid_ckan, datos_gob_es, etc.)
    
    Returns:
        List of dataset IDs, or empty list if source not found.
    """
    mapping = read_mapping()
    return mapping.get(source, [])


def clear_import_mapping(source: Optional[str] = None) -> List[str]:
    """Remove imported dataset IDs from the active source mapping.

    Import session directories are left in place for auditability; clearing only
    detaches the datasets from the active runtime catalog.
    """
    mapping = read_mapping()

    if source is None:
        removed = [dataset_id for ids in mapping.values() for dataset_id in ids]
        write_mapping({})
        return removed

    removed = mapping.pop(source, [])
    write_mapping(mapping)
    return removed
