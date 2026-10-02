#!/usr/bin/env python3
"""Block new, high-impact CodeQL security findings introduced by a pull request.

GitHub's native CodeQL result remains the source of truth for repository-wide
findings.  This additional gate prevents a pull request from introducing a new
high/critical finding on an added line, while push/manual runs report existing
repository findings without retroactively failing otherwise successful CI.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.parse
import urllib.request

REPO = os.environ["GITHUB_REPOSITORY"]
TOKEN = os.environ["GH_TOKEN"]
PR = os.environ.get("PR_NUMBER", "").strip()
BRANCH = os.environ.get("DEFAULT_BRANCH", "main").strip() or "main"
HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")


def api(path: str) -> list[dict]:
    """Get every page; never silently pass when a scan cannot be read."""
    url = "https://api.github.com" + path
    items: list[dict] = []
    while url:
        request = urllib.request.Request(url, headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {TOKEN}",
            "X-GitHub-Api-Version": "2022-11-28",
        })
        with urllib.request.urlopen(request, timeout=30) as response:
            page = json.load(response)
            if not isinstance(page, list):
                raise ValueError("Expected a list of CodeQL results")
            items.extend(page)
            link = response.headers.get("Link", "")
            url = next((x.split(";", 1)[0].strip(" <>") for x in link.split(",")
                        if 'rel="next"' in x), "")
    return items


def added_lines(patch: str) -> set[int]:
    lines: set[int] = set()
    current = None
    for line in patch.splitlines():
        match = HUNK.match(line)
        if match:
            current = int(match.group(1))
        elif current is not None and line.startswith("+") and not line.startswith("+++"):
            lines.add(current)
            current += 1
        elif current is not None and line.startswith(" "):
            current += 1
    return lines


def blocking_security(alert: dict) -> bool:
    if alert.get("state") != "open" or alert.get("tool", {}).get("name") != "CodeQL":
        return False
    rule = alert.get("rule") or {}
    score = rule.get("security_severity")
    if isinstance(score, (int, float)) or (
        isinstance(score, str) and re.fullmatch(r"\d+(?:\.\d+)?", score)
    ):
        return float(score) >= 7
    level = str(rule.get("security_severity_level", "")).lower()
    if level in {"high", "critical"}:
        return True
    # A generic CodeQL "error" is a quality severity, not proof of a
    # high/critical security finding. Unknown security severity is not promoted.
    return False


def finding_details(item: dict) -> tuple[str, str, object, str]:
    rule = item.get("rule") or {}
    location = (item.get("most_recent_instance") or {}).get("location") or {}
    return (
        str(rule.get("id", "unknown")),
        str(location.get("path", "?")),
        location.get("start_line", "?"),
        str(item.get("html_url", "")),
    )


def main() -> int:
    is_pr = bool(PR)
    ref = f"refs/pull/{int(PR)}/merge" if is_pr else f"refs/heads/{BRANCH}"
    scope = "ref=" + urllib.parse.quote(ref, safe="")
    alerts = api(f"/repos/{REPO}/code-scanning/alerts?state=open&{scope}&per_page=100")
    repository_findings = [item for item in alerts if blocking_security(item)]
    qualifying = repository_findings
    uncertain = 0

    if is_pr:
        files = api(f"/repos/{REPO}/pulls/{int(PR)}/files?per_page=100")
        changed = {item["filename"]: added_lines(item["patch"])
                   for item in files if "patch" in item}
        selected = []
        for item in repository_findings:
            location = (item.get("most_recent_instance") or {}).get("location") or {}
            path, start = location.get("path"), location.get("start_line")
            if path not in changed:
                uncertain += 1
            elif isinstance(start, int) and start in changed[path]:
                selected.append(item)
        qualifying = selected

    with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
        summary.write("## CodeQL security findings\n\n")
        if is_pr:
            summary.write(
                f"Blocking high/critical findings on added PR lines: **{len(qualifying)}**.\n\n"
            )
        else:
            summary.write(
                f"Open high/critical findings on `{BRANCH}` (report-only for this event): "
                f"**{len(repository_findings)}**.\n\n"
            )

        displayed = qualifying if is_pr else repository_findings
        for item in displayed[:30]:
            rule_id, path, start, html_url = finding_details(item)
            summary.write(
                f"- #{item['number']} `{rule_id}` `{path}:{start}` {html_url}\n"
            )
        if uncertain:
            summary.write(
                f"\n{uncertain} findings could not be tied to added PR lines here; "
                "GitHub's native code-scanning PR check evaluates those independently.\n"
            )

    # Put the actual alert locations in the ordinary job log as well as the step
    # summary. Downloaded GitHub job logs otherwise omit the useful summary body.
    displayed = qualifying if is_pr else repository_findings
    for item in displayed[:30]:
        rule_id, path, start, html_url = finding_details(item)
        print(f"CodeQL alert #{item['number']}: {rule_id} at {path}:{start} {html_url}")

    if is_pr and qualifying:
        print(
            f"::error::CodeQL found {len(qualifying)} new high/critical security "
            "finding(s) on added pull-request lines"
        )
        return 1

    if not is_pr and repository_findings:
        print(
            f"::warning::CodeQL reports {len(repository_findings)} open high/critical "
            f"finding(s) on {BRANCH}; this non-PR run is report-only."
        )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"::error::CodeQL classification unavailable: {exc}", file=sys.stderr)
        sys.exit(1)
