#!/usr/bin/env python
"""Backfill bilingual title/description fields into normalized catalog caches."""
from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.storage import read_normalized_dataset_cache, write_normalized_dataset_cache


def main() -> None:
    updated_sources = 0
    updated_records = 0

    normalized_dir = Path(__file__).resolve().parents[1] / "data" / "cache" / "normalized"
    for path in sorted(normalized_dir.glob("*.jsonl")):
        source = path.stem
        datasets = read_normalized_dataset_cache(source=source)
        if not datasets:
            continue
        write_normalized_dataset_cache(source=source, datasets=datasets)
        updated_sources += 1
        updated_records += len(datasets)
        print(f"{source}: backfilled {len(datasets)} records")

    print(f"Backfilled bilingual catalog fields for {updated_records} records across {updated_sources} sources.")


if __name__ == "__main__":
    main()
