"""Background full-catalog import jobs for API-backed dataset sources."""
from __future__ import annotations

import logging
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple

from .api_adapters import DatosGobEsAdapter, MadridCKANAdapter, merge_and_deduplicate
from .models import Dataset
from .storage import (
    get_cache_manifest_path,
    get_normalized_cache_path,
    read_raw_cache_snapshots,
    read_cache_manifest,
    read_normalized_dataset_cache,
    update_cache_manifest_source,
    write_normalized_dataset_cache,
    write_raw_cache_snapshot,
)

logger = logging.getLogger(__name__)

FULL_IMPORT_SOURCES = {"madrid_ckan", "datos_gob_es"}
TERMINAL_STATUSES = {"completed", "failed"}
ACTIVE_STATUSES = {"queued", "running"}
STALE_CACHE_AFTER = timedelta(days=7)


def _utc_now() -> str:
    return datetime.utcnow().isoformat()


def _is_stale(finished_at: Optional[str]) -> bool:
    if not finished_at:
        return False
    try:
        finished = datetime.fromisoformat(finished_at)
    except ValueError:
        return False
    return datetime.utcnow() - finished > STALE_CACHE_AFTER


def _cache_updated_at(source: str, cache_base_dir: Optional[Path] = None) -> Optional[str]:
    path = get_normalized_cache_path(source, cache_base_dir)
    if not path.exists() or path.stat().st_size == 0:
        return None
    return datetime.utcfromtimestamp(path.stat().st_mtime).isoformat()


def _snapshot_number(value: str, prefix: str) -> Optional[int]:
    if not value.startswith(prefix):
        return None
    suffix = value[len(prefix):]
    return int(suffix) if suffix.isdigit() else None


@dataclass
class FullCatalogImportProgress:
    source: str
    status: str = "idle"
    fetched_count: int = 0
    normalized_count: int = 0
    total_count: Optional[int] = None
    current_page: Optional[int] = None
    current_offset: Optional[int] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    last_error: Optional[str] = None
    raw_snapshot_count: int = 0
    normalized_cache_path: str = ""
    manifest_path: str = ""
    is_stale: bool = False
    cache_updated_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class FullCatalogImportManager:
    """Run and track one full-catalog import job per supported source."""

    def __init__(self, cache_base_dir: Optional[Path] = None) -> None:
        self.cache_base_dir = cache_base_dir
        self._progress: Dict[str, FullCatalogImportProgress] = {}
        self._lock = Lock()

    def validate_source(self, source: str) -> str:
        if source not in FULL_IMPORT_SOURCES:
            valid = ", ".join(sorted(FULL_IMPORT_SOURCES))
            raise ValueError(f"Unsupported full catalog source '{source}'. Valid values: {valid}")
        return source

    def get_progress(self, source: str) -> FullCatalogImportProgress:
        source = self.validate_source(source)
        with self._lock:
            progress = self._progress.get(source)
            if progress:
                payload = progress.to_dict()
                payload["cache_updated_at"] = (
                    payload.get("cache_updated_at") or _cache_updated_at(source, self.cache_base_dir)
                )
                return FullCatalogImportProgress(**payload)

        return self._progress_from_manifest(source)

    def start(self, source: str) -> Tuple[FullCatalogImportProgress, bool]:
        source = self.validate_source(source)
        with self._lock:
            current = self._progress.get(source)
            if current and current.status in ACTIVE_STATUSES:
                return FullCatalogImportProgress(**current.to_dict()), False

            progress = FullCatalogImportProgress(
                source=source,
                status="queued",
                started_at=_utc_now(),
                normalized_cache_path=str(get_normalized_cache_path(source, self.cache_base_dir)),
                manifest_path=str(get_cache_manifest_path(self.cache_base_dir)),
            )
            self._progress[source] = progress

        self._persist_progress(progress)
        return progress, True

    def start_rebuild(self, source: str) -> Tuple[FullCatalogImportProgress, bool]:
        """Queue a normalized-cache rebuild from existing raw snapshots."""
        source = self.validate_source(source)
        with self._lock:
            current = self._progress.get(source)
            if current and current.status in ACTIVE_STATUSES:
                return FullCatalogImportProgress(**current.to_dict()), False

            progress = FullCatalogImportProgress(
                source=source,
                status="queued",
                started_at=_utc_now(),
                normalized_cache_path=str(get_normalized_cache_path(source, self.cache_base_dir)),
                manifest_path=str(get_cache_manifest_path(self.cache_base_dir)),
            )
            self._progress[source] = progress

        self._persist_progress(progress)
        return progress, True

    def run(self, source: str) -> None:
        source = self.validate_source(source)
        progress = self._set_progress(
            source,
            status="running",
            started_at=_utc_now(),
            fetched_count=0,
            normalized_count=0,
            total_count=None,
            current_page=None,
            current_offset=None,
            finished_at=None,
            last_error=None,
            raw_snapshot_count=0,
            normalized_cache_path=str(get_normalized_cache_path(source, self.cache_base_dir)),
            manifest_path=str(get_cache_manifest_path(self.cache_base_dir)),
            cache_updated_at=_cache_updated_at(source, self.cache_base_dir),
        )
        self._persist_progress(progress)

        datasets: List[Dataset] = []
        fetched_count = 0
        raw_snapshot_count = 0

        try:
            for page in self._iter_pages(source):
                write_raw_cache_snapshot(
                    source=source,
                    snapshot_name=page.snapshot_name,
                    payload=page.raw_payload,
                    cache_base_dir=self.cache_base_dir,
                )
                raw_snapshot_count += 1
                fetched_count += page.fetched_count
                datasets.extend(page.datasets)

                normalized = merge_and_deduplicate([datasets])
                write_normalized_dataset_cache(
                    source=source,
                    datasets=normalized,
                    cache_base_dir=self.cache_base_dir,
                )

                progress = self._set_progress(
                    source,
                    status="running",
                    fetched_count=fetched_count,
                    normalized_count=len(normalized),
                    total_count=page.total_count,
                    current_page=page.page_index,
                    current_offset=page.offset,
                    raw_snapshot_count=raw_snapshot_count,
                    last_error=None,
                    normalized_cache_path=str(get_normalized_cache_path(source, self.cache_base_dir)),
                    manifest_path=str(get_cache_manifest_path(self.cache_base_dir)),
                    cache_updated_at=_cache_updated_at(source, self.cache_base_dir),
                )
                self._persist_progress(progress)

            normalized = merge_and_deduplicate([datasets])
            if fetched_count == 0 or not normalized:
                raise ValueError(
                    "No datasets were fetched from the source API. Check network access or retry the import."
                )
            write_normalized_dataset_cache(
                source=source,
                datasets=normalized,
                cache_base_dir=self.cache_base_dir,
            )
            progress = self._set_progress(
                source,
                status="completed",
                fetched_count=fetched_count,
                normalized_count=len(normalized),
                finished_at=_utc_now(),
                raw_snapshot_count=raw_snapshot_count,
                normalized_cache_path=str(get_normalized_cache_path(source, self.cache_base_dir)),
                manifest_path=str(get_cache_manifest_path(self.cache_base_dir)),
                cache_updated_at=_cache_updated_at(source, self.cache_base_dir),
            )
            self._persist_progress(progress)
            logger.info("Full catalog import completed for %s: %s records", source, len(normalized))
        except Exception as exc:
            logger.exception("Full catalog import failed for %s", source)
            progress = self._set_progress(
                source,
                status="failed",
                finished_at=_utc_now(),
                last_error=str(exc),
                raw_snapshot_count=raw_snapshot_count,
                normalized_cache_path=str(get_normalized_cache_path(source, self.cache_base_dir)),
                manifest_path=str(get_cache_manifest_path(self.cache_base_dir)),
                cache_updated_at=_cache_updated_at(source, self.cache_base_dir),
            )
            self._persist_progress(progress)

    def rebuild_from_raw(self, source: str) -> None:
        """Rebuild normalized Dataset JSONL from cached raw API snapshots."""
        source = self.validate_source(source)
        progress = self._set_progress(
            source,
            status="running",
            started_at=_utc_now(),
            fetched_count=0,
            normalized_count=0,
            total_count=None,
            current_page=None,
            current_offset=None,
            finished_at=None,
            last_error=None,
            raw_snapshot_count=0,
            normalized_cache_path=str(get_normalized_cache_path(source, self.cache_base_dir)),
            manifest_path=str(get_cache_manifest_path(self.cache_base_dir)),
            cache_updated_at=_cache_updated_at(source, self.cache_base_dir),
        )
        self._persist_progress(progress)

        datasets: List[Dataset] = []
        fetched_count = 0
        total_count: Optional[int] = None
        snapshots = read_raw_cache_snapshots(source, cache_base_dir=self.cache_base_dir)

        try:
            if not snapshots:
                raise ValueError("No raw cache snapshots are available to rebuild from.")

            for index, (path, payload) in enumerate(snapshots):
                page = self._normalize_raw_snapshot(source, path, payload, index)
                fetched_count += page.fetched_count
                total_count = page.total_count if page.total_count is not None else total_count
                datasets.extend(page.datasets)

                normalized = merge_and_deduplicate([datasets])
                write_normalized_dataset_cache(
                    source=source,
                    datasets=normalized,
                    cache_base_dir=self.cache_base_dir,
                )
                progress = self._set_progress(
                    source,
                    status="running",
                    fetched_count=fetched_count,
                    normalized_count=len(normalized),
                    total_count=total_count,
                    current_page=page.page_index,
                    current_offset=page.offset,
                    raw_snapshot_count=index + 1,
                    normalized_cache_path=str(get_normalized_cache_path(source, self.cache_base_dir)),
                    manifest_path=str(get_cache_manifest_path(self.cache_base_dir)),
                    cache_updated_at=_cache_updated_at(source, self.cache_base_dir),
                )
                self._persist_progress(progress)

            normalized = merge_and_deduplicate([datasets])
            if fetched_count == 0 or not normalized:
                raise ValueError("No datasets could be rebuilt from the raw cache snapshots.")
            write_normalized_dataset_cache(
                source=source,
                datasets=normalized,
                cache_base_dir=self.cache_base_dir,
            )
            progress = self._set_progress(
                source,
                status="completed",
                fetched_count=fetched_count,
                normalized_count=len(normalized),
                total_count=total_count,
                finished_at=_utc_now(),
                raw_snapshot_count=len(snapshots),
                normalized_cache_path=str(get_normalized_cache_path(source, self.cache_base_dir)),
                manifest_path=str(get_cache_manifest_path(self.cache_base_dir)),
                cache_updated_at=_cache_updated_at(source, self.cache_base_dir),
            )
            self._persist_progress(progress)
            logger.info("Full catalog cache rebuilt for %s: %s records", source, len(normalized))
        except Exception as exc:
            logger.exception("Full catalog cache rebuild failed for %s", source)
            progress = self._set_progress(
                source,
                status="failed",
                finished_at=_utc_now(),
                last_error=str(exc),
                raw_snapshot_count=len(snapshots),
                normalized_cache_path=str(get_normalized_cache_path(source, self.cache_base_dir)),
                manifest_path=str(get_cache_manifest_path(self.cache_base_dir)),
                cache_updated_at=_cache_updated_at(source, self.cache_base_dir),
            )
            self._persist_progress(progress)

    def load_cached_datasets(self, source: Optional[str] = None) -> List[Dataset]:
        return read_normalized_dataset_cache(source=source, cache_base_dir=self.cache_base_dir)

    def _iter_pages(self, source: str):
        if source == "madrid_ckan":
            return MadridCKANAdapter.iter_all_dataset_pages(rows=100)
        if source == "datos_gob_es":
            return DatosGobEsAdapter.iter_all_dataset_pages(max_pages=None)
        raise ValueError(f"Unsupported full catalog source '{source}'")

    def _normalize_raw_snapshot(self, source: str, path: Path, payload: Dict[str, Any], index: int):
        if source == "madrid_ckan":
            offset = _snapshot_number(path.stem, prefix="offset-") or 0
            return MadridCKANAdapter.normalize_catalog_payload(
                payload,
                rows=100,
                start=offset,
                snapshot_name=path.stem,
            )
        if source == "datos_gob_es":
            page_index = _snapshot_number(path.stem, prefix="page-")
            return DatosGobEsAdapter.normalize_catalog_payload(
                payload,
                page_index=index if page_index is None else page_index,
                snapshot_name=path.stem,
            )
        raise ValueError(f"Unsupported full catalog source '{source}'")

    def _set_progress(self, source: str, **changes: Any) -> FullCatalogImportProgress:
        with self._lock:
            current = self._progress.get(source) or FullCatalogImportProgress(source=source)
            payload = current.to_dict()
            payload.update(changes)
            progress = FullCatalogImportProgress(**payload)
            self._progress[source] = progress
            return FullCatalogImportProgress(**progress.to_dict())

    def _persist_progress(self, progress: FullCatalogImportProgress) -> None:
        payload = progress.to_dict()
        payload.pop("source", None)
        payload.pop("manifest_path", None)
        payload["is_stale"] = _is_stale(progress.finished_at)
        payload["normalized_cache_path"] = str(get_normalized_cache_path(progress.source, self.cache_base_dir))
        payload["cache_updated_at"] = _cache_updated_at(progress.source, self.cache_base_dir)
        update_cache_manifest_source(
            progress.source,
            payload,
            cache_base_dir=self.cache_base_dir,
        )

    def _progress_from_manifest(self, source: str) -> FullCatalogImportProgress:
        manifest = read_cache_manifest(self.cache_base_dir)
        source_manifest = manifest.get("sources", {}).get(source, {})
        cached_count = len(self.load_cached_datasets(source))
        cache_updated_at = _cache_updated_at(source, self.cache_base_dir)
        if not source_manifest and cached_count == 0:
            return FullCatalogImportProgress(
                source=source,
                manifest_path=str(get_cache_manifest_path(self.cache_base_dir)),
                normalized_cache_path=str(get_normalized_cache_path(source, self.cache_base_dir)),
                cache_updated_at=cache_updated_at,
            )

        status = source_manifest.get("status") or ("completed" if cached_count else "idle")
        if cached_count > 0 and status in ACTIVE_STATUSES.union({"idle", "failed"}):
            status = "completed"
            finished_at = source_manifest.get("finished_at") or cache_updated_at or _utc_now()
            last_error = None
        elif status in ACTIVE_STATUSES:
            status = "failed"
            finished_at = source_manifest.get("finished_at") or _utc_now()
            last_error = (
                source_manifest.get("last_error")
                or "Previous full-catalog import was interrupted before completion. Retry the import to refresh this source."
            )
        else:
            finished_at = source_manifest.get("finished_at") or (
                cache_updated_at if status == "completed" else None
            )
            last_error = source_manifest.get("last_error")

        if status != source_manifest.get("status") or finished_at != source_manifest.get("finished_at"):
            update_cache_manifest_source(
                source,
                {
                    **source_manifest,
                    "status": status,
                    "last_error": last_error,
                    "finished_at": finished_at,
                    "normalized_count": int(source_manifest.get("normalized_count") or cached_count),
                    "cache_updated_at": cache_updated_at,
                },
                cache_base_dir=self.cache_base_dir,
            )
            source_manifest = {
                **source_manifest,
                "status": status,
                "last_error": last_error,
                "finished_at": finished_at,
                "normalized_count": int(source_manifest.get("normalized_count") or cached_count),
                "cache_updated_at": cache_updated_at,
            }

        normalized_count = int(source_manifest.get("normalized_count") or cached_count)
        finished_at = source_manifest.get("finished_at") or (
            cache_updated_at if status == "completed" else None
        )
        return FullCatalogImportProgress(
            source=source,
            status=status,
            fetched_count=int(source_manifest.get("fetched_count") or normalized_count),
            normalized_count=normalized_count,
            total_count=source_manifest.get("total_count"),
            current_page=source_manifest.get("current_page"),
            current_offset=source_manifest.get("current_offset"),
            started_at=source_manifest.get("started_at"),
            finished_at=finished_at,
            last_error=source_manifest.get("last_error"),
            raw_snapshot_count=int(source_manifest.get("raw_snapshot_count") or 0),
            normalized_cache_path=str(get_normalized_cache_path(source, self.cache_base_dir)),
            manifest_path=str(get_cache_manifest_path(self.cache_base_dir)),
            is_stale=_is_stale(finished_at),
            cache_updated_at=cache_updated_at,
        )


FULL_IMPORT_MANAGER = FullCatalogImportManager()
