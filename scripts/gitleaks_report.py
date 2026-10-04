"""Publish Gitleaks location metadata without copying secrets or source matches."""
import argparse
import html
import json
from pathlib import Path
import re
from urllib.parse import quote


def render(source, destination, repository):
    destination.mkdir(parents=True, exist_ok=True)
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", repository):
        raise ValueError("Invalid repository identifier")
    try:
        findings = json.loads(source.read_text())
        if not isinstance(findings, list) or any(not isinstance(x, dict) for x in findings):
            raise ValueError("Invalid scanner report structure")
    except (OSError, ValueError):
        (destination / "findings.md").write_text(
            "# Gitleaks report unavailable\n\nThe scanner did not produce a valid report. "
            "This is an operational failure, not a clean scan. Inspect the Gitleaks step.\n")
        raise ValueError("Gitleaks report missing or invalid") from None
    fields = ("RuleID", "File", "StartLine", "EndLine", "Commit", "Fingerprint")
    rows = [{key: item.get(key, "") for key in fields} for item in findings]
    (destination / "findings.json").write_text(json.dumps(rows, indent=2) + "\n")
    def cell(value):
        return html.escape(str(value)).replace("|", "&#124;").replace("`", "&#96;").replace("\n", " ").replace("\r", " ")
    lines = ["# AIMS Gitleaks history findings", "", f"{len(rows)} detected occurrences; values and matching source text are withheld.", "",
             "A match is not proof of a live credential. Review the linked historical source for fixtures, placeholders or actual credentials. "
             "Revoke/rotate genuine credentials; deleting current source alone does not revoke them. No findings are suppressed by this report.", "",
             "| Rule | File | Lines | Commit | Historical source |", "|---|---|---|---|---|"]
    for row in rows:
        commit = str(row["Commit"])
        line = row["StartLine"]
        link = "Unavailable"
        if re.fullmatch(r"[a-fA-F0-9]{40}", commit) and isinstance(line, int) and line > 0:
            path = quote(str(row["File"]), safe="/")
            link = f"[Review source](https://github.com/{repository}/blob/{commit}/{path}#L{line})"
        lines.append(f"| {cell(row['RuleID'])} | {cell(row['File'])} | {cell(line)}–{cell(row['EndLine'])} | {cell(commit[:12])} | {link} |")
    output = "\n".join(lines) + "\n"
    (destination / "findings.md").write_text(output)
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("repository")
    args = parser.parse_args()
    print(render(args.source, args.destination, args.repository))
