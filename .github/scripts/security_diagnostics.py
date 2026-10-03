"""Publish metadata-only scanner evidence without copying matches or credentials."""
import html
import csv
import json
import os
from pathlib import Path
import re
from urllib.parse import quote


def cell(value):
    return html.escape(str(value)).replace('[', '&#91;').replace(']', '&#93;').replace('|', '&#124;').replace('\n', ' ').replace('\r', ' ').replace('`', '&#96;')


def read_report(path, expected):
    if not path.is_file():
        return None, 'No report was produced; inspect the scanner step for installation, execution or cancellation errors.'
    try:
        data = json.loads(path.read_text())
    except (ValueError, OSError):
        return None, 'Report is unreadable or invalid JSON; this is an operational reporting error.'
    if not isinstance(data, expected):
        return None, 'Report has an unexpected structure; this is an operational reporting error.'
    return data, None


def gitleaks_findings(data):
    fields = ('RuleID', 'File', 'StartLine', 'EndLine', 'Commit', 'Fingerprint')
    return [{key: item.get(key, '') for key in fields} for item in data if isinstance(item, dict)]


def trivy_findings(data):
    findings = []
    for result in data.get('Results') or []:
        for item in result.get('Vulnerabilities') or []:
            findings.append({
                'Kind': 'Vulnerability', 'Target': result.get('Target', ''),
                'ID': item.get('VulnerabilityID', ''), 'Severity': item.get('Severity', ''),
                'Package': item.get('PkgName', ''), 'Installed': item.get('InstalledVersion', ''),
                'Fixed': item.get('FixedVersion') or 'No published fix',
            })
        for item in result.get('Misconfigurations') or []:
            if item.get('Status') not in (None, 'FAIL'):
                continue
            location = item.get('CauseMetadata') or {}
            findings.append({
                'Kind': 'Misconfiguration', 'Target': result.get('Target', ''),
                'ID': item.get('ID', ''), 'Severity': item.get('Severity', ''),
                'StartLine': location.get('StartLine', ''), 'EndLine': location.get('EndLine', ''),
                'Resolution': item.get('Resolution', ''),
            })
    return findings


def actionlint_findings(data):
    notes = {
        'SC2086': 'Quote expansions to prevent word splitting and globbing.',
        'SC2034': 'Remove or use the unused variable.',
        'SC2155': 'Declare and assign separately so failures remain visible.',
        'SC2016': 'Check whether literal text or shell interpolation is intended.',
        'SC2129': 'Combine repeated redirects where appropriate.',
    }
    rows = []
    for item in data or []:
        rule = re.search(r'SC[0-9]{4}', item.get('message', ''))
        rule = rule.group(0) if rule else str(item.get('kind', 'workflow-lint'))
        rows.append({
            'File': item.get('filepath', ''), 'Line': item.get('line', ''),
            'Column': item.get('column', ''), 'Rule': rule,
            'Guidance': notes.get(rule, 'Open the workflow lint step for the full error; check the workflow syntax or expression.'),
        })
    return rows


def source_link(repo, finding):
    commit = str(finding.get('Commit', ''))
    if not re.fullmatch('[0-9a-fA-F]{40}', commit):
        return cell(finding.get('File', ''))
    path = quote(str(finding.get('File', '')), safe='/')
    line = finding.get('StartLine', 1)
    anchor = f'#L{line}' if isinstance(line, int) and line > 0 else ''
    return f'[{cell(finding.get("File", ""))}](https://github.com/{repo}/blob/{commit}/{path}{anchor})'


def write_evidence(report_dir, name, rows, fields, error):
    # null means unavailable evidence; [] means a valid scan with no findings.
    (report_dir / (name + '.json')).write_text(json.dumps(None if error else rows, indent=2) + '\n')
    with (report_dir / (name + '.csv')).open('w', newline='') as output:
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            # Treat scanner metadata as text, including when opened in a spreadsheet.
            safe = {k: ("'" + str(v) if str(v).lstrip().startswith(('=', '+', '-', '@')) else v) for k, v in row.items()}
            writer.writerow(safe)


def render(report_dir, steps, repo, run_url, raw_dir):
    report_dir.mkdir(parents=True, exist_ok=True)
    report_status = {}
    lines = ['# Security findings and deployment blockers', '', f'[Open this workflow run]({run_url})', '',
             '## Check outcomes', '', '| Check | Outcome | Meaning |', '|---|---|---|']
    labels = {'gitleaks': 'Gitleaks', 'trivy': 'Trivy', 'actionlint': 'Workflow lint',
              'secret_policy': 'Repository secret policy', 'security_tests': 'Diagnostic regression tests',
              'install_security_tools': 'Scanner installation', 'autonomy_tests': 'Autonomy regression tests',
              'gitleaks_selftest': 'Gitleaks detector self-test'}
    for key, label in labels.items():
        if key not in steps:
            continue
        outcome = steps[key].get('outcome', 'unknown')
        meaning = 'Passed' if outcome == 'success' else ('Not run; inspect earlier failed steps' if outcome == 'skipped' else 'Blocks this check; details below or in the named step')
        lines.append(f'| {label} | {cell(outcome)} | {meaning} |')
    lines += ['', '## Gitleaks', '', 'Potential findings need review; a detector match alone does not establish a genuine credential.']
    data, error = read_report(raw_dir / 'gitleaks.json', list)
    findings = gitleaks_findings(data) if data is not None else []
    write_evidence(report_dir, 'gitleaks-findings', findings, ('RuleID', 'File', 'StartLine', 'EndLine', 'Commit', 'Fingerprint'), error)
    report_status['gitleaks'] = {'available': error is None, 'error': error, 'finding_count': None if error else len(findings)}
    if error:
        lines += ['', error]
    else:
        lines += ['', f'**{len(findings)} potential secret occurrences.** Secret and matching source text are omitted.', '',
                  '| Rule | File at detected commit | Lines | Commit | Fingerprint |', '|---|---|---|---|---|']
        for f in findings[:100]:
            lines.append(f'| {cell(f["RuleID"])} | {source_link(repo, f)} | {cell(f["StartLine"])}–{cell(f["EndLine"])} | {cell(str(f["Commit"])[:12])} | {cell(f["Fingerprint"])} |')
        if len(findings) > 100:
            lines += ['', 'First 100 shown; download the artifact for every occurrence.']
    lines += ['', '### How to decide', '',
              '- Open the linked file **at the detected commit**. Full-history scans can find material already removed from the current branch.',
              '- Check whether it is a credential, a documented example, a synthetic fixture or a detector false positive. The report never includes the secret itself.',
              '- If genuine, revoke/rotate it with its provider and remove it from current source. Removal alone does not invalidate a historical credential.',
              '- For a confirmed false positive, record the rule, path, commit/fingerprint and reason in a reviewed change. Do not disable the detector or broadly ignore a directory.',
              '', '## Trivy', '']
    data, error = read_report(raw_dir / 'trivy.json', dict)
    vulnerabilities = trivy_findings(data) if data is not None else []
    write_evidence(report_dir, 'trivy-findings', vulnerabilities, ('Kind', 'Target', 'ID', 'Severity', 'Package', 'Installed', 'Fixed', 'StartLine', 'EndLine', 'Resolution'), error)
    report_status['trivy'] = {'available': error is None, 'error': error, 'finding_count': None if error else len(vulnerabilities)}
    if error:
        lines.append(error)
    else:
        lines += [f'**{len(vulnerabilities)} vulnerability/misconfiguration findings.**', '',
                  '| Type / ID | Severity | Target | Package / lines | Installed | Fix / resolution |', '|---|---|---|---|---|---|']
        for f in vulnerabilities[:100]:
            location = f.get('Package') or f'{f.get("StartLine", "")}–{f.get("EndLine", "")}'
            lines.append(
                f'| {cell(f["Kind"])} / {cell(f["ID"])} | {cell(f["Severity"])} | {cell(f["Target"])} | '
                f'{cell(location)} | {cell(f.get("Installed", ""))} | '
                f'{cell(f.get("Fixed") or f.get("Resolution", ""))} |'
            )
        if len(vulnerabilities) > 100:
            lines += ['', 'First 100 shown; download the artifact for every finding.']
    lines += ['', '## Workflow lint', '']
    data, error = read_report(raw_dir / 'actionlint.json', list)
    lint = actionlint_findings(data) if data is not None else []
    write_evidence(report_dir, 'workflow-lint-findings', lint, ('File', 'Line', 'Column', 'Rule', 'Guidance'), error)
    report_status['actionlint'] = {'available': error is None, 'error': error, 'finding_count': None if error else len(lint)}
    if error:
        lines.append(error)
    else:
        lines += [f'**{len(lint)} workflow lint findings.**', '',
                  '| File | Line / column | Rule | Guidance |', '|---|---|---|---|']
        for item in lint[:100]:
            lines.append(
                f'| {cell(item["File"])} | {cell(item["Line"])} / {cell(item["Column"])} | '
                f'{cell(item["Rule"])} | {cell(item["Guidance"])} |'
            )
    if 'secret_policy' in steps:
        lines += ['', '## Repository secret policy', '']
        data, error = read_report(raw_dir / 'secret-policy.json', list)
        policy = [{'LocationAndReason': item} for item in (data or []) if isinstance(item, str)]
        write_evidence(report_dir, 'secret-policy-findings', policy, ('LocationAndReason',), error)
        report_status['secret_policy'] = {'available': error is None, 'error': error, 'finding_count': None if error else len(policy)}
        if error:
            lines.append(error)
        else:
            lines += [f'**{len(policy)} repository policy findings.**', '', '| File / line / reason |', '|---|']
            lines.extend('| ' + cell(item['LocationAndReason']) + ' |' for item in policy[:100])
    lines += ['', '## Other failures', '',

              'Workflow lint and repository-policy errors remain in their named step logs with file/line details. A missing report is never presented as a clean scan.',
              'The separate **Deployment failure diagnostics** workflow lists failed/cancelled jobs and steps for completed workflow runs after it is installed on the default branch.',
              '', 'Download **security-diagnostics** from this run’s Artifacts section for the Markdown report, CSV tables and metadata-only JSON. Check report-status.json before interpreting an empty table.']
    (report_dir / 'report-status.json').write_text(json.dumps(report_status, indent=2) + '\n')
    result = '\n'.join(lines) + '\n'
    (report_dir / 'security-findings.md').write_text(result)
    outcomes = {name: {key: step.get(key) for key in ('outcome', 'conclusion')} for name, step in steps.items()}
    (report_dir / 'check-outcomes.json').write_text(json.dumps(outcomes, indent=2) + '\n')
    return result


def main():
    steps = json.loads(os.environ.get('SECURITY_STEPS', '{}'))
    repo = os.environ['GITHUB_REPOSITORY']
    run_url = f'https://github.com/{repo}/actions/runs/{os.environ["GITHUB_RUN_ID"]}'
    text = render(Path(os.environ['REPORT_DIR']), steps, repo, run_url, Path(os.environ['RAW_REPORT_DIR']))
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
        summary.write(text)
    for scanner, kind in (('gitleaks', list), ('trivy', dict), ('actionlint', list)):
        if steps.get(scanner, {}).get('outcome') == 'success':
            _, error = read_report(Path(os.environ['RAW_REPORT_DIR']) / (scanner + '.json'), kind)
            if error:
                raise RuntimeError(scanner + ': ' + error)


if __name__ == '__main__':
    main()
