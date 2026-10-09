#!/usr/bin/env python3
"""Regression coverage for bounded weekend evidence collection."""
import importlib.util
import os
from pathlib import Path
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

os.environ.setdefault("GH_TOKEN", "test-token-not-a-credential")
os.environ.setdefault("GITHUB_REPOSITORY", "example/AIMS")
spec = importlib.util.spec_from_file_location(
    "trusted_automation", Path(__file__).with_name("trusted_automation.py")
)
module = importlib.util.module_from_spec(spec)
import sys
sys.modules[spec.name] = module
spec.loader.exec_module(module)


class WeekendEvidenceTests(unittest.TestCase):
    def test_outside_window_does_not_query_api(self):
        with patch.object(module, "current_weekend_bounds", return_value=None), patch.object(module, "get") as get:
            self.assertEqual(module._fetch_branch_runs(), [])
            get.assert_not_called()

    def test_exact_sha_and_window_are_applied(self):
        bounds = (datetime(2026, 10, 9, 19, tzinfo=timezone.utc),
                  datetime(2026, 10, 12, 3, tzinfo=timezone.utc))
        sha = "a" * 40
        seen = []
        def fake_get(path):
            seen.append(parse_qs(urlsplit(path).query))
            return {"total_count": 1, "workflow_runs": [{"id": 123}]}
        with patch.object(module, "current_weekend_bounds", return_value=bounds), patch.object(module, "get", side_effect=fake_get):
            self.assertEqual(module._fetch_branch_runs(), [{"id": 123}])
        self.assertEqual(seen[0]["branch"], ["main"])
        self.assertEqual(seen[0]["created"], ["2026-10-09T19:00:00Z..2026-10-12T03:00:00Z"])

    def test_incomplete_evidence_fails_closed(self):
        bounds = (datetime(2026, 10, 9, 19, tzinfo=timezone.utc),
                  datetime(2026, 10, 12, 3, tzinfo=timezone.utc))
        with (
            patch.object(module, "current_weekend_bounds", return_value=bounds),
            patch.object(module, "get", return_value={"total_count": 1500, "workflow_runs": [{}] * 100}),
        ):
            with self.assertRaisesRegex(RuntimeError, "safe 1,000-run limit"):
                module._fetch_branch_runs()


if __name__ == "__main__":
    unittest.main()
