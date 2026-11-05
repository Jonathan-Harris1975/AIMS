"""HIVE lifecycle decisions cannot dispatch repairs through AIMS workflow inputs."""
import importlib.util
import os
import sys
import unittest
from pathlib import Path

from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
os.environ.setdefault("GITHUB_REPOSITORY", "owner/repository")
os.environ.setdefault("GH_TOKEN", "test-token")
os.environ.setdefault("DEFAULT_BRANCH", "main")
os.environ["GITHUB_EVENT_NAME"] = "workflow_dispatch"
spec = importlib.util.spec_from_file_location("pr_repair_router_under_test", ROOT / "pr_repair_router.py")
router = importlib.util.module_from_spec(spec)
spec.loader.exec_module(router)

SHA = "a" * 40
PR = {"number": 17, "head": {"sha": SHA}, "html_url": "https://github.com/owner/repository/pull/17"}


class AimsOwnedRepairHandoffTests(unittest.TestCase):
    def test_hive_acceptance_payload_is_not_a_kilo_dispatch_source(self):
        event = {
            "inputs": {
                "pr_number": "17",
                "review_id": "review-" + "b" * 24,
                "source_head_sha": SHA,
                "repair_prompt": (
                    "Repair the verified failure at the exact source head "
                    "and retain all required controls."
                ),
            }
        }
        with patch.object(router, "pr_details", return_value=PR):
            self.assertIsNone(router.extract(event))

    def test_manual_workflow_dispatch_does_not_bypass_local_issue_and_review_routing(self):
        with patch.object(router, "pr_details") as details:
            self.assertIsNone(router.extract({"inputs": {"pr_number": "17"}}))
        details.assert_not_called()


if __name__ == "__main__":
    unittest.main()
