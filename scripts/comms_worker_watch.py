"""Bounded external worker check with incident state retained between Actions runs."""
from __future__ import annotations

import io
import math
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from datetime import UTC, datetime
from pathlib import Path

from ops_notify import send_event

STATE = Path('worker-watch-state.json')
PRODUCTION_DEFAULTS = Path('config/production.defaults.env')


def load_defaults(path=PRODUCTION_DEFAULTS):
    values = {}
    for raw in path.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        values[key.strip()] = value.strip()
    return values


def enabled(defaults, key):
    return defaults.get(key, '').strip().lower() in {'1', 'true', 'yes', 'on'}


def production_monitor_config(defaults):
    base = (defaults.get('APP_URL') or defaults.get('COMMS_HUB_PUBLIC_BASE_URL') or '').strip().rstrip('/')
    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme != 'https' or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('Invalid production APP_URL')

    expected = []
    if enabled(defaults, 'COMMS_HUB_ZERNIO_POLL_ENABLED'):
        expected.append('social_poll:default')
    if enabled(defaults, 'COMMS_HUB_FOLLOW_UP_WORKER_ENABLED'):
        expected.append('follow_up:default')
    if enabled(defaults, 'COMMS_HUB_PROVIDER_HEALTH_ENABLED'):
        expected.append('provider_monitor:default')
    if enabled(defaults, 'COMMS_HUB_DELAYED_ACTION_WORKER_ENABLED'):
        expected.append('delayed_actions:default')
    if enabled(defaults, 'COMMS_HUB_EMAIL_ARCHIVE_ENABLED'):
        expected.append('archive:default')
    if (enabled(defaults, 'COMMS_HUB_ZERNIO_WEBHOOK_RECONCILE_ENABLED')
            and (enabled(defaults, 'COMMS_HUB_ZERNIO_META_ENABLED') or enabled(defaults, 'COMMS_HUB_ZERNIO_VIDEO_ENABLED'))):
        expected.append('webhook_reconcile:default')
    if enabled(defaults, 'COMMS_HUB_BACKUP_ENABLED') and enabled(defaults, 'COMMS_HUB_BACKUP_AUTOMATIC_ENABLED'):
        expected.append('backup:default')
    if enabled(defaults, 'COMMS_HUB_RETENTION_WORKER_ENABLED'):
        expected.append('retention:default')
    if enabled(defaults, 'COMMS_HUB_MONTH_END_ARCHIVE_ENABLED'):
        expected.append('month_end_archive:default')
    if enabled(defaults, 'COMMS_HUB_HOUSEKEEPING_ENABLED') and enabled(defaults, 'COMMS_HUB_HOUSEKEEPING_WORKER_ENABLED'):
        expected.append('housekeeping:default')
    if enabled(defaults, 'COMMS_HUB_EMAIL_ENABLED') and enabled(defaults, 'COMMS_HUB_EMAIL_POLL_WORKER_ENABLED'):
        expected.append('inbound_email:info')
    if not expected:
        raise ValueError('No production worker inventory enabled')
    return f'{base}/comms-hub/workers/health', expected


def validate_health(payload, expected, now):
    if not expected:
        return 'expected_inventory_unconfigured'
    health = payload.get('health', {}) if isinstance(payload, dict) else {}
    workers = health.get('workers')
    if not isinstance(workers, list) or not workers:
        return 'inventory_missing'
    try:
        checked = datetime.fromisoformat(health['checkedAt'].replace('Z', '+00:00'))
        age = (now - checked).total_seconds()
        if age < -30 or age > 120:
            return 'health_response_stale'
    except (KeyError, TypeError, ValueError):
        return 'health_response_invalid'
    identities = {f"{w.get('category')}:{w.get('key')}" for w in workers if isinstance(w, dict) and w.get('enabled') is True}
    if not set(expected).issubset(identities):
        return 'expected_worker_missing'
    if health.get('enabledWorkers') != len(identities) or not identities:
        return 'inventory_invalid'
    if payload.get('ok') is not True or payload.get('service') != 'comms-hub' or health.get('overall') != 'healthy':
        return 'workers_unhealthy'
    for worker in workers:
        if not isinstance(worker, dict):
            return 'health_response_invalid'
        if worker.get('enabled') is True:
            age_ms = worker.get('ageMs')
            threshold = worker.get('degradedAfterMs')
            if (worker.get('status') != 'healthy' or not isinstance(age_ms, (int, float))
                    or not isinstance(threshold, (int, float)) or not math.isfinite(age_ms) or not math.isfinite(threshold)
                    or age_ms < 0 or threshold <= 0 or age_ms > threshold):
                return 'worker_unhealthy'
    return None


def advance_incident(state, failure, now, notify):
    stamp = now.isoformat()
    if failure:
        if not state.get('active'):
            state = {'active': True, 'incident_id': str(uuid.uuid4()), 'detected_at': stamp, 'notified': False}
        if not state.get('notified'):
            delivered = notify({'event_id': f"worker-watch:{state['incident_id']}:failure", 'event_type': 'worker_health_failure',
                                'service': 'AIMS', 'source': 'github_actions', 'severity': 'critical',
                                'title': 'Comms Hub worker health failed', 'summary': failure,
                                'details': {'detected_at': state['detected_at'], 'started_at': os.getenv('WATCH_STARTED_AT'),
                                            'scheduled_at': os.getenv('WATCH_SCHEDULED_AT') or None}})
            state['notified'] = delivered is True
            if delivered:
                state['notified_at'] = stamp
        state['last_failure'] = failure
    elif state.get('active'):
        if state.get('notified'):
            delivered = notify({'event_id': f"worker-watch:{state['incident_id']}:recovery", 'event_type': 'worker_health_recovered',
                'service': 'AIMS', 'source': 'github_actions', 'severity': 'info', 'title': 'Comms Hub workers recovered',
                'summary': 'Expected workers are healthy again.'})
            recovery_delivery = 'sent' if delivered else 'failed'
        else:
            recovery_delivery = 'not_required'
        state = {'active': False, 'recovered_at': stamp, 'recovery_delivery': recovery_delivery}
    state['checked_at'] = stamp
    return state


def check_health_file(path, expected, now):
    try:
        raw = Path(path).read_bytes()
        if len(raw) > 256_000:
            return 'health_response_invalid'
        payload = json.loads(raw)
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return 'health_response_invalid'
    return validate_health(payload, expected, now)


def check_health(url, token, expected, now, opener=None):
    opener = opener or urllib.request.build_opener(NoRedirect()).open
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.query or parsed.fragment or not token:
        return 'monitor_configuration_invalid'
    request = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}', 'Accept': 'application/json'})
    for attempt in range(2):
        try:
            with opener(request, timeout=10) as response:
                if response.status != 200:
                    return 'health_http_failure'
                return validate_health(json.loads(response.read(256_001)), expected, now)
        except urllib.error.HTTPError:
            return 'health_http_failure'
        except (TimeoutError, urllib.error.URLError):
            if attempt == 1:
                return 'health_network_failure'
        except (ValueError, TypeError, AttributeError):
            return 'health_response_invalid'
    return 'health_network_failure'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args):
        return None


def github_json(path):
    request = urllib.request.Request(f'https://api.github.com/repos/{os.environ["GITHUB_REPOSITORY"]}/{path}',
        headers={'Authorization': f'Bearer {os.environ["GH_TOKEN"]}', 'Accept': 'application/vnd.github+json'})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def restore_state():
    artifacts = github_json('actions/artifacts?name=comms-worker-watch-state&per_page=100')['artifacts']
    for artifact in sorted(artifacts, key=lambda a: a['id'], reverse=True):
        if artifact.get('expired'):
            continue
        run = github_json(f'actions/runs/{artifact["workflow_run"]["id"]}')
        if (run.get('path') != '.github/workflows/comms-hub-worker-watch.yml' or run.get('head_branch') != 'main'
                or run.get('event') not in ('schedule', 'workflow_dispatch')):
            continue
        url = f'https://api.github.com/repos/{os.environ["GITHUB_REPOSITORY"]}/actions/artifacts/{artifact["id"]}/zip'
        request = urllib.request.Request(url, headers={'Authorization': f'Bearer {os.environ["GH_TOKEN"]}'})
        try:
            urllib.request.build_opener(NoRedirect()).open(request, timeout=10)
            raise ValueError('Expected signed artifact redirect')
        except urllib.error.HTTPError as response:
            if response.code != 302:
                raise
            signed = response.headers['Location']
        if urllib.parse.urlsplit(signed).scheme != 'https':
            raise ValueError('Invalid artifact transfer')
        with urllib.request.urlopen(signed, timeout=10) as response:
            data = response.read(1_000_001)
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            state = json.loads(archive.read('worker-watch-state.json'))
        if not isinstance(state, dict) or not isinstance(state.get('active'), bool):
            raise ValueError('Invalid saved incident state')
        return state
    prior = github_json('actions/workflows/comms-hub-worker-watch.yml/runs?per_page=100')['workflow_runs']
    if any(str(run['id']) != os.getenv('GITHUB_RUN_ID') and run['status'] == 'completed' for run in prior):
        raise ValueError('Prior monitoring state unavailable; reconcile before reset')
    return {'active': False}


def main():
    try:
        state = restore_state()
        url, expected = production_monitor_config(load_defaults())
    except Exception as error:
        print(f'Monitor configuration/state restore failed: {type(error).__name__}', file=sys.stderr)
        return 1
    now = datetime.now(UTC)
    health_file = os.getenv('COMMS_WORKER_HEALTH_FILE', '').strip()
    failure = (check_health_file(health_file, expected, now) if health_file
               else check_health(url, os.getenv('AIMS_API_KEY', ''), expected, now))
    alert_url = os.getenv('OPS_ALERT_WEBHOOK_URL', '')
    webhook_independent = bool(alert_url and os.getenv('OPS_ALERT_WEBHOOK_TOKEN') and urllib.parse.urlsplit(alert_url).scheme == 'https'
                               and urllib.parse.urlsplit(alert_url).netloc != urllib.parse.urlsplit(url).netloc)
    state = advance_incident(state, failure, now, lambda event: webhook_independent and send_event(event))
    STATE.write_text(json.dumps(state, sort_keys=True), encoding='utf-8')
    print(json.dumps({'health': failure or 'healthy', 'detected_at': state.get('detected_at'),
                      'notified_at': state.get('notified_at'), 'github_failure_signal': bool(failure),
                      'optional_webhook_configured': webhook_independent, 'expected_workers': expected}))
    return 1 if failure else 0


if __name__ == '__main__':
    raise SystemExit(main())
