import contextlib
import copy
import io
import json
import unittest
import urllib.error
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import comms_worker_watch as watch
import ops_notify
from datetime import UTC, datetime, timedelta
from comms_worker_watch import advance_incident, check_health, check_health_file, production_monitor_config, validate_health


class WorkerWatchTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 3, 2, 0, tzinfo=UTC)
        self.revision = 'a' * 40
        self.payload = {'ok': True, 'service': 'comms-hub', 'health': {'overall': 'healthy', 'revision': self.revision, 'checkedAt': self.now.isoformat(),
            'enabledWorkers': 1, 'workers': [{'category': 'delayed_actions', 'key': 'default', 'enabled': True,
                                           'status': 'healthy', 'ageMs': 1000, 'degradedAfterMs': 600000}]}}
        self.expected = ['delayed_actions:default']

    def test_production_monitor_config_uses_repo_owned_app_url_and_flags(self):
        url, expected = production_monitor_config({
            'APP_URL': 'https://aims.example/',
            'COMMS_HUB_ZERNIO_POLL_ENABLED': 'true',
            'COMMS_HUB_ZERNIO_META_ENABLED': 'true',
            'COMMS_HUB_ZERNIO_WEBHOOK_RECONCILE_ENABLED': 'true',
            'COMMS_HUB_DELAYED_ACTION_WORKER_ENABLED': 'true',
            'COMMS_HUB_EMAIL_ARCHIVE_ENABLED': 'true',
            'COMMS_HUB_BACKUP_ENABLED': 'true',
            'COMMS_HUB_BACKUP_AUTOMATIC_ENABLED': 'true',
            'COMMS_HUB_RETENTION_WORKER_ENABLED': 'true',
            'COMMS_HUB_MONTH_END_ARCHIVE_ENABLED': 'true',
            'COMMS_HUB_HOUSEKEEPING_ENABLED': 'true',
            'COMMS_HUB_HOUSEKEEPING_WORKER_ENABLED': 'true',
            'COMMS_HUB_EMAIL_ENABLED': 'true',
            'COMMS_HUB_EMAIL_POLL_WORKER_ENABLED': 'true',
        })
        self.assertEqual(url, 'https://aims.example/comms-hub/workers/health')
        self.assertEqual(expected, [
            'social_poll:default', 'delayed_actions:default', 'archive:default',
            'webhook_reconcile:default', 'backup:default', 'retention:default',
            'month_end_archive:default', 'housekeeping:default', 'inbound_email:info',
        ])

    def test_production_monitor_config_rejects_invalid_base_or_empty_inventory(self):
        with self.assertRaises(ValueError):
            production_monitor_config({'APP_URL': 'http://aims.example', 'COMMS_HUB_DELAYED_ACTION_WORKER_ENABLED': 'true'})
        with self.assertRaises(ValueError):
            production_monitor_config({'APP_URL': 'https://aims.example'})

    def test_inventory_and_health(self):
        self.assertIsNone(validate_health(self.payload, self.expected, self.now, self.revision))
        for mutate in [lambda p: p['health'].update(workers=[]), lambda p: p['health'].update(overall='stale'),
                       lambda p: p['health'].update(checkedAt='invalid'), lambda p: p['health']['workers'][0].update(status='degraded'),
                       lambda p: p['health']['workers'][0].update(ageMs=float('nan'))]:
            payload = copy.deepcopy(self.payload)
            mutate(payload)
            self.assertIsNotNone(validate_health(payload, self.expected, self.now, self.revision))
        self.assertIsNotNone(validate_health(self.payload, ['inbound_email:missing'], self.now, self.revision))
        self.assertIsNotNone(validate_health(self.payload, [], self.now, self.revision))

    def test_health_requires_exact_expected_service_revision(self):
        self.assertEqual(validate_health(self.payload, self.expected, self.now), 'service_revision_missing')
        self.assertEqual(validate_health(self.payload, self.expected, self.now, 'b' * 40), 'service_revision_mismatch')
        payload = copy.deepcopy(self.payload)
        payload['health'].pop('revision')
        self.assertEqual(validate_health(payload, self.expected, self.now, self.revision), 'service_revision_missing')

    def test_sanitised_health_file_uses_existing_validation(self):
        from pathlib import Path
        from tempfile import TemporaryDirectory
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / 'health.json'
            path.write_text(json.dumps(self.payload), encoding='utf-8')
            self.assertIsNone(check_health_file(str(path), self.expected, self.now, self.revision))
            path.write_text('not-json', encoding='utf-8')
            self.assertEqual(check_health_file(str(path), self.expected, self.now, self.revision), 'health_response_invalid')

    def test_malformed_runtime_payloads_fail_closed_without_crashing(self):
        for health in (None, [], 'healthy', True):
            payload = {**self.payload, 'health': health}
            self.assertEqual(validate_health(payload, self.expected, self.now, self.revision), 'health_response_invalid')
        for field, value in [('checkedAt', 123), ('checkedAt', None), ('enabledWorkers', True)]:
            payload = copy.deepcopy(self.payload)
            payload['health'][field] = value
            self.assertIsNotNone(validate_health(payload, self.expected, self.now, self.revision))
        for field in ('ageMs', 'degradedAfterMs'):
            payload = copy.deepcopy(self.payload)
            payload['health']['workers'][0][field] = True
            self.assertEqual(validate_health(payload, self.expected, self.now, self.revision), 'worker_unhealthy')
        payload = copy.deepcopy(self.payload)
        payload['health']['workers'].append(copy.deepcopy(payload['health']['workers'][0]))
        self.assertEqual(validate_health(payload, self.expected, self.now, self.revision), 'inventory_invalid')

    def test_failed_probe_records_and_notifies_even_with_a_healthy_file(self):
        with TemporaryDirectory() as tmp:
            state_path = Path(tmp) / 'state.json'
            health_path = Path(tmp) / 'health.json'
            health_path.write_text(json.dumps(self.payload), encoding='utf-8')
            env = {'COMMS_WORKER_HEALTH_FILE': str(health_path),
                   'OPS_ALERT_WEBHOOK_URL': 'https://ops.example/events', 'OPS_ALERT_WEBHOOK_TOKEN': 'test-only'}
            with patch.dict(os.environ, env), patch.object(watch, 'STATE', state_path), \
                 patch.object(watch, 'restore_state', return_value={'active': False}), \
                 patch.object(watch, 'load_defaults', return_value={}), \
                 patch.object(watch, 'production_monitor_config', return_value=('https://aims.example/health', self.expected)), \
                 patch.object(watch, 'send_event', return_value=True) as send:
                for outcome in ('failure', 'skipped', 'cancelled'):
                    with patch.dict(os.environ, {'COMMS_WORKER_PROBE_OUTCOME': outcome}):
                        self.assertEqual(watch.main(), 1)
                    state = json.loads(state_path.read_text())
                    self.assertTrue(state['active'])
                    self.assertTrue(state['notified'])
                    self.assertEqual(state['last_failure'], 'health_probe_failed')
                    self.assertEqual(send.call_args.args[0]['summary'], 'health_probe_failed')

    def test_workflow_runs_incident_handler_after_probe_failure(self):
        workflow = (Path(__file__).resolve().parents[1] / '.github/workflows/comms-hub-worker-watch.yml').read_text()
        handler = workflow.split('- name: Check workers and retain independent GitHub incident evidence', 1)[1]
        self.assertIn("if: ${{ !cancelled() && steps.checkout.outcome == 'success' }}", handler)
        self.assertIn('COMMS_WORKER_PROBE_OUTCOME: ${{ steps.health_probe.outcome }}', handler)
        probe = workflow.split('- name: Collect sanitised worker health inside Koyeb', 1)[1].split('- name:', 1)[0]
        self.assertIn('timeout-minutes: 2', probe)
        self.assertIn('id: health_probe', probe)
        self.assertIn('probe_status=$?', probe)
        self.assertIn('AIMS worker health endpoint returned HTTP', probe)
        self.assertIn('Koyeb worker health probe failed with exit code', probe)
        self.assertIn('if [ "$probe_status" -ne 0 ]; then', probe)
        self.assertIn('EXPECTED_SERVICE_REVISION: ${{ steps.deployed_revision.outputs.sha }}', workflow)
        self.assertIn('id: deployed_revision', workflow)

    def test_network_timeout_and_malformed(self):
        calls = []
        def fail(request, timeout):
            calls.append(timeout)
            raise TimeoutError()
        self.assertEqual(check_health('https://test.example/workers/health', 'test-key', self.expected, self.now, fail,
                                      self.revision), 'health_network_failure')
        self.assertEqual(calls, [10, 10])
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *_args): pass
            def read(self, _limit): return b'not-json'
        self.assertEqual(check_health('https://test.example/workers/health', 'test-key', self.expected, self.now,
                                    lambda *_args, **_kw: Response(), self.revision), 'health_response_invalid')
        def http_fail(*_args, **_kwargs):
            raise urllib.error.HTTPError('https://test.example', 503, 'unavailable', {}, None)
        self.assertEqual(check_health('https://test.example/workers/health', 'test-key', self.expected, self.now,
                                      http_fail, self.revision), 'health_http_failure')

    def test_incident_deduplication_recovery_and_new_failure_across_runs(self):
        sent = []
        def notify(event):
            sent.append(event)
            return True
        state = {'active': False}
        for _ in range(3):
            state = advance_incident(json.loads(json.dumps(state)), 'health_network_failure', self.now, notify)
        self.assertEqual(len(sent), 1)
        recovered_at = self.now + timedelta(minutes=30)
        evidence = {'service': 'comms-hub', 'revision': self.revision, 'expected_revision': self.revision,
                    'checked_at': recovered_at.isoformat()}
        state = advance_incident(state, None, recovered_at, notify, evidence)
        next_check = self.now + timedelta(minutes=60)
        evidence['checked_at'] = next_check.isoformat()
        state = advance_incident(state, None, next_check, notify, evidence)
        state = advance_incident(state, 'expected_worker_missing', self.now + timedelta(minutes=90), notify)
        self.assertEqual(len(sent), 3)
        self.assertNotEqual(sent[0]['event_id'], sent[2]['event_id'])

    def test_alert_http_error_reports_status_without_echoing_response_details(self):
        error = urllib.error.HTTPError(
            'https://ops.example/events', 503, 'private response detail', {}, None,
        )
        with patch.dict(os.environ, {
            'OPS_ALERT_WEBHOOK_URL': 'https://ops.example/events',
            'OPS_ALERT_WEBHOOK_TOKEN': 'test-secret-token',
        }), patch('ops_notify.urllib.request.urlopen', side_effect=error), \
                contextlib.redirect_stderr(io.StringIO()) as stderr:
            self.assertFalse(ops_notify.send_event({'event_id': 'test-event'}))
        self.assertEqual(stderr.getvalue().strip(), 'Operational event delivery failed: HTTP 503')
        self.assertNotIn('private response detail', stderr.getvalue())
        self.assertNotIn('test-secret-token', stderr.getvalue())

    def test_alert_failure_is_not_marked_delivered(self):
        state = advance_incident({'active': False}, 'health_network_failure', self.now, lambda _event: False)
        self.assertFalse(state['notified'])
        self.assertNotIn('notified_at', state)

    def test_incident_stays_open_without_matching_recovery_evidence(self):
        state = advance_incident({'active': False}, 'health_http_failure', self.now, lambda _event: True)
        open_state = advance_incident(state, None, self.now + timedelta(minutes=1), lambda _event: True)
        self.assertTrue(open_state['active'])
        self.assertEqual(open_state['last_failure'], 'recovery_evidence_missing_or_mismatched')
        stale = {'service': 'comms-hub', 'revision': 'b' * 40, 'expected_revision': self.revision,
                 'checked_at': self.now.isoformat()}
        open_state = advance_incident(state, None, self.now + timedelta(minutes=2), lambda _event: True, stale)
        self.assertTrue(open_state['active'])

    def test_failed_recovery_notification_does_not_suppress_a_new_incident(self):
        state = advance_incident({'active': False}, 'health_network_failure', self.now, lambda _event: True)
        incident = state['incident_id']
        evidence = {'service': 'comms-hub', 'revision': self.revision, 'expected_revision': self.revision,
                    'checked_at': self.now.isoformat()}
        state = advance_incident(state, None, self.now, lambda _event: False, evidence)
        self.assertFalse(state['active'])
        self.assertEqual(state['pending_recovery']['delivery'], 'failed')
        state = advance_incident(state, None, self.now + timedelta(minutes=5), lambda _event: True, evidence)
        self.assertNotIn('pending_recovery', state)
        state = advance_incident(state, 'worker_unhealthy', self.now, lambda _event: True)
        self.assertNotEqual(state['incident_id'], incident)



class OperationalNotifierCliTests(unittest.TestCase):
    def _run_main(self, env, *, response=None, error=None):
        argv = ['ops_notify', '--service', 'AIMS', '--event-type', 'ci_failed',
                '--title', 'CI failed', '--summary', 'CI failed']
        with patch.dict(os.environ, env, clear=True), patch.object(ops_notify.sys, 'argv', argv):
            with patch('ops_notify.urllib.request.urlopen', return_value=response, side_effect=error):
                return ops_notify.main()

    def test_cli_successful_delivery_exits_zero(self):
        class Response:
            status = 202
            def __enter__(self): return self
            def __exit__(self, *_args): pass
        self.assertEqual(self._run_main({
            'OPS_ALERT_WEBHOOK_URL': 'https://ops.example/events',
            'OPS_ALERT_WEBHOOK_TOKEN': 'test-token',
        }, response=Response()), 0)

    def test_cli_failed_delivery_exits_nonzero(self):
        error = urllib.error.HTTPError('https://ops.example/events', 503, 'private', {}, None)
        with contextlib.redirect_stderr(io.StringIO()):
            code = self._run_main({
                'OPS_ALERT_WEBHOOK_URL': 'https://ops.example/events',
                'OPS_ALERT_WEBHOOK_TOKEN': 'test-token',
            }, error=error)
        self.assertEqual(code, 1)

    def test_cli_missing_configuration_exits_nonzero(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self._run_main({}), 1)

if __name__ == '__main__':
    unittest.main()
