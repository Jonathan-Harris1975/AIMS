import copy
import json
import unittest
import urllib.error
from datetime import UTC, datetime, timedelta
from comms_worker_watch import advance_incident, check_health, production_monitor_config, validate_health


class WorkerWatchTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 3, 2, 0, tzinfo=UTC)
        self.payload = {'ok': True, 'service': 'comms-hub', 'health': {'overall': 'healthy', 'checkedAt': self.now.isoformat(),
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
        self.assertIsNone(validate_health(self.payload, self.expected, self.now))
        for mutate in [lambda p: p['health'].update(workers=[]), lambda p: p['health'].update(overall='stale'),
                       lambda p: p['health'].update(checkedAt='invalid'), lambda p: p['health']['workers'][0].update(status='degraded'),
                       lambda p: p['health']['workers'][0].update(ageMs=float('nan'))]:
            payload = copy.deepcopy(self.payload)
            mutate(payload)
            self.assertIsNotNone(validate_health(payload, self.expected, self.now))
        self.assertIsNotNone(validate_health(self.payload, ['inbound_email:missing'], self.now))
        self.assertIsNotNone(validate_health(self.payload, [], self.now))

    def test_network_timeout_and_malformed(self):
        calls = []
        def fail(request, timeout):
            calls.append(timeout)
            raise TimeoutError()
        self.assertEqual(check_health('https://test.example/workers/health', 'test-key', self.expected, self.now, fail), 'health_network_failure')
        self.assertEqual(calls, [10, 10])
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *_args): pass
            def read(self, _limit): return b'not-json'
        self.assertEqual(check_health('https://test.example/workers/health', 'test-key', self.expected, self.now,
                                    lambda *_args, **_kw: Response()), 'health_response_invalid')
        def http_fail(*_args, **_kwargs):
            raise urllib.error.HTTPError('https://test.example', 503, 'unavailable', {}, None)
        self.assertEqual(check_health('https://test.example/workers/health', 'test-key', self.expected, self.now, http_fail), 'health_http_failure')

    def test_incident_deduplication_recovery_and_new_failure_across_runs(self):
        sent = []
        def notify(event):
            sent.append(event)
            return True
        state = {'active': False}
        for _ in range(3):
            state = advance_incident(json.loads(json.dumps(state)), 'health_network_failure', self.now, notify)
        self.assertEqual(len(sent), 1)
        state = advance_incident(state, None, self.now + timedelta(minutes=30), notify)
        state = advance_incident(state, None, self.now + timedelta(minutes=60), notify)
        state = advance_incident(state, 'expected_worker_missing', self.now + timedelta(minutes=90), notify)
        self.assertEqual(len(sent), 3)
        self.assertNotEqual(sent[0]['event_id'], sent[2]['event_id'])

    def test_alert_failure_is_not_marked_delivered(self):
        state = advance_incident({'active': False}, 'health_network_failure', self.now, lambda _event: False)
        self.assertFalse(state['notified'])
        self.assertNotIn('notified_at', state)

    def test_failed_recovery_notification_does_not_suppress_a_new_incident(self):
        state = advance_incident({'active': False}, 'health_network_failure', self.now, lambda _event: True)
        incident = state['incident_id']
        state = advance_incident(state, None, self.now, lambda _event: False)
        self.assertFalse(state['active'])
        state = advance_incident(state, 'worker_unhealthy', self.now, lambda _event: True)
        self.assertNotEqual(state['incident_id'], incident)


if __name__ == '__main__':
    unittest.main()
