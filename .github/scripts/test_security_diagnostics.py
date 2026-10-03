"""Regression tests for actionable, secret-free diagnostic evidence."""
import importlib.util
import csv
import subprocess
import json
import os
from unittest.mock import patch
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).parent

def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

security = load('security_diagnostics')
failure = load('failure_diagnostics')

class Diagnostics(unittest.TestCase):
    def test_secret_and_match_are_never_published(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw = root / 'raw'
            raw.mkdir()
            (raw / 'gitleaks.json').write_text(json.dumps([{
                'RuleID': 'generic-api-key', 'File': 'fixtures/example.py', 'StartLine': 12, 'EndLine': 12,
                'Commit': 'a' * 40, 'Fingerprint': 'a' * 40 + ':fixtures/example.py:generic-api-key:12',
                'Secret': 'DO_NOT_PUBLISH_THIS_VALUE', 'Match': 'DO_NOT_PUBLISH_THIS_MATCH',
                'Author': 'DO_NOT_PUBLISH_THIS_AUTHOR', 'Message': 'DO_NOT_PUBLISH_THIS_MESSAGE',
            }]))
            (raw / 'trivy.json').write_text(json.dumps({'Metadata': {'Credential': 'DO_NOT_PUBLISH_METADATA'}, 'Results': [{
                'Target': 'requirements.txt', 'Vulnerabilities': [{
                    'VulnerabilityID': 'CVE-example', 'Severity': 'HIGH', 'PkgName': 'example',
                    'InstalledVersion': '1', 'FixedVersion': '2', 'Secret': 'DO_NOT_PUBLISH_NESTED',
                }],
            }]}))
            out = root / 'out'
            text = security.render(out, {'gitleaks': {'outcome': 'failure', 'outputs': {'token': 'DO_NOT_PUBLISH_STEP_OUTPUT'}}}, 'owner/repo', 'https://github.com/owner/repo/actions/runs/1', raw)
            for p in out.iterdir():
                self.assertNotIn('DO_NOT_PUBLISH', p.read_text())
            self.assertIn('/blob/' + 'a' * 40 + '/fixtures/example.py#L12', text)
            self.assertIn('CVE-example', text)
            self.assertIn('| 1 | 2 |', text)

    def test_absent_report_is_not_clean_scan(self):
        with tempfile.TemporaryDirectory() as directory:
            text = security.render(Path(directory) / 'out', {'gitleaks': {'outcome': 'skipped'}}, 'owner/repo', 'run', Path(directory))
            self.assertIn('No report was produced', text)
            self.assertNotIn('**0 potential secret', text)

    def test_invalid_report_is_operational_error(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'gitleaks.json'
            path.write_text('not json')
            self.assertIn('operational', security.read_report(path, list)[1])
            path.write_text('{}')
            self.assertIn('unexpected structure', security.read_report(path, list)[1])

    def test_workflow_metadata_cannot_inject_markdown(self):
        self.assertEqual(security.cell('<img>|`x`\nnext'), '&lt;img&gt;&#124;&#96;x&#96; next')

    def test_failed_jobs_and_steps_are_linked(self):
        run = {'id': 123, 'name': 'Production CI', 'conclusion': 'failure', 'head_sha': 'b' * 40, 'run_attempt': 2}
        jobs = [{'id': 456, 'name': 'Build', 'conclusion': 'failure', 'steps': [
            {'name': 'Checkout', 'conclusion': 'success'}, {'name': 'Compile', 'conclusion': 'failure'},
        ]}]
        text = failure.render('owner/repo', run, jobs, [{'id': 789, 'name': 'security-diagnostics', 'expired': False}])
        self.assertIn('Compile', text)
        self.assertIn('/actions/runs/123/job/456', text)
        self.assertIn('/actions/runs/123/artifacts/789', text)
        self.assertIn('attempt: 2', text)
        self.assertNotIn('| Checkout', text)

    def test_cancellation_without_jobs_has_explanation(self):
        text = failure.render('owner/repo', {'id': 1, 'conclusion': 'cancelled'}, [], [])
        self.assertIn('cancelled before jobs started', text)

    def test_trivy_misconfig_omits_source_code(self):
        rows = security.trivy_findings({'Results': [{'Target': 'Dockerfile', 'Misconfigurations': [{
            'ID': 'AVD-example', 'Severity': 'HIGH', 'Status': 'FAIL', 'Resolution': 'Use a non-root user',
            'CauseMetadata': {'StartLine': 3, 'EndLine': 5, 'Code': {'Lines': ['DO_NOT_PUBLISH_SOURCE']}},
        }]}]})
        self.assertNotIn('DO_NOT_PUBLISH', json.dumps(rows))
        self.assertEqual(rows[0]['StartLine'], 3)

    def test_lint_report_excludes_snippet_and_message(self):
        rows = security.actionlint_findings([{
            'filepath': '.github/workflows/ci.yml', 'line': 12, 'column': 9,
            'message': 'SC2086: DO_NOT_PUBLISH_MESSAGE', 'snippet': 'DO_NOT_PUBLISH_SOURCE', 'kind': 'shellcheck',
        }])
        self.assertNotIn('DO_NOT_PUBLISH', json.dumps(rows))
        self.assertEqual(rows[0]['Rule'], 'SC2086')
        self.assertIn('Quote expansions', rows[0]['Guidance'])

    def test_success_without_evidence_fails_reporting(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = {
                'SECURITY_STEPS': json.dumps({'gitleaks': {'outcome': 'success'}}),
                'GITHUB_REPOSITORY': 'owner/repo', 'GITHUB_RUN_ID': '1',
                'REPORT_DIR': str(root / 'out'), 'RAW_REPORT_DIR': str(root / 'raw'),
                'GITHUB_STEP_SUMMARY': str(root / 'summary.md'),
            }
            with patch.dict(os.environ, env):
                with self.assertRaises(RuntimeError):
                    security.main()
            self.assertIn('No report was produced', (root / 'summary.md').read_text())

    def test_unavailable_json_is_distinct_from_zero_findings(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            security.render(root / 'missing', {}, 'owner/repo', 'run', root / 'raw')
            self.assertIsNone(json.loads((root / 'missing/gitleaks-findings.json').read_text()))
            status = json.loads((root / 'missing/report-status.json').read_text())
            self.assertFalse(status['gitleaks']['available'])
            self.assertIsNone(status['gitleaks']['finding_count'])
            raw = root / 'raw'
            raw.mkdir()
            (raw / 'gitleaks.json').write_text('[]')
            security.render(root / 'clean', {}, 'owner/repo', 'run', raw)
            self.assertEqual(json.loads((root / 'clean/gitleaks-findings.json').read_text()), [])
            self.assertEqual(json.loads((root / 'clean/report-status.json').read_text())['gitleaks']['finding_count'], 0)

    def test_csv_keeps_all_findings_and_neutralises_formulas(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rows = [{'File': '=FORMULA()', 'StartLine': n} for n in range(125)]
            security.write_evidence(root, 'findings', rows, ('File', 'StartLine'), None)
            with (root / 'findings.csv').open() as stream:
                records = list(csv.DictReader(stream))
            self.assertEqual(len(records), 125)
            self.assertEqual(records[0]['File'], "'=FORMULA()")
            self.assertEqual(json.loads((root / 'findings.json').read_text())[0]['File'], '=FORMULA()')

    def test_real_actionlint_json_array_format_is_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'actionlint.json'
            path.write_text(json.dumps([{'filepath': '.github/workflows/ci.yml', 'line': 4, 'column': 2, 'kind': 'syntax-check', 'message': 'unknown key'}, {'filepath': '.github/workflows/ci.yml', 'line': 8, 'column': 3, 'kind': 'shellcheck', 'message': 'SC2086: quote expansion'}]))
            data, error = security.read_report(path, list)
            self.assertIsNone(error)
            self.assertEqual(len(security.actionlint_findings(data)), 2)

    def test_final_gate_rejects_every_preliminary_failure(self):
        text = (ROOT.parent / 'workflows/security.yml').read_text()
        gate = text.split("        python3 - <<'PYCODE'\n", 1)[1].split('        PYCODE', 1)[0]
        gate = "python3 - <<'PYCODE'\n" + '\n'.join(line[8:] for line in gate.splitlines()) + '\nPYCODE'
        names = ('gitleaks', 'trivy', 'actionlint', 'secret_policy', 'security_tests', 'autonomy_tests', 'gitleaks_selftest')
        outcomes = {name: {'outcome': 'success'} for name in names}
        for name in names:
            failed = {**outcomes, name: {'outcome': 'failure'}}
            result = subprocess.run(['bash', '-c', gate], env={**os.environ, 'SECURITY_STEPS': json.dumps(failed)}, capture_output=True)
            self.assertNotEqual(result.returncode, 0, name)
        result = subprocess.run(['bash', '-c', gate], env={**os.environ, 'SECURITY_STEPS': json.dumps(outcomes)}, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)

if __name__ == '__main__':
    unittest.main()
