#!/usr/bin/env python3
"""Regression tests for exact Koyeb deployment identity and freshness."""
import importlib.util
import sys
import types
import unittest
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

if __name__ == "__main__":
    unittest.main()
