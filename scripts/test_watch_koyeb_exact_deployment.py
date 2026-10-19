#!/usr/bin/env python3
"""Regression tests for exact Koyeb deployment identity and freshness."""
import importlib.util
import sys
import types
import unittest
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from unittest.mock import patch
from datetime import UTC, datetime
from pathlib import Path

sys.modules.setdefault("ops_notify", types.SimpleNamespace(send_event=lambda event: None))
spec = importlib.util.spec_from_file_location("watch_koyeb_deployment", Path(__file__).with_name("watch_koyeb_deployment.py"))
watch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watch)

SHA = "a" * 40
NOW = datetime(2026, 10, 10, 1, tzinfo=UTC)

class ExactDeploymentTests(unittest.TestCase):
    def test_exact_commit_accepted(self):
        self.assertTrue(watch._matches_expected_deployment({"id": "dep", "status": "healthy", "commit_sha": SHA, "created_at": "2026-10-10T01:00:00Z"}, SHA, NOW))

    def test_prefix_rejected(self):
        self.assertFalse(watch._matches_expected_deployment({"commit_sha": SHA[:12]}, SHA, None))

    def test_different_commit_rejected(self):
        self.assertFalse(watch._matches_expected_deployment({"commit_sha": "b" * 40}, SHA, None))

    def test_missing_timestamp_rejected(self):
        self.assertFalse(watch._matches_expected_deployment({"commit_sha": SHA}, SHA, NOW))

    def test_invalid_timestamp_rejected(self):
        self.assertFalse(watch._matches_expected_deployment({"commit_sha": SHA, "created_at": "invalid"}, SHA, NOW))

    def test_stale_timestamp_rejected(self):
        self.assertFalse(watch._matches_expected_deployment({"commit_sha": SHA, "created_at": "2026-10-09T20:00:00Z"}, SHA, NOW))

    def test_current_revision_lookup_requires_latest_deployment_healthy_and_exact(self):
        with patch.dict(watch.os.environ, {"KOYEB_SERVICE": "aims", "KOYEB_TOKEN": "test-only"}), \
                patch.object(watch.sys, "argv", ["watch_koyeb_deployment.py", "--current-healthy-sha"]), \
                patch.object(watch, "_deployments", return_value=[{"status": "healthy", "commit_sha": SHA}]), \
                redirect_stdout(StringIO()) as output:
            self.assertEqual(watch.main(), 0)
        self.assertEqual(output.getvalue(), f"sha={SHA}\n")

    def test_current_revision_lookup_rejects_unhealthy_or_prefix_sha(self):
        for deployment in ({"status": "failed", "commit_sha": SHA},
                           {"status": "healthy", "commit_sha": SHA[:12]}):
            with patch.dict(watch.os.environ, {"KOYEB_SERVICE": "aims", "KOYEB_TOKEN": "test-only"}), \
                    patch.object(watch.sys, "argv", ["watch_koyeb_deployment.py", "--current-healthy-sha"]), \
                    patch.object(watch, "_deployments", return_value=[deployment]), \
                    redirect_stderr(StringIO()):
                self.assertEqual(watch.main(), 1)

if __name__ == "__main__":
    unittest.main()
