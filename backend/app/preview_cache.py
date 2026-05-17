"""Short-lived in-memory cache for dataset preview payloads."""
from __future__ import annotations

import time
from typing import Any, Dict, Optional, Tuple

_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
TTL_SECONDS = 300


def preview_cache_key(dataset_id: str, max_rows: int) -> str:
    return f"{dataset_id}:{max_rows}"


def get_cached_preview(key: str) -> Optional[Dict[str, Any]]:
    entry = _CACHE.get(key)
    if not entry:
        return None
    expires_at, payload = entry
    if time.monotonic() >= expires_at:
        _CACHE.pop(key, None)
        return None
    return payload


def set_cached_preview(key: str, payload: Dict[str, Any]) -> None:
    _CACHE[key] = (time.monotonic() + TTL_SECONDS, payload)


def clear_preview_cache() -> None:
    _CACHE.clear()
