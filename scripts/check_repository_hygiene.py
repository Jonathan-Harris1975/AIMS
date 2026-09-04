#!/usr/bin/env python3
"""Fail CI when source hygiene introduces new duplicate files or extreme Python lines."""

from __future__ import annotations

from collections import defaultdict
import hashlib
import json
from pathlib import Path
import subprocess
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
MAX_PYTHON_LINE_LENGTH = 200
BASELINE_PATH = ROOT / "config" / "repository-hygiene-baseline.json"


def tracked_files() -> list[Path]:
    try:
        output = subprocess.check_output(
            ["git", "ls-files", "-z"],
            cwd=ROOT,
            stderr=subprocess.DEVNULL,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return [
            path
            for path in ROOT.rglob("*")
            if path.is_file() and ".git" not in path.parts and "__pycache__" not in path.parts
        ]

    return [ROOT / raw.decode("utf-8") for raw in output.split(b"\0") if raw]


def load_baseline() -> dict[str, Any]:
    """Load narrowly scoped, reviewed exceptions for debt that predates this gate."""
    if not BASELINE_PATH.is_file():
        return {"python_line_fingerprints": [], "duplicate_groups": []}

    try:
        baseline = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Invalid repository hygiene baseline: {exc}") from exc

    if baseline.get("version") != 1:
        raise SystemExit("Invalid repository hygiene baseline: expected version 1.")
    return baseline


def line_fingerprint(relative: str, line: str) -> str:
    """Fingerprint path + content so moving a known line is allowed but changing it is not."""
    return hashlib.sha256(f"{relative}\0{line}".encode("utf-8")).hexdigest()


def allowed_line_fingerprints(baseline: dict[str, Any]) -> set[tuple[str, str]]:
    allowed: set[tuple[str, str]] = set()
    for entry in baseline.get("python_line_fingerprints", []):
        path = entry.get("path")
        digest = entry.get("sha256")
        if isinstance(path, str) and isinstance(digest, str):
            allowed.add((path, digest))
    return allowed


def allowed_duplicate_groups(baseline: dict[str, Any]) -> set[tuple[str, ...]]:
    allowed: set[tuple[str, ...]] = set()
    for entry in baseline.get("duplicate_groups", []):
        paths = entry.get("paths")
        if isinstance(paths, list) and paths and all(isinstance(path, str) for path in paths):
            allowed.add(tuple(sorted(paths)))
    return allowed


def python_line_issues(paths: list[Path], allowed: set[tuple[str, str]]) -> list[str]:
    issues: list[str] = []
    for path in paths:
        if path.suffix != ".py" or not path.is_file():
            continue
        relative = path.relative_to(ROOT).as_posix()
        for line_number, line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
            if len(line) <= MAX_PYTHON_LINE_LENGTH:
                continue
            digest = line_fingerprint(relative, line)
            if (relative, digest) in allowed:
                continue
            issues.append(
                f"{relative}:{line_number} is {len(line)} characters; maximum is {MAX_PYTHON_LINE_LENGTH}"
            )
    return issues


def duplicate_groups(paths: list[Path], allowed: set[tuple[str, ...]]) -> list[list[str]]:
    by_digest: dict[tuple[int, bytes], list[str]] = defaultdict(list)
    for path in paths:
        if not path.is_file():
            continue
        data = path.read_bytes()
        if not data:
            continue
        relative = path.relative_to(ROOT).as_posix()
        by_digest[(len(data), hashlib.sha256(data).digest())].append(relative)

    groups = (sorted(group) for group in by_digest.values() if len(group) > 1)
    return sorted(
        (group for group in groups if tuple(group) not in allowed),
        key=lambda group: group[0],
    )


def main() -> int:
    paths = tracked_files()
    baseline = load_baseline()
    line_issues = python_line_issues(paths, allowed_line_fingerprints(baseline))
    duplicates = duplicate_groups(paths, allowed_duplicate_groups(baseline))

    if not line_issues and not duplicates:
        print(
            "Repository hygiene passed: no unapproved tracked byte-identical duplicates and "
            f"no new Python lines exceed {MAX_PYTHON_LINE_LENGTH} characters."
        )
        return 0

    print("Repository hygiene failures:")
    for issue in line_issues:
        print(f" - line_too_long: {issue}")
    for group in duplicates:
        print(f" - duplicate_content: {', '.join(group)}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
