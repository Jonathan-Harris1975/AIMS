"""Regression checks for repair retirement; all GitHub writes are mocked."""
import copy
import json
import inspect
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import unittest
import native_auto_merge
from unittest.mock import patch

os.environ.setdefault("GH_TOKEN", "unit-test")
os.environ.setdefault("GITHUB_REPOSITORY", "owner/repo")

import branch_pr_automation as branch_controller  # noqa: E402
import trusted_automation as automation  # noqa: E402
import autonomy_admission_check as admission_check  # noqa: E402


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
        with patch.object(automation, "REPO", "Jonathan-Harris1975/AIMS"):
            self.assertFalse(automation.sensitive_file("services/example.ts"))


class CtoTaskAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.sha = "9" * 40
        self.pr = {
            "number": 41,
            "state": "open",
            "draft": False,
            "user": {"login": "cto-new[bot]"},
            "html_url": "https://github.com/owner/repo/pull/41",
            "head": {"ref": "cto/task-40", "sha": self.sha, "repo": {"full_name": "owner/repo"}},
            "base": {"ref": "main"},
            "labels": [],
            "body": "Fixes #40",
        }
        for name, value in {
            "REPO": "owner/repo",
            "DEFAULT_BRANCH": "main",
            "CTO_LOGIN": "cto-new[bot]",
        }.items():
            self.enterContext(patch.object(automation, name, value))
        self.enterContext(patch.object(automation, "log"))

    def task(self, *, assigned=True, labelled=True):
        return {
            "number": 40,
            "state": "open",
            "assignees": [{"login": "cto-new[bot]"}] if assigned else [],
            "labels": [{"name": automation.CTO_TASK_LABEL}] if labelled else [],
        }

    def test_cto_pr_requires_single_explicit_task(self):
        with patch.object(automation, "get", return_value=self.task()):
            self.assertEqual(automation.verified_cto_task(self.pr), 40)
        self.pr["body"] = "Fixes #40 and resolves #39"
        self.assertIsNone(automation.cto_issue_reference(self.pr))

    def test_unassigned_or_unlabelled_issue_is_not_cto_authority(self):
        with patch.object(automation, "get", return_value=self.task(assigned=False)):
            self.assertIsNone(automation.verified_cto_task(self.pr))
        with patch.object(automation, "get", return_value=self.task(labelled=False)):
            self.assertIsNone(automation.verified_cto_task(self.pr))

    def test_cto_pr_is_adopted_only_after_task_verification(self):
        labels = self.enterContext(patch.object(automation, "add_labels"))
        with patch.object(automation, "verified_cto_task", return_value=40):
            automation.adopt_linked_cto_prs([copy.deepcopy(self.pr)])
        labels.assert_called_once_with(41, [automation.CTO_IMPLEMENTATION_LABEL])

    def test_cto_protected_control_change_is_held(self):
        pr = copy.deepcopy(self.pr)
        pr["labels"] = [{"name": automation.CTO_IMPLEMENTATION_LABEL}]
        risk_label = self.enterContext(patch.object(automation, "add_labels"))
        self.enterContext(patch.object(automation, "comment"))
        hold = self.enterContext(patch.object(automation, "place_human_hold"))
        admit = self.enterContext(patch.object(automation, "admit_to_mergify"))
        self.enterContext(patch.object(automation, "verified_cto_task", return_value=40))
        self.enterContext(patch.object(automation, "has_operator_risk_approval", return_value=False))
        self.enterContext(patch.object(automation, "pr_files", return_value=[".github/workflows/security.yml"]))
        automation.reconcile_pr(pr)
        hold.assert_not_called()
        admit.assert_not_called()
        risk_label.assert_called_once_with(pr["number"], [automation.RISK_APPROVAL_LABEL])

class KiloPermissionPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[2]
        cls.policy = json.loads((root / "kilo.jsonc").read_text(encoding="utf-8"))

    def test_no_prompt_policy_keeps_governance_non_editable(self):
        permission = self.policy["permission"]
        self.assertEqual(permission["question"], "deny")
        self.assertEqual(permission["external_directory"], "deny")
        protected = [
            "kilo.jsonc",
            ".github/workflows/*",
            ".github/actions/*",
            ".github/scripts/*",
            ".mergify.yml",
            "renovate.json",
            ".github/dependabot.yml",
            "scripts/secret_scan.py",
        ]
        for tool in ("edit", "write", "apply_patch"):
            rules = permission[tool]
            self.assertEqual(rules["*"], "allow")
            for pattern in protected:
                self.assertEqual(rules[pattern], "deny")
                self.assertLess(list(rules).index("*"), list(rules).index(pattern))

    def test_shell_is_deny_by_default_with_exact_safe_pushes(self):
        bash = self.policy["permission"]["bash"]
        self.assertEqual(bash["*"], "deny")
        for command in (
            "git push origin HEAD",
            "git push --set-upstream origin HEAD",
            "git push -u origin HEAD",
        ):
            self.assertEqual(bash[command], "allow")
        self.assertNotIn("git push origin HEAD*", bash)
        self.assertNotIn("git push --set-upstream origin HEAD*", bash)
        for command in (
            "git push *:*",
            "git push +*",
            "git push *--force*",
            "git push * -f*",
            "bash -c *",
            "sh -c *",
            "sudo *",
            "gh pr merge *",
            "wrangler deploy *",
            "koyeb *",
        ):
            self.assertEqual(bash[command], "deny")

    def test_main_branch_checkout_is_denied_after_general_checkout_allow(self):
        bash = self.policy["permission"]["bash"]
        self.assertEqual(bash["git checkout *"], "allow")
        self.assertEqual(bash["git switch *"], "allow")
        for command in (
            "git checkout main",
            "git checkout -B main *",
            "git checkout -b main *",
            "git switch main",
            "git switch -C main *",
            "git switch -c main *",
        ):
            self.assertEqual(bash[command], "deny")
            self.assertGreater(list(bash).index(command), list(bash).index("git checkout *") if command.startswith("git checkout") else list(bash).index("git switch *"))


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
                "repo": {"full_name": "Jonathan-Harris1975/AIMS"},
            },
            "base": {"ref": "main"},
            "labels": [{"name": "automation:branch-pr"}],
            "body": "",
        }
        for name, value in {
            "REPO": "Jonathan-Harris1975/AIMS",
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

        admit.assert_called_once_with(22, self.sha)
        approve.assert_not_called()

    def test_managed_branch_pr_touching_protected_controls_gets_human_hold(self):
        risk_label = self.enterContext(patch.object(automation, "add_labels"))
        self.enterContext(patch.object(automation, "comment"))
        hold = self.enterContext(patch.object(automation, "place_human_hold"))
        admit = self.enterContext(patch.object(automation, "admit_to_mergify"))
        self.enterContext(
            patch.object(automation, "pr_files", return_value=[".github/workflows/security.yml"])
        )
        self.enterContext(patch.object(automation, "has_operator_risk_approval", return_value=False))

        automation.reconcile_pr(copy.deepcopy(self.pr))

        hold.assert_not_called()
        admit.assert_not_called()
        risk_label.assert_called_once_with(self.pr["number"], [automation.RISK_APPROVAL_LABEL])

class CouncilEvidenceFreezeTests(unittest.TestCase):
    def setUp(self):
        self.sha = "d" * 40
        for name, value in {"REPO": "owner/repo", "DEFAULT_BRANCH": "main"}.items():
            self.enterContext(patch.object(automation, name, value))

    @staticmethod
    def weekend_bounds():
        return (datetime(2026, 10, 2, 20, tzinfo=automation.LONDON),
                datetime(2026, 10, 5, 4, tzinfo=automation.LONDON))

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

    def test_short_final_page_wins_over_stale_total_count(self):
        page = {"workflow_runs": [], "total_count": 150}
        with patch.object(automation, "current_weekend_bounds", return_value=self.weekend_bounds()), patch.object(automation, "get", return_value=page):
            runs = automation._fetch_branch_runs()
        self.assertEqual(runs, [])

    def test_exact_1000_workflow_runs_is_complete_not_overflow(self):
        page = {"workflow_runs": [{} for _ in range(100)], "total_count": 1000}
        with patch.object(automation, "current_weekend_bounds", return_value=self.weekend_bounds()), patch.object(automation, "get", side_effect=[page for _ in range(10)]):
            runs = automation._fetch_branch_runs()
        self.assertEqual(len(runs), 1000)

    def test_more_than_1000_workflow_runs_fails_closed(self):
        page = {"workflow_runs": [{} for _ in range(100)], "total_count": 1001}
        with patch.object(automation, "current_weekend_bounds", return_value=self.weekend_bounds()), patch.object(automation, "get", side_effect=[page for _ in range(10)]):
            with self.assertRaises(RuntimeError):
                automation._fetch_branch_runs()



class ProductionGovernanceProtectionTests(unittest.TestCase):
    def test_contract_is_sensitive_and_kilo_cannot_mutate_it(self):
        path = ".github/production-governance.json"
        self.assertTrue(automation.sensitive_file(path))
        root = Path(__file__).resolve().parents[2]
        policy = json.loads((root / "kilo.jsonc").read_text(encoding="utf-8"))
        for tool in ("edit", "write", "apply_patch"):
            self.assertEqual(policy["permission"][tool][path], "deny")



    def test_main_repair_reserves_marker_before_kilo_and_acknowledges_after(self):
        root = Path(__file__).resolve().parents[1]
        workflow = (root / "workflows/autonomous-repair.yml").read_text(encoding="utf-8")
        start = workflow.index("dispatch_kilo() {")
        end = workflow.index('\n\n          if [ "$RUN_CONCLUSION"', start)
        dispatch = workflow[start:end]
        for operation in ("gh api --method POST", 'status="$(curl', "gh api --method PATCH"):
            self.assertIn(operation, dispatch)
        reservation = dispatch.index("gh api --method POST")
        request = dispatch.index('status="$(curl')
        acknowledgement = dispatch.rindex("gh api --method PATCH")
        self.assertLess(reservation, request)
        self.assertLess(request, acknowledgement)
        self.assertIn('--field body="$marker', dispatch)
        self.assertIn("--jq '.id'", dispatch)
        self.assertIn("dispatch-state: pending", dispatch)
        self.assertIn("dispatch-state: accepted", dispatch)
        self.assertIn("dispatch-state: rejected-http-$status", dispatch)
        self.assertIn('rejected_attempts" -ge 2', dispatch)
        self.assertEqual(dispatch.count("for patch_attempt in 1 2; do"), 2)
        self.assertIn("both attempts to mark the reservation retryable failed", dispatch)
        self.assertIn('status="000"', dispatch)



class TrustedAdmissionProofTests(unittest.TestCase):
    @patch.dict(os.environ, {"ADMISSION_TOKEN": "unit-test", "REPO": "owner/repo"})
    @patch("autonomy_admission_check._request")
    def test_success_proof_is_created_for_exact_head(self, request):
        request.side_effect = [{"check_runs": []}, {"id": 1}]
        sha = "a" * 40
        self.assertTrue(
            admission_check.set_admission_check(17, sha, "success", "verified")
        )
        method, path, payload = request.call_args_list[1].args
        self.assertEqual(method, "POST")
        self.assertEqual(path, "/repos/owner/repo/check-runs")
        self.assertEqual(payload["head_sha"], sha)
        self.assertEqual(payload["name"], "Trusted autonomy admission")
        self.assertEqual(payload["conclusion"], "success")

    @patch.dict(os.environ, {"ADMISSION_TOKEN": "unit-test", "REPO": "owner/repo"})
    @patch("autonomy_admission_check._request")
    def test_uppercase_head_sha_is_normalized_before_publication(self, request):
        request.side_effect = [{"check_runs": []}, {"id": 1}]
        sha = "A" * 40
        self.assertTrue(
            admission_check.set_admission_check(20, sha, "success", "verified")
        )
        payload = request.call_args_list[1].args[2]
        self.assertEqual(payload["head_sha"], sha.lower())
        self.assertEqual(
            payload["external_id"],
            f"trusted-autonomy-admission:20:{sha.lower()}",
        )

    @patch.dict(os.environ, {"ADMISSION_TOKEN": "unit-test", "REPO": "owner/repo"})
    @patch("autonomy_admission_check._request")
    def test_existing_check_is_updated_only_when_owned_by_actions(self, request):
        request.side_effect = [
            {"check_runs": [
                {"id": 11, "app": {"slug": "other-app"}, "started_at": "2026-01-01T00:00:00Z"},
                {"id": 12, "app": {"slug": "github-actions"}, "name": "Trusted autonomy admission", "head_sha": "b" * 40, "external_id": "trusted-autonomy-admission:18:" + "b" * 40, "started_at": "2026-01-02T00:00:00Z"},
            ]},
            {},
        ]
        sha = "b" * 40
        self.assertTrue(
            admission_check.set_admission_check(18, sha, "failure", "withheld")
        )
        method, path, payload = request.call_args_list[1].args
        self.assertEqual(method, "PATCH")
        self.assertEqual(path, "/repos/owner/repo/check-runs/12")
        self.assertEqual(payload["head_sha"], sha)
        self.assertEqual(payload["conclusion"], "failure")

    @patch.dict(os.environ, {"ADMISSION_TOKEN": "unit-test", "REPO": "owner/repo"})
    @patch("autonomy_admission_check._request")
    def test_unverified_pr_does_not_create_a_failure_check_unless_label_was_forged(self, request):
        request.return_value = {"check_runs": []}
        self.assertFalse(
            admission_check.set_admission_check(
                19, "c" * 40, "failure", "not eligible", create_if_missing=False
            )
        )
        self.assertEqual(request.call_count, 1)
        self.assertEqual(request.call_args.args[0], "GET")


class AdmissionLifecycleProofTests(unittest.TestCase):
    def test_label_alone_is_withdrawn_when_trusted_validation_did_not_admit(self):
        number = 201
        sha = "d" * 40
        pr = {"number": number, "head": {"sha": sha}, "labels": [{"name": "autonomy:admitted"}]}
        with (
            patch.dict(os.environ, {"ADMISSION_TOKEN": "unit-test", "REPO": "owner/repo"}),
            patch.object(automation, "_reconcile_pr_candidate"),
            patch.object(automation, "set_admission_check") as set_check,
            patch.object(automation, "remove_label") as remove_label,
        ):
            automation.reconcile_pr(pr)
        self.assertEqual(set_check.call_count, 2)
        self.assertEqual(set_check.call_args_list[0].args[:3], (number, sha, "failure"))
        args, kwargs = set_check.call_args
        self.assertEqual(args[:3], (number, sha, "failure"))
        self.assertTrue(kwargs["create_if_missing"])
        remove_label.assert_called_once_with(number, "autonomy:admitted")

    def test_only_successful_trusted_validation_keeps_admission(self):
        number = 202
        sha = "e" * 40
        pr = {"number": number, "head": {"sha": sha}, "labels": [{"name": "autonomy:admitted"}]}
        def verified(candidate):
            automation.VERIFIED_ADMISSION_HEADS.add((number, sha))
            automation.set_admission_check(number, sha, "success", "current trusted evidence passed")
        with (
            patch.dict(os.environ, {"ADMISSION_TOKEN": "unit-test", "REPO": "owner/repo"}),
            patch.object(automation, "_reconcile_pr_candidate", side_effect=verified),
            patch.object(automation, "set_admission_check") as set_check,
            patch.object(automation, "remove_label") as remove_label,
        ):
            automation.reconcile_pr(pr)
        self.assertEqual(set_check.call_count, 2)
        self.assertEqual(set_check.call_args_list[0].args[:3], (number, sha, "failure"))
        self.assertEqual(set_check.call_args_list[1].args[:3], (number, sha, "success"))
        remove_label.assert_not_called()


class OwnerCodexAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.sha = "f" * 40
        self.pr = {
            "number": 301,
            "state": "open",
            "draft": False,
            "user": {"login": "owner"},
            "head": {
                "ref": "codex/fix-low-risk",
                "sha": self.sha,
                "repo": {"full_name": "owner/repo"},
            },
            "base": {"ref": "main"},
            "labels": [],
            "body": "Verified routine task",
        }
        self.enterContext(patch.object(automation, "REPO", "owner/repo"))
        self.enterContext(patch.object(automation, "DEFAULT_BRANCH", "main"))
        self.enterContext(patch.object(automation, "REPAIR_APP_LOGIN", "repair[bot]"))

    def test_owner_authored_same_repo_codex_branch_is_recognized(self):
        self.assertTrue(automation.is_owner_codex_pr(self.pr))
        self.assertEqual(automation.automation_kind(self.pr), "codex")

    def test_fork_author_draft_and_non_codex_branches_are_not_eligible(self):
        for change in (
            {"head": {"ref": "codex/fix-low-risk", "sha": self.sha, "repo": {"full_name": "fork/repo"}}},
            {"user": {"login": "someone-else"}},
            {"head": {"ref": "feature/fix-low-risk", "sha": self.sha, "repo": {"full_name": "owner/repo"}}},
            {"draft": True},
        ):
            candidate = copy.deepcopy(self.pr)
            candidate.update(change)
            self.assertFalse(automation.is_owner_codex_pr(candidate))

    def test_owner_exact_head_risk_approval(self):
        owner_review = {
            "state": "APPROVED",
            "commit_id": self.sha,
            "submitted_at": (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat(),
            "user": {"login": "owner"},
        }
        with patch.object(
            automation,
            "get",
            side_effect=lambda endpoint: [owner_review] if "/reviews?" in endpoint else [],
        ):
            self.assertTrue(automation.has_operator_risk_approval(int(self.pr['number']), self.sha))
            self.assertFalse(automation.has_operator_risk_approval(int(self.pr["number"]), "b" * 40))

        rejected_review = dict(owner_review, state="CHANGES_REQUESTED")
        owner_comment = {
            "body": f"/risk-approve {self.sha}",
            "created_at": (datetime.now(timezone.utc) - timedelta(minutes=4)).isoformat(),
            "user": {"login": "owner"},
        }
        with patch.object(
            automation,
            "get",
            side_effect=lambda endpoint: (
                [rejected_review] if "/reviews?" in endpoint
                else [owner_comment] if "/comments?" in endpoint
                else []
            ),
        ):
            self.assertTrue(automation.has_operator_risk_approval(int(self.pr['number']), self.sha))

    def test_sensitive_owner_codex_changes_require_operator_risk_approval(self):
        with (
            patch.dict(os.environ, {"ADMISSION_TOKEN": "unit-test", "REPO": "owner/repo"}),
            patch.object(automation, "pr_files", return_value=[".github/workflows/ci.yml"]),
            patch.object(automation, "has_operator_risk_approval", return_value=False),
            patch.object(automation, "add_labels") as add_risk_label,
            patch.object(automation, "comment") as risk_comment,
            patch.object(automation, "admit_to_mergify") as admit,
            patch.object(automation, "set_admission_check"),
            patch.object(automation, "remove_label"),
            patch.object(automation, "council_evidence_freeze", return_value=(False, "clear")),
        ):
            automation.reconcile_pr(self.pr)
        add_risk_label.assert_called_once_with(
            int(self.pr["number"]), [automation.RISK_APPROVAL_LABEL]
        )
        risk_comment.assert_called_once()
        admit.assert_not_called()




class AdmissionRetryDelayTests(unittest.TestCase):
    @patch("autonomy_admission_check.time.time", return_value=30)
    def test_retry_after_http_date_is_parsed(self, _now):
        self.assertEqual(
            admission_check._retry_delay(
                "Thu, 01 Jan 1970 00:00:45 GMT", None, None, 0
            ),
            15.0,
        )

    def test_delta_seconds_and_invalid_headers(self):
        self.assertEqual(admission_check._retry_delay("5", None, None, 0), 5.0)
        self.assertEqual(admission_check._retry_delay("invalid", None, None, 2), 4.0)

    @patch("autonomy_admission_check.time.time", return_value=30)
    def test_rate_limit_reset_is_bounded(self, _now):
        self.assertEqual(admission_check._retry_delay(None, "100", "0", 1), 30.0)



class NativeAutoMergeCurrentLabelTests(unittest.TestCase):
    def test_fresh_hold_label_blocks_auto_merge_enable(self):
        summary = {
            "number": 7,
            "labels": [{"name": "autonomy:admitted"}],
            "node_id": "PR_node_7",
        }
        detail = {
            "state": "open",
            "draft": False,
            "base": {"ref": "main"},
            "head": {"sha": "a" * 40},
            "mergeable": True,
            "labels": [
                {"name": "autonomy:admitted"},
                {"name": "autonomy:human-hold"},
            ],
        }
        with (
            patch.object(native_auto_merge, "merge_request", return_value=None),
            patch.object(native_auto_merge, "request", return_value=detail),
            patch.object(native_auto_merge, "admission_check", return_value=(True, True)),
            patch.object(native_auto_merge, "enable") as enable,
        ):
            native_auto_merge.reconcile(summary)
        enable.assert_not_called()

    def test_removed_admission_label_revokes_existing_auto_merge(self):
        summary = {
            "number": 7,
            "labels": [{"name": "autonomy:admitted"}],
            "node_id": "PR_node_7",
        }
        detail = {
            "state": "open",
            "draft": False,
            "base": {"ref": "main"},
            "head": {"sha": "a" * 40},
            "mergeable": True,
            "labels": [],
        }
        active = {"enabledAt": "2026-01-01T00:00:00Z", "mergeMethod": "SQUASH"}
        with (
            patch.object(native_auto_merge, "merge_request", return_value=active),
            patch.object(native_auto_merge, "request", return_value=detail),
            patch.object(native_auto_merge, "admission_check", return_value=(False, True)),
            patch.object(native_auto_merge, "disable") as disable,
        ):
            native_auto_merge.reconcile(summary)
        disable.assert_called_once_with("PR_node_7")

    def test_uncomputed_mergeability_preserves_existing_auto_merge(self):
        summary = {
            "number": 7,
            "labels": [{"name": "autonomy:admitted"}],
            "node_id": "PR_node_7",
        }
        detail = {
            "state": "open",
            "draft": False,
            "base": {"ref": "main"},
            "head": {"sha": "a" * 40},
            "mergeable": None,
            "labels": [{"name": "autonomy:admitted"}],
        }
        active = {"enabledAt": "2026-01-01T00:00:00Z", "mergeMethod": "SQUASH"}
        with (
            patch.object(native_auto_merge, "merge_request", return_value=active),
            patch.object(native_auto_merge, "request", return_value=detail),
            patch.object(native_auto_merge, "admission_check", return_value=(True, True)),
            patch.object(native_auto_merge, "enable") as enable,
            patch.object(native_auto_merge, "disable") as disable,
        ):
            native_auto_merge.reconcile(summary)
        enable.assert_not_called()
        disable.assert_not_called()

    def test_admission_evidence_from_another_pr_does_not_count(self):
        sha = "a" * 40
        runs = [{
            "app": {"slug": "github-actions"},
            "name": native_auto_merge.ADMISSION_CHECK,
            "external_id": f"trusted-autonomy-admission:99:{sha}",
            "status": "completed",
            "conclusion": "success",
        }]
        with patch.object(native_auto_merge, "request", return_value={"check_runs": runs}):
            self.assertEqual(native_auto_merge.admission_check(7, sha), (False, False))

    def test_open_pr_listing_fails_closed_at_safety_limit(self):
        page = [{"number": number} for number in range(100)]
        with patch.object(native_auto_merge, "request", side_effect=[page] * 10) as request:
            with self.assertRaisesRegex(RuntimeError, "1,000-item safety limit"):
                native_auto_merge.pages("/repos/owner/repo/pulls?state=open")
        self.assertEqual(request.call_count, 10)


    def test_native_merge_method_uses_a_strategy_enabled_by_repo(self):
        with patch.object(
            native_auto_merge,
            "request",
            return_value={"allow_squash_merge": False, "allow_merge_commit": True, "allow_rebase_merge": True},
        ):
            self.assertEqual(native_auto_merge.merge_method(), "MERGE")


class RiskPolicyRegressionTests(unittest.TestCase):
    def test_repository_security_deployment_and_dependency_paths_are_high_risk(self):
        cases = {
            "AIMS": (
                "services/shared/middleware/suiteAuth.js",
                "services/comms-hub/domain/rbac.js",
                "services/comms-hub/domain/promptSecurity.js",
                "scripts/deployCommsHubDataPlaneWorker.js",
                "config/deployment-check.js",
            ),
            "AIMS-UI": ("workers/gateway/index.js", "workers/gateway/security.ts", "scripts/deploy-production.mjs"),
            "HIVE": ("requirements.in", "requirements-dev.txt", "backend/app/core/security.py"),
            "HIVE-UI": ("workers/gateway/security.ts", "src/lib/session.ts", "src/context/AuthContext.tsx"),
            "MAST": ("src/security.js",),
        }
        for repo, paths in cases.items():
            with self.subTest(repo=repo), patch.object(automation, "REPO", f"Jonathan-Harris1975/{repo}"):
                for path in paths:
                    with self.subTest(path=path):
                        self.assertTrue(automation.sensitive_file(path), path)

    def test_exact_sensitive_paths_are_normalized_before_matching(self):
        with patch.object(automation, "REPO", "Jonathan-Harris1975/AIMS"):
            self.assertTrue(automation.sensitive_file(r".github\scripts\trusted_automation.py"))

    def test_renames_classify_both_old_and_new_paths(self):
        with patch.object(
            automation,
            "get",
            return_value=[{"filename": "docs/new-name.md", "previous_filename": ".github/workflows/ci.yml"}],
        ):
            self.assertEqual(
                automation.pr_files(12),
                ["docs/new-name.md", ".github/workflows/ci.yml"],
            )

    def test_stale_risk_hold_is_removed_after_risky_path_leaves_current_diff(self):
        pr = {"number": 12, "labels": [{"name": automation.RISK_APPROVAL_LABEL}]}
        with (
            patch.object(automation, "REPO", "Jonathan-Harris1975/AIMS"),
            patch.object(automation, "remove_label") as remove_label,
            patch.object(automation, "log"),
        ):
            self.assertFalse(automation.require_operator_risk_approval(pr, ["routes/example.js"], "codex"))
        remove_label.assert_called_once_with(12, automation.RISK_APPROVAL_LABEL)

    def test_owner_exact_head_comment_can_approve_owner_authored_codex_pr(self):
        sha = "a" * 40
        owner_comment = {
            "body": f"/risk-approve {sha}",
            "created_at": (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat(),
            "user": {"login": "Jonathan-Harris1975"},
        }
        with (
            patch.object(automation, "REPO", "Jonathan-Harris1975/AIMS"),
            patch.object(automation, "get", side_effect=lambda endpoint: [owner_comment] if "/comments?" in endpoint else []),
        ):
            self.assertTrue(automation.has_operator_risk_approval(12, sha))
            self.assertFalse(automation.has_operator_risk_approval(12, "b" * 40))

    def test_exact_head_comment_must_follow_the_latest_owner_review(self):
        sha = "c" * 40
        review = {
            "state": "CHANGES_REQUESTED",
            "commit_id": sha,
            "submitted_at": (datetime.now(timezone.utc) - timedelta(minutes=4)).isoformat(),
            "user": {"login": "Jonathan-Harris1975"},
        }
        earlier_comment = {
            "body": f"/risk-approve {sha}",
            "created_at": (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat(),
            "user": {"login": "Jonathan-Harris1975"},
        }
        with (
            patch.object(automation, "REPO", "Jonathan-Harris1975/AIMS"),
            patch.object(automation, "get", side_effect=lambda endpoint: [review] if "/reviews?" in endpoint else [earlier_comment]),
        ):
            self.assertFalse(automation.has_operator_risk_approval(12, sha))




class RiskApprovalExpiryTests(unittest.TestCase):
    def setUp(self):
        self.sha = "a" * 40

    def test_approval_ttl_is_explicitly_bounded(self):
        self.assertEqual(automation.RISK_APPROVAL_TTL.days, 7)

    def test_recent_exact_head_owner_review_is_accepted(self):
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        with patch.object(automation, "REPO", "owner/repo"), patch.object(
            automation, "get",
            side_effect=[
                [{"user": {"login": "owner"}, "state": "APPROVED", "commit_id": self.sha, "submitted_at": now}],
                [],
            ],
        ):
            self.assertTrue(automation.has_operator_risk_approval(42, self.sha))

    def test_expired_or_wrong_head_review_is_rejected(self):
        from datetime import datetime, timedelta, timezone
        old = (datetime.now(timezone.utc) - timedelta(days=8)).isoformat()
        cases = [
            (self.sha, old),
            ("b" * 40, datetime.now(timezone.utc).isoformat()),
        ]
        for commit_id, submitted_at in cases:
            with self.subTest(commit_id=commit_id, submitted_at=submitted_at), patch.object(
                automation, "REPO", "owner/repo"
            ), patch.object(
                automation, "get",
                side_effect=[
                    [{"user": {"login": "owner"}, "state": "APPROVED", "commit_id": commit_id, "submitted_at": submitted_at}],
                    [],
                ],
            ):
                self.assertFalse(automation.has_operator_risk_approval(42, self.sha))

    def test_exact_head_approval_comment_is_accepted_only_while_fresh(self):
        from datetime import datetime, timedelta, timezone
        fresh = datetime.now(timezone.utc).isoformat()
        stale = (datetime.now(timezone.utc) - timedelta(days=8)).isoformat()
        for timestamp, expected in ((fresh, True), (stale, False)):
            with self.subTest(timestamp=timestamp), patch.object(
                automation, "REPO", "owner/repo"
            ), patch.object(
                automation, "get",
                side_effect=[
                    [],
                    [{"user": {"login": "owner"}, "body": f"/risk-approve {self.sha}", "created_at": timestamp}],
                ],
            ):
                self.assertEqual(
                    automation.has_operator_risk_approval(42, self.sha), expected
                )



if __name__ == "__main__":
    unittest.main()


class KiloControlPlaneProtectionTests(unittest.TestCase):
    def test_kilo_cannot_change_project_overrides_or_its_repair_contract(self):
        root = Path(__file__).resolve().parents[2]
        policy = json.loads((root / "kilo.jsonc").read_text(encoding="utf-8"))
        protected = (
            ".kilo/**",
            ".kilocode/**",
            ".github/kilo-machine-repair-contract.md",
        )
        for tool in ("edit", "write", "apply_patch"):
            rules = policy["permission"][tool]
            for pattern in protected:
                self.assertEqual(rules[pattern], "deny")
                self.assertLess(list(rules).index("*"), list(rules).index(pattern))
