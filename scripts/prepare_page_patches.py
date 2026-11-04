#!/usr/bin/env python3
"""Validate and rebuild the static page-patch catalog before a site sync."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.parse import quote

from rebuild_page_patches_index import BASE, PATCHES, main as rebuild_index


def patch_files() -> list[Path]:
    return sorted(
        (path for path in PATCHES.rglob("*.json") if path.name != "index.json"),
        key=lambda path: str(path.relative_to(PATCHES)).lower(),
    )


def page_patch_url(path: Path) -> str | None:
    relative = path.relative_to(PATCHES)
    if len(relative.parts) == 1:
        return f"{BASE}/{quote(relative.name, safe='')}"
    if len(relative.parts) == 2:
        return f"{BASE}/{quote(relative.parts[0], safe='')}/{quote(relative.parts[1], safe='')}"
    return None


def validate_patch_json(paths: list[Path]) -> None:
    failures: list[str] = []
    for path in paths:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            failures.append(f"{path.relative_to(PATCHES)}: {error}")
            continue
        if not isinstance(payload, dict):
            failures.append(f"{path.relative_to(PATCHES)}: root must be a JSON object")
    if failures:
        raise RuntimeError("Invalid patch JSON:\n  " + "\n  ".join(failures))


def verify_catalog(paths: list[Path]) -> None:
    catalog_path = PATCHES / "index.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    urls = {entry.get("url") for entry in catalog.get("patches", []) if isinstance(entry, dict)}
    missing = [
        url
        for path in paths
        if (url := page_patch_url(path)) is not None and url not in urls
    ]
    if missing:
        raise RuntimeError("Page patch catalog is missing:\n  " + "\n  ".join(missing))


def main() -> int:
    paths = patch_files()
    validate_patch_json(paths)
    rebuild_index()
    verify_catalog(paths)
    print(f"page patch publish preflight passed ({len(paths)} patch files)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"page patch publish preflight failed: {error}", file=sys.stderr)
        raise SystemExit(1)
