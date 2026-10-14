#!/usr/bin/env python3
"""Admit only verified automation pull requests to GitHub native auto-merge.

Runs from the trusted default-branch workflow. It never checks out or executes PR code.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

from autonomy_admission_check import set_admission_check

API = "https://api.github.com"
TOKEN = os.environ["GH_TOKEN"]
REPO = os.environ.get("REPO") or os.environ["GITHUB_REPOSITORY"]
REQUIRED_WORKFLOWS = [x.strip() for x in os.environ.get("REQUIRED_WORKFLOWS", "").split("|") if x.strip()]
DEFAULT_BRANCH = os.environ.get("DEFAULT_BRANCH", "main")
REPAIR_APP_LOGIN = os.environ.get("REPAIR_APP_LOGIN", "")
VERIFIED_ADMISSION_HEADS: set[tuple[int, str]] = set()

RENOVATE_LOGIN = "renovate[bot]"
KILO_LOGIN = (os.environ.get("KILO_REPAIR_PR_LOGIN") or "kilo-code-bot[bot]").strip()
CTO_LOGIN = (os.environ.get("CTO_NEW_PR_LOGIN") or "cto-new[bot]").strip()
CTO_TASK_LABEL = "autonomy:cto-task"
CTO_IMPLEMENTATION_LABEL = "autonomy:cto-implementation"
CARRIER_PREFIX = "[autonomy] Repair "
BRANCH_PR_LABEL = "automation:branch-pr"
BRANCH_PR_RE = re.compile(r"^(fix|feat|chore|ci|work|codex)/[A-Za-z0-9._/-]+$")
COUNCIL_FREEZE_LABEL = "autonomy:council-freeze"
LONDON = ZoneInfo("Europe/London")
URL_END = r"(?![A-Za-z0-9/_-])"

KILO_SENSITIVE_PREFIXES = (
    ".github/workflows/",
    ".github/actions/",
    ".github/scripts/",
    ".github/CODEOWNERS",
    ".github/dependabot.yml",
    ".mergify.yml",
    "renovate.json",
    ".gitleaks",
    "SECURITY.md",
    "AUTONOMY.md",
    "CI_SETUP.txt",
)
KILO_SENSITIVE_EXACT = {
    ".github/production-governance.json",
    "kilo.jsonc",
    ".github/scripts/trusted_automation.py",
    ".github/scripts/branch_pr_automation.py",
    ".github/scripts/pr_blocker_recovery.py",
    ".github/scripts/pr_repair_router.py",
    ".github/scripts/kilo_failure_classifier.py",
    "scripts/secret_scan.py",
    "scripts/install_ci_tools.py",
    "scripts/verify_ci_tool_checksums.py",
}

RISK_APPROVAL_LABEL = "autonomy:risk-approval-required"
RISK_HIGH_RISK_PREFIXES = (
    ".github/", ".circleci/", ".buildkite/", ".gitlab/", ".devcontainer/",
    "infra/", "infrastructure/", "terraform/", "k8s/", "kubernetes/", "helm/",
    "charts/", "migrations/", "db/migrations/", "database/migrations/",
)
RISK_HIGH_RISK_BASENAMES = {
    "dockerfile", "containerfile", "docker-compose.yml", "docker-compose.yaml",
    "compose.yml", "compose.yaml", "procfile", "koyeb.yaml", "koyeb.yml",
    "fly.toml", "wrangler.toml", "wrangler.json", "wrangler.jsonc",
    "vercel.json", "netlify.toml", "render.yaml", "package.json",
    "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml",
    "pyproject.toml", "poetry.lock", "requirements.txt", "requirements.in", "pipfile", "pipfile.lock",
    "uv.lock", "cargo.toml", "cargo.lock", "go.mod", "go.sum",
    "composer.json", "composer.lock", "gemfile", "gemfile.lock",
}
RISK_HIGH_RISK_SEGMENTS = {
    "auth", "authentication", "authorization", "security", "crypto", "oidc",
    "saml", "rbac", "permissions", "secrets", "migrations", "migration",
    "gateway", "middleware",
}
RISK_HIGH_RISK_NAME_STEMS = (
    "auth", "authentication", "authorization", "security", "crypto", "oidc",
    "saml", "rbac", "permission", "secret", "session", "middleware", "gateway",
    "deploy", "deployment",
)

RISK_LOW_RISK_PREFIXES_BY_REPO = {
    "AIMS": ("routes/", "services/"),
    "AIMS-UI": ("apps/", "packages/"),
    "HIVE": ("backend/app/",),
    "HIVE-UI": ("src/",),
    "IRS": ("public/",),
    "RAMS": (),
    "MAST": (),
    "jonathan-harris-website": (
        "blog/", "bio/", "book-finder/", "glossary/", "topics/",
        "transcripts/", "podcast/", "resources/", "for-teams/",
    ),
}
RISK_LOW_RISK_CODE_EXTENSIONS_BY_REPO = {
    "AIMS": {".js", ".jsx", ".ts", ".tsx"},
    "AIMS-UI": {".js", ".jsx", ".ts", ".tsx", ".css", ".scss", ".html", ".svg"},
    "HIVE": {".py"},
    "HIVE-UI": {".js", ".jsx", ".ts", ".tsx", ".css", ".scss", ".html", ".svg"},
    "IRS": {".css", ".html", ".svg"},
    "RAMS": set(),
    "MAST": set(),
    "jonathan-harris-website": {".md", ".mdx"},
}
RISK_LOW_RISK_DOC_EXTENSIONS = {".md", ".mdx", ".rst"}
RISK_LOW_RISK_ROOT_FILES = {"readme.md", "changelog.md"}



def log(message: str) -> None:
    print(message, flush=True)


@dataclass
class ApiError(RuntimeError):
    status: int
    body: str

    def __str__(self) -> str:
        return f"GitHub API HTTP {self.status}: {self.body[:500]}"


def request(method: str, path: str, data: Any | None = None, expected: tuple[int, ...] = (200,)) -> Any:
    url = path if path.startswith("http") else API + path
    payload = None if data is None else json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method=method)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if payload is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            if resp.status not in expected:
                raise ApiError(resp.status, raw.decode("utf-8", "replace"))
            if not raw:
                return None
            return json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        raise ApiError(exc.code, body) from exc


def get(path: str) -> Any:
    return request("GET", path, expected=(200,))


def post(path: str, data: Any | None = None, expected: tuple[int, ...] = (200, 201, 202, 204)) -> Any:
    return request("POST", path, data=data, expected=expected)


def delete(path: str, expected: tuple[int, ...] = (200, 204)) -> Any:
    return request("DELETE", path, expected=expected)


def issue_labels(pr: dict[str, Any]) -> set[str]:
    return {str(x.get("name", "")) for x in pr.get("labels", [])}


def remove_label(number: int, label: str) -> None:
    encoded = urllib.parse.quote(label, safe="")
    try:
        delete(f"/repos/{REPO}/issues/{number}/labels/{encoded}", expected=(200, 204))
    except ApiError as exc:
        if exc.status != 404:
            raise


def _github_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def current_weekend_bounds(now: datetime | None = None) -> tuple[datetime, datetime] | None:
    """Return the active Fri 20:00 -> Mon 04:00 Europe/London envelope."""
    local_now = (now or datetime.now(timezone.utc)).astimezone(LONDON)
    # Python weekday(): Monday=0 .. Sunday=6, so Friday=4. Subtracting 4 and
    # taking modulo 7 yields days back to the most recent Friday (Fri->0,
    # Sat->1, Sun->2, Mon->3, Tue->4, Wed->5, Thu->6), anchoring the
    # Fri 20:00-Mon 04:00 Europe/London evidence envelope.
    days_since_friday = (local_now.weekday() - 4) % 7
    friday = (local_now - timedelta(days=days_since_friday)).replace(
        hour=20, minute=0, second=0, microsecond=0
    )
    end = friday + timedelta(days=2, hours=8)
    if friday <= local_now < end:
        return friday, end
    return None


def _resolve_branch_sha() -> str:
    """Fetch and validate the current default-branch SHA."""
    branch = get(f"/repos/{REPO}/branches/{DEFAULT_BRANCH}")
    sha = str(branch.get("commit", {}).get("sha", ""))
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise RuntimeError("Could not resolve current default-branch SHA for Council freeze")
    return sha


def _fetch_branch_runs(sha: str | None = None) -> list[dict[str, Any]]:
    """Fetch complete branch workflow evidence, bounded to 1,000 runs."""
    bounds = current_weekend_bounds()
    if bounds is None:
        return []
    start, end = (value.astimezone(timezone.utc) for value in bounds)
    created = urllib.parse.quote(
        f"{start.strftime('%Y-%m-%dT%H:%M:%SZ')}..{end.strftime('%Y-%m-%dT%H:%M:%SZ')}", safe=""
    )
    encoded_branch = urllib.parse.quote(DEFAULT_BRANCH, safe="")
    encoded_sha = f"&head_sha={urllib.parse.quote(sha, safe='')}" if sha else ""
    runs: list[dict[str, Any]] = []
    total_count: int | None = None
    for page in range(1, 11):
        payload = get(
            f"/repos/{REPO}/actions/runs?branch={encoded_branch}{encoded_sha}&created={created}&per_page=100&page={page}"
        )
        chunk = payload.get("workflow_runs", []) if isinstance(payload, dict) else []
        if total_count is None and isinstance(payload, dict):
            raw_total = payload.get("total_count")
            if isinstance(raw_total, int) and raw_total >= 0:
                total_count = raw_total
        runs.extend(chunk)

        # A short page is authoritative pagination evidence that there is no next
        # page, even if total_count is briefly stale or overestimated.
        if len(chunk) < 100:
            return runs

        # total_count is still useful for the exact 1,000-run boundary: when the
        # tenth full page completes the advertised result set, it is complete.
        if total_count is not None and len(runs) >= total_count:
            return runs

    # Ten full pages without proving completeness would exceed the bounded
    # evidence window. Fail closed instead of silently certifying truncated data.
    raise RuntimeError("Workflow-run pagination exceeded the safe 1,000-run limit")


def council_evidence_freeze() -> tuple[bool, str]:
    """Freeze routine merges after exact-SHA weekend CI until Council succeeds."""
    bounds = current_weekend_bounds()
    if bounds is None:
        return False, "outside the weekend evidence envelope"

    current_sha = _resolve_branch_sha()
    runs = _fetch_branch_runs(current_sha)

    # Re-read main after collecting evidence. Retry one race using the new SHA;
    # if main moves a second time, fail closed rather than certify stale evidence.
    current_after = _resolve_branch_sha()
    if current_after != current_sha:
        log(
            f"default branch advanced from {current_sha[:12]} to {current_after[:12]} "
            "during Council evidence evaluation; retrying once with the new SHA"
        )
        current_sha = current_after
        runs = _fetch_branch_runs(current_sha)
        current_after = _resolve_branch_sha()
        if current_after != current_sha:
            return True, (
                f"default branch moved from {current_sha[:12]} to {current_after[:12]} "
                "during Council evidence evaluation"
            )

    start_utc, end_utc = (value.astimezone(timezone.utc) for value in bounds)

    def in_window(run: dict[str, Any]) -> bool:
        created = str(run.get("created_at", ""))
        if not created:
            return False
        when = _github_time(created)
        return start_utc <= when < end_utc

    ci_runs = [
        run for run in runs
        if run.get("name") == "AIMS CI"
        and run.get("event") != "pull_request"
        and run.get("status") == "completed"
        and run.get("conclusion") == "success"
        and run.get("head_sha") == current_sha
        and in_window(run)
    ]
    if not ci_runs:
        return False, f"no successful weekend AIMS CI evidence exists for {current_sha[:12]}"

    ci_run = max(ci_runs, key=lambda run: int(run.get("id", 0)))
    ci_time = _github_time(str(ci_run["created_at"]))
    council_runs = [
        run for run in runs
        if run.get("name") == "Repository Council"
        and run.get("status") == "completed"
        and run.get("conclusion") == "success"
        and run.get("head_sha") == current_sha
        and in_window(run)
        and _github_time(str(run.get("created_at", ""))) >= ci_time
    ]
    if council_runs:
        return False, f"Council completed for weekend evidence SHA {current_sha[:12]}"
    return True, f"weekend CI PASS is recorded for {current_sha[:12]} and Council has not completed"


def ensure_label(name: str, color: str, description: str) -> None:
    try:
        post(f"/repos/{REPO}/labels", {"name": name, "color": color, "description": description}, expected=(201,))
    except ApiError as exc:
        if exc.status != 422:  # already exists is returned as validation failure
            raise


def add_labels(number: int, labels: list[str]) -> None:
    post(f"/repos/{REPO}/issues/{number}/labels", {"labels": labels}, expected=(200,))


def comment(number: int, body: str) -> None:
    post(f"/repos/{REPO}/issues/{number}/comments", {"body": body}, expected=(201,))


def list_open_prs() -> list[dict[str, Any]]:
    prs: list[dict[str, Any]] = []
    for page in range(1, 11):
        chunk = get(f"/repos/{REPO}/pulls?state=open&per_page=100&page={page}")
        prs.extend(chunk)
        if len(chunk) < 100:
            return prs
    raise RuntimeError("More than 1,000 open PRs; refusing incomplete trust reconciliation")


def is_same_repo(pr: dict[str, Any]) -> bool:
    return str(pr.get("head", {}).get("repo", {}).get("full_name", "")) == REPO


def is_renovate(pr: dict[str, Any]) -> bool:
    body = pr.get("body") or ""
    return (
        pr.get("user", {}).get("login") == RENOVATE_LOGIN
        and is_same_repo(pr)
        and "This PR was generated by [Mend Renovate]" in body
        and "<!--renovate-debug:" in body
    )


def renovate_auto_eligible(pr: dict[str, Any]) -> bool:
    return is_renovate(pr) and "dependency:auto-eligible" in issue_labels(pr)


def is_managed_branch_identity(pr: dict[str, Any]) -> bool:
    """Recognise a trusted same-repository branch-controller PR identity."""
    labels = issue_labels(pr)
    branch = str(pr.get("head", {}).get("ref", ""))
    return (
        pr.get("user", {}).get("login") == REPAIR_APP_LOGIN
        and pr.get("state") == "open"
        and is_same_repo(pr)
        and pr.get("base", {}).get("ref") == DEFAULT_BRANCH
        and BRANCH_PR_LABEL in labels
        and BRANCH_PR_RE.fullmatch(branch) is not None
    )


def is_managed_branch_pr(pr: dict[str, Any]) -> bool:
    """Return merge-admission eligible managed branch identity."""
    return is_managed_branch_identity(pr) and not pr.get("draft")


def is_repair_carrier_identity(pr: dict[str, Any]) -> bool:
    """Identify a repair carrier regardless of lifecycle labels."""
    return (
        pr.get("user", {}).get("login") == REPAIR_APP_LOGIN
        and pr.get("state") == "open"
        and is_same_repo(pr)
        and pr.get("base", {}).get("ref") == DEFAULT_BRANCH
        and str(pr.get("title", "")).startswith(CARRIER_PREFIX)
        and re.fullmatch(r"autonomy/repair-\d+", str(pr.get("head", {}).get("ref", ""))) is not None
        and bool(issue_labels(pr).intersection({"autonomy:repair", "autonomy:obsolete", "autonomy:superseded"}))
    )


def is_carrier(pr: dict[str, Any]) -> bool:
    labels = issue_labels(pr)
    return (
        is_repair_carrier_identity(pr)
        and not labels.intersection({"autonomy:human-hold", "autonomy:superseded", "autonomy:obsolete"})
    )


def is_kilo_implementation_identity(pr: dict[str, Any]) -> bool:
    """Recognise a Kilo implementation only after trusted linkage labels exist."""
    labels = issue_labels(pr)
    return (
        pr.get("user", {}).get("login") == KILO_LOGIN
        and pr.get("state") == "open"
        and is_same_repo(pr)
        and pr.get("base", {}).get("ref") == DEFAULT_BRANCH
        and "autonomy:kilo-implementation" in labels
        and "autonomy:repair" in labels
    )


def cto_issue_reference(pr: dict[str, Any]) -> int | None:
    """Return the single repository issue explicitly linked by a cto.new PR."""
    if pr.get("user", {}).get("login") != CTO_LOGIN or not is_same_repo(pr):
        return None
    body = str(pr.get("body") or "")
    patterns = (
        r"(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)",
        rf"https://github\.com/{re.escape(REPO)}/issues/(\d+)",
    )
    numbers: set[int] = set()
    for pattern in patterns:
        numbers.update(int(value) for value in re.findall(pattern, body, flags=re.IGNORECASE))
    return next(iter(numbers)) if len(numbers) == 1 else None


def verified_cto_task(pr: dict[str, Any]) -> int | None:
    """Require a real cto.new-assigned task, not a programme/checkpoint issue."""
    number = cto_issue_reference(pr)
    if number is None:
        return None
    issue = get(f"/repos/{REPO}/issues/{number}")
    if issue.get("pull_request") is not None:
        return None
    labels = issue_labels(issue)
    assignees = {str(item.get("login", "")) for item in issue.get("assignees", [])}
    if CTO_TASK_LABEL not in labels or CTO_LOGIN not in assignees:
        return None
    if issue.get("state") not in {"open", "closed"}:
        return None
    return number


def is_cto_implementation_identity(pr: dict[str, Any]) -> bool:
    labels = issue_labels(pr)
    return (
        pr.get("user", {}).get("login") == CTO_LOGIN
        and pr.get("state") == "open"
        and is_same_repo(pr)
        and pr.get("base", {}).get("ref") == DEFAULT_BRANCH
        and CTO_IMPLEMENTATION_LABEL in labels
    )


def adopt_linked_cto_prs(open_prs: list[dict[str, Any]]) -> None:
    """Adopt only cto.new PRs that prove linkage to an explicitly assigned task."""
    for pr in open_prs:
        if pr.get("user", {}).get("login") != CTO_LOGIN:
            continue
        if CTO_IMPLEMENTATION_LABEL in issue_labels(pr):
            continue
        task = verified_cto_task(pr)
        if task is None:
            log(f"cto.new PR #{pr['number']} has no single verified cto.new task; leaving it untrusted.")
            continue
        add_labels(int(pr["number"]), [CTO_IMPLEMENTATION_LABEL])
        log(f"Trusted cto.new implementation PR #{pr['number']} linked to task #{task}.")


def carrier_comments(number: int) -> list[dict[str, Any]]:
    comments: list[dict[str, Any]] = []
    for page in range(1, 11):
        chunk = get(f"/repos/{REPO}/issues/{number}/comments?per_page=100&page={page}")
        comments.extend(chunk)
        if len(chunk) < 100:
            return comments
    raise RuntimeError(f"PR #{number} has too many comments to verify safely")


def linked_kilo_carrier(pr: dict[str, Any], carriers: list[dict[str, Any]]) -> int | None:
    if pr.get("user", {}).get("login") != KILO_LOGIN or not is_same_repo(pr):
        return None
    pr_url = str(pr.get("html_url", ""))
    body = pr.get("body") or ""
    for carrier in carriers:
        carrier_url = str(carrier.get("html_url", ""))
        if carrier_url and re.search(re.escape(carrier_url) + URL_END, body):
            return int(carrier["number"])
        try:
            comments = carrier_comments(int(carrier["number"]))
        except ApiError as exc:
            log(f"Carrier #{carrier['number']} comments unavailable: {exc}")
            continue
        for item in comments:
            text = item.get("body") or ""
            if item.get("user", {}).get("login") == KILO_LOGIN and pr_url and re.search(re.escape(pr_url) + URL_END, text):
                return int(carrier["number"])
    return None


def linked_kilo_review_source(pr: dict[str, Any], sources: list[dict[str, Any]]) -> int | None:
    """Require the exact-head receipt and preserve the complete source PR history."""
    if pr.get("user", {}).get("login") != KILO_LOGIN or not is_same_repo(pr):
        return None
    body = pr.get("body") or ""
    for source in sources:
        if source.get("user", {}).get("login") == KILO_LOGIN or not is_same_repo(source):
            continue
        source_url = str(source.get("html_url", ""))
        sha = str(source.get("head", {}).get("sha", ""))
        if not source_url or not re.search(re.escape(source_url) + URL_END, body) or not sha:
            continue
        try:
            comments = carrier_comments(int(source["number"]))
        except ApiError as exc:
            log(f"Source PR #{source['number']} comments unavailable: {exc}")
            continue
        if not any(item.get("user", {}).get("login") == "github-actions[bot]" and
                   f"<!-- kilo-auto-repair:{sha}:" in (item.get("body") or "")
                   for item in comments):
            continue
        implementation_sha = str(pr.get("head", {}).get("sha", ""))
        if not re.fullmatch(r"[0-9a-f]{40}", sha) or not re.fullmatch(r"[0-9a-f]{40}", implementation_sha):
            continue
        comparison = get(f"/repos/{REPO}/compare/{sha}...{implementation_sha}")
        if comparison.get("behind_by") == 0 and comparison.get("status") in {"ahead", "identical"}:
            return int(source["number"])
        log(f"Kilo PR #{pr['number']} does not contain current source PR #{source['number']} head {sha[:12]}.")
    return None


def adopt_linked_kilo_prs(open_prs: list[dict[str, Any]]) -> None:
    carriers = [pr for pr in open_prs if is_carrier(pr)]
    for pr in open_prs:
        if pr.get("user", {}).get("login") != KILO_LOGIN:
            continue
        labels = issue_labels(pr)
        if "autonomy:kilo-implementation" in labels:
            continue
        source = linked_kilo_carrier(pr, carriers)
        if source is None:
            source = linked_kilo_review_source(pr, open_prs)
        if source is None:
            log(f"Kilo PR #{pr['number']} has no verified repair source; leaving it untrusted.")
            continue
        add_labels(int(pr["number"]), ["autonomy:repair", "autonomy:kilo-implementation"])
        log(f"Trusted Kilo implementation PR #{pr['number']} linked to source PR #{source}.")


def is_owner_codex_pr(pr: dict[str, Any]) -> bool:
    """Recognise owner-authored, same-repository Codex branches for trusted admission."""
    branch = str(pr.get("head", {}).get("ref", ""))
    return (
        pr.get("user", {}).get("login") == REPO.split("/", 1)[0]
        and pr.get("state") == "open"
        and not pr.get("draft")
        and is_same_repo(pr)
        and pr.get("base", {}).get("ref") == DEFAULT_BRANCH
        and branch.startswith("codex/")
        and BRANCH_PR_RE.fullmatch(branch) is not None
    )


def automation_kind(pr: dict[str, Any]) -> str | None:
    labels = issue_labels(pr)
    if is_renovate(pr):
        return "renovate"
    if is_owner_codex_pr(pr):
        return "codex"
    if is_managed_branch_pr(pr):
        return "branch-pr"
    if is_carrier(pr):
        return "carrier"
    if is_kilo_implementation_identity(pr):
        return "kilo"
    if is_cto_implementation_identity(pr):
        return "cto"
    return None


def current_pr_for_sha(open_prs: list[dict[str, Any]], sha: str) -> dict[str, Any] | None:
    matches = [pr for pr in open_prs if pr.get("head", {}).get("sha") == sha]
    eligible = [pr for pr in matches if automation_kind(pr)]
    return eligible[0] if len(eligible) == 1 else None


def admit_waiting_runs(open_prs: list[dict[str, Any]]) -> None:
    payload = get(f"/repos/{REPO}/actions/runs?status=action_required&per_page=100")
    runs = payload.get("workflow_runs", []) if isinstance(payload, dict) else []
    carriers = [source for source in open_prs if is_carrier(source)]
    for run in runs:
        sha = str(run.get("head_sha", ""))
        pr = current_pr_for_sha(open_prs, sha)
        if pr is None:
            continue
        kind = automation_kind(pr)
        if kind == "kilo" and (linked_kilo_carrier(pr, carriers) is None and
                                linked_kilo_review_source(pr, open_prs) is None):
            continue
        run_id = int(run["id"])
        name = str(run.get("name", "workflow"))
        try:
            post(f"/repos/{REPO}/actions/runs/{run_id}/approve", expected=(201,))
            log(f"Approved waiting {name} run {run_id} for trusted {kind} PR #{pr['number']}.")
            continue
        except ApiError as exc:
            if exc.status not in (403, 404, 409, 422):
                raise
            log(f"Approval endpoint did not accept run {run_id} ({exc.status}); trying safe rerun for the same trusted PR.")
        try:
            post(f"/repos/{REPO}/actions/runs/{run_id}/rerun", expected=(201,))
            log(f"Re-requested {name} run {run_id} for trusted {kind} PR #{pr['number']}.")
        except ApiError as exc:
            log(f"Could not automatically admit run {run_id}: {exc}")


def latest_runs_for_sha(sha: str) -> dict[str, dict[str, Any]]:
    query = urllib.parse.urlencode({"head_sha": sha, "event": "pull_request", "per_page": 100})
    payload = get(f"/repos/{REPO}/actions/runs?{query}")
    latest: dict[str, dict[str, Any]] = {}
    for run in payload.get("workflow_runs", []):
        name = str(run.get("name", ""))
        current = latest.get(name)
        if current is None or int(run.get("id", 0)) > int(current.get("id", 0)):
            latest[name] = run
    return latest


def all_required_checks_green(pr: dict[str, Any]) -> tuple[bool, str]:
    sha = str(pr.get("head", {}).get("sha", ""))
    runs = latest_runs_for_sha(sha)
    for name in REQUIRED_WORKFLOWS:
        run = runs.get(name)
        if run is None:
            return False, f"required workflow {name!r} has not run on {sha[:12]}"
        if run.get("status") != "completed" or run.get("conclusion") != "success":
            return False, f"required workflow {name!r} is {run.get('status')}/{run.get('conclusion')}"

    # GitHub native auto-merge and the repository ruleset evaluate any additional required contexts.
    # Optional review, link and external-service checks cannot become an extra gate here.
    return True, "all required exact-head workflows succeeded"


def pr_files(number: int) -> list[str]:
    names: list[str] = []
    for page in range(1, 11):
        chunk = get(f"/repos/{REPO}/pulls/{number}/files?per_page=100&page={page}")
        for item in chunk:
            names.append(str(item.get("filename", "")))
            previous = item.get("previous_filename")
            if previous:
                names.append(str(previous))
        if len(chunk) < 100:
            return list(dict.fromkeys(names))
    raise RuntimeError(f"PR #{number} has too many changed files to verify safely")


def sensitive_file(path: str) -> bool:
    """Return True for high-risk or unclassified paths; only explicit low-risk paths pass."""
    normalized = path.replace("\\", "/").removeprefix("./")
    folded = normalized.casefold()
    repo_name = REPO.rsplit("/", 1)[-1]
    basename = folded.rsplit("/", 1)[-1]
    if folded in {item.casefold() for item in KILO_SENSITIVE_EXACT}:
        return True
    if any(folded == prefix.casefold().rstrip("/") or folded.startswith(prefix.casefold())
           for prefix in KILO_SENSITIVE_PREFIXES + RISK_HIGH_RISK_PREFIXES):
        return True
    parts = folded.split("/")
    if any(part in RISK_HIGH_RISK_SEGMENTS for part in parts):
        return True
    if any(part in {"test", "tests", "e2e", "spec", "specs", "data"} for part in parts):
        return True
    if basename in RISK_HIGH_RISK_BASENAMES or basename.startswith(
        ("dockerfile.", "containerfile.", "requirements-")
    ):
        return True
    stem_tokens = re.split(r"[^a-z0-9]+", basename)
    if any(stem in token for token in stem_tokens for stem in RISK_HIGH_RISK_NAME_STEMS):
        return True
    if basename.endswith((".tf", ".tfvars", ".sql", ".prisma")):
        return True

    # Documentation is eligible only in its dedicated directory or the two
    # root-level project notes listed below.
    extension = "." + basename.rsplit(".", 1)[-1] if "." in basename else ""
    if folded in RISK_LOW_RISK_ROOT_FILES:
        return False
    if folded.startswith("docs/") and extension in RISK_LOW_RISK_DOC_EXTENSIONS:
        return False

    prefixes = RISK_LOW_RISK_PREFIXES_BY_REPO.get(repo_name, ())
    allowed_extensions = RISK_LOW_RISK_CODE_EXTENSIONS_BY_REPO.get(repo_name, set())
    if (
        allowed_extensions
        and extension in allowed_extensions
        and any(folded.startswith(prefix.casefold()) for prefix in prefixes)
    ):
        return False
    return True


def has_operator_risk_approval(number: int, sha: str) -> bool:
    """Require a repository-owner approval explicitly bound to this exact PR head."""
    owner_login = REPO.split("/", 1)[0]
    owner_reviews: list[dict[str, Any]] = []
    for page in range(1, 11):
        chunk = get(f"/repos/{REPO}/pulls/{number}/reviews?per_page=100&page={page}")
        if not isinstance(chunk, list):
            return False
        owner_reviews.extend(
            review for review in chunk
            if review.get("user", {}).get("login") == owner_login
            and review.get("state") != "PENDING"
        )
        if len(chunk) < 100:
            break
    else:
        raise RuntimeError(f"PR #{number} has too many review records to verify safely")

    def timestamp_order(item: dict[str, Any], key: str) -> float:
        value = item.get(key)
        if not isinstance(value, str) or not value:
            return float("-inf")
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return float("-inf")

    if any(timestamp_order(review, "submitted_at") == float("-inf") for review in owner_reviews):
        return False
    latest_review = max(
        owner_reviews,
        key=lambda review: timestamp_order(review, "submitted_at"),
        default=None,
    )
    latest_review_time = timestamp_order(latest_review, "submitted_at") if latest_review else None
    if (
        latest_review
        and latest_review.get("state") == "APPROVED"
        and latest_review.get("commit_id") == sha
    ):
        return True

    owner_comments: list[dict[str, Any]] = []
    for page in range(1, 11):
        chunk = get(f"/repos/{REPO}/issues/{number}/comments?per_page=100&page={page}")
        if not isinstance(chunk, list):
            return False
        owner_comments.extend(
            item for item in chunk
            if item.get("user", {}).get("login") == owner_login
            and str(item.get("body") or "").strip() == f"/risk-approve {sha}"
        )
        if len(chunk) < 100:
            break
    else:
        raise RuntimeError(f"PR #{number} has too many comments to verify safely")

    if any(timestamp_order(item, "created_at") == float("-inf") for item in owner_comments):
        return False
    latest_approval_comment = max(
        owner_comments,
        key=lambda item: timestamp_order(item, "created_at"),
        default=None,
    )
    if not latest_approval_comment:
        return False
    comment_time = timestamp_order(latest_approval_comment, "created_at")
    if comment_time == float("-inf"):
        return False
    return latest_review_time is None or comment_time > latest_review_time


def require_operator_risk_approval(pr: dict[str, Any], paths: list[str], kind: str) -> bool:
    """Hold high-risk autonomous changes until the repository owner approves the exact head SHA."""
    risky_paths = [path for path in paths if sensitive_file(path)]
    number = int(pr["number"])
    labels = issue_labels(pr)
    if not risky_paths:
        if RISK_APPROVAL_LABEL in labels:
            remove_label(number, RISK_APPROVAL_LABEL)
            log(f"Cleared stale risk approval hold for PR #{number}: its current diff has no high-risk paths.")
        return False
    sha = str(pr.get("head", {}).get("sha", ""))
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise RuntimeError(f"PR #{number} has no valid head SHA for risk approval")
    if has_operator_risk_approval(number, sha):
        if RISK_APPROVAL_LABEL in labels:
            remove_label(number, RISK_APPROVAL_LABEL)
            log(f"Cleared risk approval hold for PR #{number}: repository owner approved exact head {sha[:12]}.")
        return False
    if RISK_APPROVAL_LABEL not in labels:
        add_labels(number, [RISK_APPROVAL_LABEL])
        comment(
            number,
            f"Autonomous merge is paused for high-risk or unclassified changes. The repository owner must approve this exact head "
            f"SHA: submit an approving review, or comment `/risk-approve {sha}`. Any new commit requires fresh approval. "
            f"Paths: {', '.join(risky_paths[:8])}{f' … and {len(risky_paths) - 8} more' if len(risky_paths) > 8 else ''}",
        )
    if "autonomy:admitted" in labels:
        remove_label(number, "autonomy:admitted")
    log(f"PR #{number} ({kind}) is held for owner approval of exact head {sha[:12]}.")
    return True


def risk_policy_contract_test() -> None:
    """Keep the explicit low-risk allowlist and fail-closed default executable."""
    repo_name = REPO.rsplit("/", 1)[-1]
    low_risk_samples = {
        "AIMS": "routes/health-check.js",
        "AIMS-UI": "apps/portal/src/components/status.tsx",
        "HIVE": "backend/app/health_check.py",
        "HIVE-UI": "src/components/status.tsx",
        "IRS": "public/status.css",
        "RAMS": "docs/runbook.md",
        "MAST": "docs/runbook.md",
        "jonathan-harris-website": "blog/sample.md",
    }
    high_risk = (
        ".github/workflows/ci.yml", ".github/scripts/trusted_automation.py",
        "infra/main.tf", "backend/alembic/versions/001.sql",
        "src/auth/session.ts", "package-lock.json", "tests/test_auth.py",
        "unknown/README.txt", "unknown/README.md",
    )
    repo_high_risk_samples = {
        "AIMS": (
            "services/shared/middleware/suiteAuth.js",
            "services/comms-hub/domain/rbac.js",
            "services/comms-hub/domain/promptSecurity.js",
            "scripts/deployCommsHubDataPlaneWorker.js",
            "config/deployment-check.js",
        ),
        "AIMS-UI": ("workers/gateway/index.js", "workers/gateway/security.ts", "scripts/deploy-production.mjs"),
        "HIVE": ("requirements.in", "requirements-dev.txt", "backend/app/core/security.py"),
        "HIVE-UI": ("workers/gateway/security.ts", "src/lib/session.ts", "src/context/AuthContext.tsx"),
        "MAST": ("src/security.js",),
    }
    high_risk += repo_high_risk_samples.get(repo_name, ())
    low_risk = ("docs/runbook.md", "README.md")
    if repo_name in low_risk_samples:
        low_risk += (low_risk_samples[repo_name],)
    failed = [path for path in high_risk if not sensitive_file(path)]
    failed.extend(path for path in low_risk if sensitive_file(path))
    if failed:
        raise RuntimeError("Risk policy contract failed for: " + ", ".join(failed))

def place_human_hold(pr: dict[str, Any], reason: str) -> None:
    labels = issue_labels(pr)
    if "autonomy:human-hold" not in labels:
        add_labels(int(pr["number"]), ["autonomy:human-hold"])
        comment(int(pr["number"]), f"Trusted automation stopped here and applied `autonomy:human-hold`: {reason}")
    log(f"PR #{pr['number']} requires human review: {reason}")


def current_head_unchanged(number: int, expected_sha: str) -> dict[str, Any] | None:
    current = get(f"/repos/{REPO}/pulls/{number}")
    if current.get("state") != "open" or current.get("head", {}).get("sha") != expected_sha:
        return None
    return current


def has_current_approval(number: int, sha: str) -> bool:
    reviews = get(f"/repos/{REPO}/pulls/{number}/reviews?per_page=100")
    return any(r.get("state") == "APPROVED" and r.get("commit_id") == sha for r in reviews)


def approve_pr(number: int, sha: str) -> None:
    if has_current_approval(number, sha):
        return
    post(
        f"/repos/{REPO}/pulls/{number}/reviews",
        {
            "event": "APPROVE",
            "body": "Trusted automation approval: all required exact-head workflows passed.",
            "commit_id": sha,
        },
        expected=(200, 201),
    )
    log(f"Approved PR #{number} at {sha[:12]} after all required exact-head workflows passed.")


def admit_to_mergify(number: int, expected_sha: str) -> None:
    pr = get(f"/repos/{REPO}/pulls/{number}")
    if pr.get("state") != "open":
        return
    sha = str(pr.get("head", {}).get("sha", ""))
    if sha != expected_sha:
        log(f"PR #{number} head changed before admission evidence could be published.")
        return
    labels = issue_labels(pr)
    blocking_labels = {
        "autonomy:human-hold",
        RISK_APPROVAL_LABEL,
        "autonomy:council-freeze",
        "autonomy:superseded",
        "autonomy:obsolete",
        "do-not-merge",
        "needs-manual-review",
        "needs-human-review",
        "hold",
    }
    if labels.intersection(blocking_labels):
        if "autonomy:admitted" in labels:
            remove_label(number, "autonomy:admitted")
        log(f"PR #{number} has a blocking hold label; withholding admission.")
        return
    try:
        set_admission_check(
            number,
            expected_sha,
            "success",
            "The trusted default-branch workflow verified the PR identity, eligibility, exact-head CI/security checks, and current hold labels.",
        )
    except Exception:
        if "autonomy:admitted" in labels:
            remove_label(number, "autonomy:admitted")
        raise
    if "autonomy:admitted" not in labels:
        add_labels(number, ["autonomy:admitted"])
    VERIFIED_ADMISSION_HEADS.add((number, expected_sha))
    log(f"Admitted PR #{number} to GitHub native auto-merge after trusted exact-head verification.")

def reconcile_stale_carriers(open_prs: list[dict[str, Any]]) -> None:
    """Close verified retired carriers directly, without waiting for GitHub native auto-merge.

    Retired carrier branches are retained as failure evidence. Implementations
    and arbitrary PRs are never closed by this lifecycle reconciler.
    """
    branch = get(f"/repos/{REPO}/branches/{DEFAULT_BRANCH}")
    current_main_sha = str(branch.get("commit", {}).get("sha", ""))
    if not re.fullmatch(r"[0-9a-f]{40}", current_main_sha):
        raise RuntimeError("Could not resolve the current default-branch SHA")

    for pr in open_prs:
        if not is_repair_carrier_identity(pr):
            continue
        labels = issue_labels(pr)
        retired = bool(labels.intersection({"autonomy:superseded", "autonomy:obsolete"}))
        match = re.search(r"Failed commit:\s*`([0-9a-f]{40})`", str(pr.get("body") or ""))
        if not retired and (match is None or match.group(1) == current_main_sha):
            continue
        number = int(pr["number"])
        if not retired:
            add_labels(number, ["autonomy:obsolete"])
        request("PATCH", f"/repos/{REPO}/pulls/{number}", {"state": "closed"})
        # Close before removing active labels so a failed close remains retryable.
        for label in ("autonomy:human-hold", "autonomy:repair", "autonomy:admitted"):
            if label in labels:
                encoded = urllib.parse.quote(label, safe="")
                delete(f"/repos/{REPO}/issues/{number}/labels/{encoded}", expected=(200, 204))
        log(f"Closed retired repair carrier PR #{number}.")


def reconcile_retired_implementations(open_prs: list[dict[str, Any]]) -> None:
    """Close only verified retired implementation PR identities.

    This replaces GitHub native auto-merge Workflow Automation rules that are not enabled for
    this repository. Arbitrary labelled PRs are never closed.
    """
    for pr in open_prs:
        labels = issue_labels(pr)
        if not labels.intersection({"autonomy:superseded", "autonomy:obsolete"}):
            continue
        if not (is_managed_branch_identity(pr) or is_kilo_implementation_identity(pr) or is_cto_implementation_identity(pr)):
            continue
        number = int(pr["number"])
        request("PATCH", f"/repos/{REPO}/pulls/{number}", {"state": "closed"})
        if "autonomy:admitted" in labels:
            remove_label(number, "autonomy:admitted")
        log(f"Closed retired verified implementation PR #{number}.")


def refresh_behind_kilo_prs(open_prs: list[dict[str, Any]]) -> None:
    """Bring verified Kilo implementation branches up to the current base.

    The trusted repair App may update a branch but never merge it. Every update
    changes the head SHA and therefore forces the normal exact-head checks to
    run again before GitHub native auto-merge can admit a merge.
    """
    carriers = [source for source in open_prs if is_carrier(source)]
    base_sha = _resolve_branch_sha()

    for pr in open_prs:
        if not is_kilo_implementation_identity(pr) or pr.get("draft"):
            continue
        labels = issue_labels(pr)
        if labels.intersection(
            {"autonomy:human-hold", "autonomy:superseded", "autonomy:obsolete", COUNCIL_FREEZE_LABEL}
        ):
            continue
        if (linked_kilo_carrier(pr, carriers) is None and
                linked_kilo_review_source(pr, open_prs) is None):
            continue

        number = int(pr["number"])
        head_sha = str(pr.get("head", {}).get("sha", ""))
        if not re.fullmatch(r"[0-9a-f]{40}", head_sha):
            continue

        comparison = get(f"/repos/{REPO}/compare/{base_sha}...{head_sha}")
        if int(comparison.get("behind_by", 0)) <= 0:
            continue

        fresh = get(f"/repos/{REPO}/pulls/{number}")
        if (
            not is_kilo_implementation_identity(fresh)
            or fresh.get("draft")
            or str(fresh.get("head", {}).get("sha", "")) != head_sha
            or issue_labels(fresh).intersection(
                {"autonomy:human-hold", "autonomy:superseded", "autonomy:obsolete", COUNCIL_FREEZE_LABEL}
            )
        ):
            log(f"Kilo PR #{number} changed while base refresh was being evaluated; waiting.")
            continue

        # Fail closed on a moving base rather than updating against evidence
        # collected for a stale default-branch tip.
        if _resolve_branch_sha() != base_sha:
            log(f"Default branch moved while Kilo PR #{number} was being evaluated; waiting.")
            return

        try:
            request(
                "PUT",
                f"/repos/{REPO}/pulls/{number}/update-branch",
                {"expected_head_sha": head_sha},
                expected=(200, 202),
            )
        except ApiError as exc:
            if exc.status in (409, 422):
                log(f"Kilo PR #{number} could not be refreshed safely yet (HTTP {exc.status}); waiting.")
                continue
            raise

        if "autonomy:admitted" in labels:
            remove_label(number, "autonomy:admitted")
        log(f"Requested trusted base refresh for Kilo PR #{number} at {head_sha[:12]}.")


def _reconcile_pr_candidate(pr: dict[str, Any]) -> None:
    kind = automation_kind(pr)
    if kind is None or pr.get("draft"):
        return
    labels = issue_labels(pr)
    if labels.intersection({"autonomy:human-hold", "autonomy:superseded", "autonomy:obsolete"}):
        return
    if kind == "carrier":
        # Carriers record the failed run and remain blocked until the linked
        # implementation succeeds. Never merge one just because its marker was removed.
        log(f"Carrier PR #{pr['number']} is lifecycle evidence; withholding auto-merge.")
        return

    if kind == "renovate" and not renovate_auto_eligible(pr):
        # Renovate eligibility is explicit metadata; manual/unlabelled updates remain human merge decisions.
        return

    if kind in {"renovate", "branch-pr", "codex"}:
        frozen, freeze_reason = council_evidence_freeze()
        number = int(pr["number"])
        if frozen:
            if "autonomy:admitted" in labels:
                remove_label(number, "autonomy:admitted")
            if COUNCIL_FREEZE_LABEL not in labels:
                add_labels(number, [COUNCIL_FREEZE_LABEL])
            log(f"PR #{number} ({kind}) held by Council evidence freeze: {freeze_reason}.")
            return
        if COUNCIL_FREEZE_LABEL in labels:
            remove_label(number, COUNCIL_FREEZE_LABEL)
            log(f"PR #{number} ({kind}) released from Council evidence freeze: {freeze_reason}.")

    if kind in {"kilo", "cto", "branch-pr", "renovate", "codex"}:
        number = int(pr["number"])
        changed_paths = pr_files(number)
        if require_operator_risk_approval(pr, changed_paths, kind):
            return

    if kind == "cto" and verified_cto_task(pr) is None:
        log(f"cto.new PR #{pr['number']} no longer has a verified assigned task; withholding merge.")
        return

    if kind == "kilo":
        carriers = [source for source in list_open_prs() if is_carrier(source)]
        if (linked_kilo_carrier(pr, carriers) is None and
                linked_kilo_review_source(pr, list_open_prs()) is None):
            log(f"Kilo PR #{pr['number']} no longer has a current verified source; withholding merge.")
            return

    green, reason = all_required_checks_green(pr)
    if not green:
        log(f"PR #{pr['number']} ({kind}) not ready: {reason}.")
        return

    number = int(pr["number"])
    sha = str(pr.get("head", {}).get("sha", ""))
    current = current_head_unchanged(number, sha)
    if current is None:
        log(f"PR #{number} changed while being evaluated; waiting for the next reconciliation.")
        return

    # Renovate and Kilo are distinct identities, so the repair App can provide the trusted review.
    # Carrier PRs are authored by the same repair App and GitHub correctly forbids self-approval.
    if kind in {"renovate", "kilo", "cto"}:
        approve_pr(number, sha)
        if current_head_unchanged(number, sha) is None:
            return

    admit_to_mergify(number, sha)


def reconcile_pr(pr: dict[str, Any]) -> None:
    number = int(pr["number"])
    sha = str(pr.get("head", {}).get("sha", ""))
    key = (number, sha)
    VERIFIED_ADMISSION_HEADS.discard(key)
    try:
        _reconcile_pr_candidate(pr)
    finally:
        labels = issue_labels(pr)
        if not os.environ.get("ADMISSION_TOKEN"):
            # Fail closed in local tests or misconfigured runs; production workflows supply this token.
            if "autonomy:admitted" in labels:
                remove_label(number, "autonomy:admitted")
        elif key not in VERIFIED_ADMISSION_HEADS:
            try:
                set_admission_check(
                    number,
                    sha,
                    "failure",
                    "Trusted automation did not verify this PR as eligible for autonomous merging. A label alone cannot grant admission.",
                    create_if_missing="autonomy:admitted" in labels,
                )
            finally:
                if "autonomy:admitted" in labels:
                    remove_label(number, "autonomy:admitted")


def main() -> int:
    risk_policy_contract_test()
    if not REQUIRED_WORKFLOWS:
        raise RuntimeError("REQUIRED_WORKFLOWS must list the repository's CI/security workflow names")
    if not re.fullmatch(r"[A-Za-z0-9-]+\[bot\]", REPAIR_APP_LOGIN):
        raise RuntimeError("REPAIR_APP_LOGIN must be the installed repair GitHub App bot login")
    if (not re.fullmatch(r"[A-Za-z0-9-]+(?:\[bot\])?", KILO_LOGIN) or
            KILO_LOGIN in {REPAIR_APP_LOGIN, RENOVATE_LOGIN, "github-actions[bot]"}):
        raise RuntimeError("KILO_REPAIR_PR_LOGIN must name the distinct, verified Kilo PR creator")
    if (not re.fullmatch(r"[A-Za-z0-9-]+(?:\[bot\])?", CTO_LOGIN) or
            CTO_LOGIN in {REPAIR_APP_LOGIN, RENOVATE_LOGIN, KILO_LOGIN, "github-actions[bot]"}):
        raise RuntimeError("CTO_NEW_PR_LOGIN must name the distinct, verified cto.new PR creator")
    ensure_label("dependency:auto-eligible", "0E8A16", "Renovate update class is eligible for trusted admission after exact-head gates")
    ensure_label("dependency:manual", "FBCA04", "Renovate update class requires a human merge decision")
    ensure_label("autonomy:kilo-implementation", "5319E7", "Kilo implementation PR linked to an autonomous repair carrier")
    ensure_label(CTO_TASK_LABEL, "1D76DB", "Actionable engineering task explicitly assigned to cto.new")
    ensure_label(CTO_IMPLEMENTATION_LABEL, "5319E7", "cto.new implementation PR linked to an explicitly assigned task")
    ensure_label("autonomy:human-hold", "FBCA04", "Automation must stop for human action")
    ensure_label(RISK_APPROVAL_LABEL, "FBCA04", "High-risk or unclassified autonomous changes require exact-head owner approval")
    ensure_label("autonomy:obsolete", "D4C5F9", "Repair carrier is no longer current")
    ensure_label("autonomy:admitted", "0E8A16", "Exact-head CI/security verification complete; GitHub native auto-merge may merge")
    ensure_label(COUNCIL_FREEZE_LABEL, "D93F0B", "Routine merge held after weekend CI PASS until Council completes on the same SHA")

    open_prs = list_open_prs()
    reconcile_stale_carriers(open_prs)
    open_prs = list_open_prs()  # refresh after stale-carrier lifecycle changes
    adopt_linked_kilo_prs(open_prs)
    open_prs = list_open_prs()  # refresh labels after Kilo correlation
    adopt_linked_cto_prs(open_prs)
    open_prs = list_open_prs()  # refresh labels after cto.new task correlation
    reconcile_retired_implementations(open_prs)
    open_prs = list_open_prs()  # refresh after trusted retirement
    refresh_behind_kilo_prs(open_prs)
    open_prs = list_open_prs()  # refresh heads/labels after any accepted base update
    admit_waiting_runs(open_prs)

    # Reconcile current trusted PRs. Runs admitted above will normally become ready on a later
    # workflow_run completion or scheduled reconciliation.
    for pr in open_prs:
        if automation_kind(pr) is not None or "autonomy:admitted" in issue_labels(pr):
            reconcile_pr(pr)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"::error::{exc}", file=sys.stderr)
        raise
