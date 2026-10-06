"""Regression checks for repair retirement; all GitHub writes are mocked."""
import copy
import inspect
from datetime import datetime, timezone
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("GH_TOKEN", "unit-test")
os.environ.setdefault("GITHUB_REPOSITORY", "owner/repo")

import branch_pr_automation as branch_controller  # noqa: E402
import trusted_automation as automation  # noqa: E402


class RepairRetirementTests(unittest.TestCase):
    def setUp(self):
        self.current = "a" * 40
        self.pr = {
            "number": 1,
            "state": "open",
            "title": "[autonomy] Repair CI failure (123)",
            "user": {"login": "repair[bot]"},
            "head": {"ref": "autonomy/repair-123", "repo": {"full_name": "owner/repo"}},
            "base": {"ref": "main"},
            "labels": [{"name": "autonomy:repair"}],
            "body": f"Failed commit: `{self.current}`",
        }
        for name, value in {"REPO": "owner/repo", "REPAIR_APP_LOGIN": "repair[bot]", "DEFAULT_BRANCH": "main"}.items():
            self.enterContext(patch.object(automation, name, value))
        self.enterContext(patch.object(automation, "get", return_value={"commit": {"sha": self.current}}))
        self.write = self.enterContext(patch.object(automation, "request"))
        self.labels = self.enterContext(patch.object(automation, "add_labels"))
        self.delete = self.enterContext(patch.object(automation, "delete"))
        self.enterContext(patch.object(automation, "log"))

    def retire(self):
        automation.reconcile_stale_carriers([copy.deepcopy(self.pr)])

    def test_current_unresolved_carrier_remains_open(self):
        self.retire()
        self.write.assert_not_called()

    def test_current_human_hold_remains_open(self):
        self.pr["labels"].append({"name": "autonomy:human-hold"})
        self.retire()
        self.write.assert_not_called()
        self.delete.assert_not_called()

    def test_obsolete_carrier_closes_even_at_current_sha(self):
        self.pr["labels"].append({"name": "autonomy:obsolete"})
        self.retire()
        self.write.assert_called_once_with("PATCH", "/repos/owner/repo/pulls/1", {"state": "closed"})
        self.delete.assert_called_once_with("/repos/owner/repo/issues/1/labels/autonomy%3Arepair", expected=(200, 204))

    def test_retirement_retries_after_active_label_was_removed(self):
        self.pr["labels"] = [{"name": "autonomy:superseded"}]
        self.retire()
        self.write.assert_called_once()

    def test_stale_carrier_is_labelled_and_closed(self):
        self.pr["body"] = f"Failed commit: `{'b' * 40}`"
        self.retire()
        self.labels.assert_called_once_with(1, ["autonomy:obsolete"])
        self.write.assert_called_once()

    def test_impostor_and_implementation_are_never_retired(self):
        self.pr["labels"].append({"name": "autonomy:obsolete"})
        self.pr["user"]["login"] = "another-user"
        self.retire()
        self.pr["user"]["login"] = "repair[bot]"
        self.pr["head"]["ref"] = "implementation/fix"
        self.retire()
        self.write.assert_not_called()

    def test_fork_carrier_is_never_retired(self):
        self.pr["labels"].append({"name": "autonomy:obsolete"})
        self.pr["head"]["repo"]["full_name"] = "fork/repo"
        self.retire()
        self.write.assert_not_called()

    def test_failed_close_keeps_active_labels_for_retry(self):
        self.pr["labels"].append({"name": "autonomy:obsolete"})
        self.write.side_effect = RuntimeError("simulated unavailable API")
        with self.assertRaises(RuntimeError):
            self.retire()
        self.delete.assert_not_called()


class TrustedImplementationLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.sha = "b" * 40
        self.base = "a" * 40
        for name, value in {
            "REPO": "owner/repo",
            "DEFAULT_BRANCH": "main",
            "REPAIR_APP_LOGIN": "repair[bot]",
            "KILO_LOGIN": "kilo-code-bot[bot]",
        }.items():
            self.enterContext(patch.object(automation, name, value))
        self.enterContext(patch.object(automation, "log"))
        self.write = self.enterContext(patch.object(automation, "request"))
        self.remove = self.enterContext(patch.object(automation, "remove_label"))

    def kilo_pr(self):
        return {
            "number": 31,
            "state": "open",
            "draft": False,
            "title": "fix: Kilo repair",
            "html_url": "https://github.com/owner/repo/pull/31",
            "user": {"login": "kilo-code-bot[bot]"},
            "head": {
                "ref": "kilo/fix-31",
                "sha": self.sha,
                "repo": {"full_name": "owner/repo"},
            },
            "base": {"ref": "main"},
            "labels": [
                {"name": "autonomy:repair"},
                {"name": "autonomy:kilo-implementation"},
            ],
            "body": "",
        }

    def test_retired_verified_kilo_implementation_closes(self):
        pr = self.kilo_pr()
        pr["labels"].append({"name": "autonomy:obsolete"})
        pr["labels"].append({"name": "autonomy:admitted"})

        automation.reconcile_retired_implementations([pr])

        self.write.assert_called_once_with(
            "PATCH", "/repos/owner/repo/pulls/31", {"state": "closed"}
        )
        self.remove.assert_called_once_with(31, "autonomy:admitted")

    def test_arbitrary_labelled_pr_is_never_closed(self):
        pr = self.kilo_pr()
        pr["user"]["login"] = "some-user"
        pr["labels"].append({"name": "autonomy:superseded"})

        automation.reconcile_retired_implementations([pr])

        self.write.assert_not_called()

    def test_retired_managed_draft_is_closed_without_becoming_merge_eligible(self):
        pr = {
            "number": 32,
            "state": "open",
            "draft": True,
            "user": {"login": "repair[bot]"},
            "head": {
                "ref": "codex/retired-work",
                "sha": self.sha,
                "repo": {"full_name": "owner/repo"},
            },
            "base": {"ref": "main"},
            "labels": [
                {"name": "automation:branch-pr"},
                {"name": "autonomy:superseded"},
            ],
        }

        automation.reconcile_retired_implementations([pr])

        self.write.assert_called_once_with(
            "PATCH", "/repos/owner/repo/pulls/32", {"state": "closed"}
        )
        self.assertFalse(automation.is_managed_branch_pr(pr))

    def test_behind_verified_kilo_branch_is_updated_and_stale_admission_removed(self):
        pr = self.kilo_pr()
        pr["labels"].append({"name": "autonomy:admitted"})
        fresh = copy.deepcopy(pr)
        self.enterContext(patch.object(automation, "linked_kilo_carrier", return_value=9))
        self.enterContext(patch.object(automation, "linked_kilo_review_source", return_value=None))
        self.enterContext(
            patch.object(
                automation,
                "get",
                side_effect=[
                    {"commit": {"sha": self.base}},
                    {"behind_by": 2},
                    fresh,
                    {"commit": {"sha": self.base}},
                ],
            )
        )

        automation.refresh_behind_kilo_prs([pr])

        self.write.assert_called_once_with(
            "PUT",
            "/repos/owner/repo/pulls/31/update-branch",
            {"expected_head_sha": self.sha},
            expected=(200, 202),
        )
        self.remove.assert_called_once_with(31, "autonomy:admitted")

    def test_human_hold_prevents_kilo_branch_update(self):
        pr = self.kilo_pr()
        pr["labels"].append({"name": "autonomy:human-hold"})
        self.enterContext(
            patch.object(
                automation,
                "get",
                return_value={"commit": {"sha": self.base}},
            )
        )

        automation.refresh_behind_kilo_prs([pr])

        self.write.assert_not_called()

    def test_trusted_github_scripts_are_sensitive(self):
        self.assertTrue(automation.sensitive_file(".github/scripts/trusted_automation.py"))
        self.assertTrue(automation.sensitive_file(".github/scripts/test_autonomy_lifecycle.py"))
        self.assertTrue(automation.sensitive_file(".github/scripts/codeql_gate.py"))
        self.assertFalse(automation.sensitive_file("services/worker.js"))


class ManagedBranchOwnershipTests(unittest.TestCase):
    def setUp(self):
        self.sha = "c" * 40
        self.pr = {
            "number": 22,
            "state": "open",
            "draft": False,
            "title": "Implement requested change",
            "user": {"login": "repair[bot]"},
            "head": {
                "ref": "codex/requested-change",
                "sha": self.sha,
                "repo": {"full_name": "owner/repo"},
            },
            "base": {"ref": "main"},
            "labels": [{"name": "automation:branch-pr"}],
            "body": "",
        }
        for name, value in {
            "REPO": "owner/repo",
            "REPAIR_APP_LOGIN": "repair[bot]",
            "DEFAULT_BRANCH": "main",
        }.items():
            self.enterContext(patch.object(automation, name, value))
        self.enterContext(patch.object(automation, "log"))
        self.enterContext(
            patch.object(automation, "council_evidence_freeze", return_value=(False, "test release"))
        )

    def test_branch_controller_has_no_native_merge_authority(self):
        source = inspect.getsource(branch_controller)
        self.assertNotIn("enablePullRequestAutoMerge", source)
        self.assertNotIn("enable_native_auto_merge", source)
        self.assertNotIn("/merge", source)

    def test_managed_branch_pr_is_admitted_to_mergify_after_green_checks(self):
        admit = self.enterContext(patch.object(automation, "admit_to_mergify"))
        approve = self.enterContext(patch.object(automation, "approve_pr"))
        self.enterContext(
            patch.object(automation, "pr_files", return_value=["services/example.js"])
        )
        self.enterContext(
            patch.object(
                automation,
                "all_required_checks_green",
                return_value=(True, "green"),
            )
        )
        self.enterContext(
            patch.object(automation, "current_head_unchanged", return_value=self.pr)
        )

        automation.reconcile_pr(copy.deepcopy(self.pr))

        admit.assert_called_once_with(22)
        approve.assert_not_called()

    def test_managed_branch_pr_touching_protected_controls_gets_human_hold(self):
        hold = self.enterContext(patch.object(automation, "place_human_hold"))
        admit = self.enterContext(patch.object(automation, "admit_to_mergify"))
        self.enterContext(
            patch.object(
                automation,
                "pr_files",
                return_value=[".github/workflows/security.yml"],
            )
        )

        automation.reconcile_pr(copy.deepcopy(self.pr))

        hold.assert_called_once()
        admit.assert_not_called()


class CouncilEvidenceFreezeTests(unittest.TestCase):
    def setUp(self):
        self.sha = "d" * 40
        for name, value in {"REPO": "owner/repo", "DEFAULT_BRANCH": "main"}.items():
            self.enterContext(patch.object(automation, name, value))

    def test_weekend_envelope_uses_europe_london(self):
        inside = datetime(2026, 10, 3, 12, 0, tzinfo=timezone.utc)
        outside = datetime(2026, 10, 6, 12, 0, tzinfo=timezone.utc)
        self.assertIsNotNone(automation.current_weekend_bounds(inside))
        self.assertIsNone(automation.current_weekend_bounds(outside))

    def test_successful_ci_freezes_routine_merges_until_same_sha_council(self):
        runs = {
            "workflow_runs": [
                {
                    "id": 100,
                    "name": "AIMS CI",
                    "event": "workflow_dispatch",
                    "status": "completed",
                    "conclusion": "success",
                    "head_sha": self.sha,
                    "created_at": "2026-10-02T19:05:00Z",
                }
            ]
        }
        with (
            patch.object(
                automation,
                "current_weekend_bounds",
                return_value=(
                    datetime(2026, 10, 2, 20, 0, tzinfo=automation.LONDON),
                    datetime(2026, 10, 5, 4, 0, tzinfo=automation.LONDON),
                ),
            ),
            patch.object(
                automation,
                "get",
                side_effect=[
                    {"commit": {"sha": self.sha}},
                    runs,
                    {"commit": {"sha": self.sha}},
                ],
            ),
        ):
            frozen, reason = automation.council_evidence_freeze()
        self.assertTrue(frozen)
        self.assertIn(self.sha[:12], reason)

        runs["workflow_runs"].append(
            {
                "id": 101,
                "name": "Repository Council",
                "event": "workflow_dispatch",
                "status": "completed",
                "conclusion": "success",
                "head_sha": self.sha,
                "created_at": "2026-10-04T17:35:00Z",
            }
        )
        with (
            patch.object(
                automation,
                "current_weekend_bounds",
                return_value=(
                    datetime(2026, 10, 2, 20, 0, tzinfo=automation.LONDON),
                    datetime(2026, 10, 5, 4, 0, tzinfo=automation.LONDON),
                ),
            ),
            patch.object(
                automation,
                "get",
                side_effect=[
                    {"commit": {"sha": self.sha}},
                    runs,
                    {"commit": {"sha": self.sha}},
                ],
            ),
        ):
            frozen, reason = automation.council_evidence_freeze()
        self.assertFalse(frozen)
        self.assertIn("Council completed", reason)

    def test_default_branch_move_during_evidence_collection_fails_closed(self):
        runs = {"workflow_runs": [], "total_count": 0}
        with (
            patch.object(
                automation,
                "current_weekend_bounds",
                return_value=(
                    datetime(2026, 10, 2, 20, 0, tzinfo=automation.LONDON),
                    datetime(2026, 10, 5, 4, 0, tzinfo=automation.LONDON),
                ),
            ),
            patch.object(automation, "log"),
            patch.object(
                automation,
                "get",
                side_effect=[
                    {"commit": {"sha": self.sha}},
                    runs,
                    {"commit": {"sha": "e" * 40}},
                    runs,
                    {"commit": {"sha": "f" * 40}},
                ],
            ),
        ):
            frozen, reason = automation.council_evidence_freeze()
        self.assertTrue(frozen)
        self.assertIn("default branch moved", reason)

    def test_single_branch_move_retries_once_with_new_sha(self):
        new_sha = "e" * 40
        first_runs = {"workflow_runs": [], "total_count": 0}
        second_runs = {
            "workflow_runs": [
                {
                    "id": 100,
                    "name": "AIMS CI",
                    "event": "workflow_dispatch",
                    "status": "completed",
                    "conclusion": "success",
                    "head_sha": new_sha,
                    "created_at": "2026-10-02T19:05:00Z",
                }
            ],
            "total_count": 1,
        }
        with (
            patch.object(
                automation,
                "current_weekend_bounds",
                return_value=(
                    datetime(2026, 10, 2, 20, 0, tzinfo=automation.LONDON),
                    datetime(2026, 10, 5, 4, 0, tzinfo=automation.LONDON),
                ),
            ),
            patch.object(automation, "log"),
            patch.object(
                automation,
                "get",
                side_effect=[
                    {"commit": {"sha": self.sha}},
                    first_runs,
                    {"commit": {"sha": new_sha}},
                    second_runs,
                    {"commit": {"sha": new_sha}},
                ],
            ),
        ):
            frozen, reason = automation.council_evidence_freeze()
        self.assertTrue(frozen)
        self.assertIn(new_sha[:12], reason)

    def test_incomplete_pagination_evidence_fails_closed(self):
        runs = {"workflow_runs": [], "total_count": 150}
        with (
            patch.object(
                automation,
                "current_weekend_bounds",
                return_value=(
                    datetime(2026, 10, 2, 20, 0, tzinfo=automation.LONDON),
                    datetime(2026, 10, 5, 4, 0, tzinfo=automation.LONDON),
                ),
            ),
            patch.object(
                automation,
                "get",
                side_effect=[
                    {"commit": {"sha": self.sha}},
                    runs,
                ],
            ),
        ):
            with self.assertRaises(RuntimeError):
                automation.council_evidence_freeze()

    def test_exact_1000_workflow_runs_is_complete_not_overflow(self):
        page = {"workflow_runs": [{} for _ in range(100)], "total_count": 1000}
        with patch.object(automation, "get", side_effect=[page for _ in range(10)]):
            runs = automation._fetch_branch_runs()
        self.assertEqual(len(runs), 1000)

    def test_more_than_1000_workflow_runs_fails_closed(self):
        page = {"workflow_runs": [{} for _ in range(100)], "total_count": 1001}
        with patch.object(automation, "get", side_effect=[page for _ in range(10)]):
            with self.assertRaises(RuntimeError):
                automation._fetch_branch_runs()



if __name__ == "__main__":
    unittest.main()
