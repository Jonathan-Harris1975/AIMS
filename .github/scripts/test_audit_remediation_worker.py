import importlib.util
import pathlib
import unittest
from unittest.mock import patch

path = pathlib.Path(__file__).with_name('audit_remediation_worker.py')
spec = importlib.util.spec_from_file_location('audit_worker_tested', path)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
REPO = 'Jonathan-Harris1975/AIMS'


class AuditWorkerTests(unittest.TestCase):
    def test_storage_credentials_trim_copy_paste_whitespace_before_signing(self):
        from unittest.mock import MagicMock
        response=MagicMock()
        response.__enter__.return_value=response
        response.read.return_value=b'{}'
        response.headers.get.return_value='etag'
        with patch.dict(worker.os.environ,{'R2_ACCESS_KEY_ID':' test-access\n','R2_SECRET_ACCESS_KEY':'test-secret\n'}):
            with patch.object(worker.urllib.request,'urlopen',return_value=response) as opened:
                worker.s3('GET','audits','qa-suite/reports/test.json')
                authorization=opened.call_args.args[0].get_header('Authorization')
                self.assertNotIn('\n',authorization)
                self.assertIn('Credential=test-access/',authorization)

    def test_non_audit_pr_never_reads_secrets(self):
        with patch.object(worker, 's3', side_effect=AssertionError('unneeded storage read')):
            self.assertTrue(worker.audit_scope_admission({'head': {'ref': 'fix/ordinary'}}))

    def test_an_active_other_writer_blocks_atomic_claim(self):
        with patch.object(worker, 's3', return_value=({'status': 'active', 'kind': 'audit', 'fingerprint': 'other'}, 'etag')):
            self.assertFalse(worker.acquire_writer(REPO, 'new', 'audit'))

    def test_claim_cannot_overwrite_a_new_owner_after_release(self):
        old = {'status':'active','kind':'pr','fingerprint':'old'}
        new = {'status':'active','kind':'audit','fingerprint':'racing-owner'}
        with patch.object(worker,'s3',side_effect=[(old,'old-etag'),(new,'new-etag')]) as storage:
            with patch.object(worker,'release_verified',return_value=True):
                self.assertFalse(worker.acquire_writer(REPO,'requester','audit'))
                self.assertEqual(storage.call_count,2)

    def test_linked_kilo_child_reuses_its_source_writer(self):
        lease = {'status':'active','kind':'pr','fingerprint':'pr:7','sourcePr':7,'sourceSha':'a'*40}
        child = {'number':8,'user':{'login':'kilo-code-bot[bot]'},'head':{'ref':'kilo/fix','sha':'b'*40,
            'repo':{'full_name':REPO}},'body':f'Repairs https://github.com/{REPO}/pull/7.'}
        with patch.dict(worker.os.environ,{'KILO_REPAIR_PR_LOGIN':'kilo-code-bot[bot]'}):
            with patch.object(worker,'s3',return_value=(lease,'etag')):
                with patch.object(worker,'gh',return_value={'behind_by':0,'status':'ahead'}):
                    self.assertTrue(worker.guard_pr_repair(REPO,child))
                child['body']=f'Repairs https://github.com/{REPO}/pull/70'
                with patch.object(worker,'acquire_writer',return_value=False),patch.object(worker,'gh') as github:
                    self.assertFalse(worker.guard_pr_repair(REPO,child))
                    github.assert_not_called()

    def test_create_once_collision_does_not_acquire_writer(self):
        with patch.object(worker, 's3', side_effect=[(None, None), (False, None)]) as storage:
            self.assertFalse(worker.acquire_writer(REPO, 'new', 'audit'))
            self.assertEqual(storage.call_args.kwargs['condition'], {'if-none-match': '*'})

    def test_reuse_requires_same_fingerprint(self):
        lease = {'status': 'active', 'kind': 'audit', 'fingerprint': 'same'}
        with patch.object(worker, 's3', return_value=(lease, 'etag')) as storage:
            self.assertTrue(worker.acquire_writer(REPO, 'same', 'audit'))
            self.assertEqual(storage.call_count, 1)

    def test_audit_pr_requires_owned_scope_and_regression_test(self):
        pr = {'number': 7, 'head': {'ref': 'fix/rams-audit-'+'a'*24}, 'base': {'repo': {'full_name': REPO}}}
        lease = {'status': 'active', 'kind': 'audit', 'branch': pr['head']['ref'], 'planKey': 'plan'}
        plan = {'tasks': [{'affectedPaths': ['services/example.js']}], 'regressionTestPath': 'test/regression.test.js'}
        with patch.object(worker, 's3', return_value=(lease, 'etag')), patch.object(worker, 'read_plan', return_value=plan):
            with patch.object(worker, 'gh', return_value=[{'filename': 'services/example.js'}]):
                self.assertFalse(worker.audit_scope_admission(pr))
            with patch.object(worker, 'gh', return_value=[{'filename':'services/example.js'}, {'filename':'test/regression.test.js'}]):
                self.assertTrue(worker.audit_scope_admission(pr))
            with patch.object(worker, 'gh', return_value=[{'filename':'unrelated.js'}, {'filename':'test/regression.test.js'}]):
                self.assertFalse(worker.audit_scope_admission(pr))

    def test_ci_repair_cannot_compete_with_active_audit(self):
        lease = {'status':'active', 'kind':'audit', 'branch':'fix/rams-audit-owner'}
        with patch.object(worker, 's3', return_value=(lease, 'etag')):
            self.assertFalse(worker.guard_pr_repair(REPO, {'number':7, 'head':{'ref':'fix/other'}}))
            self.assertTrue(worker.guard_pr_repair(REPO, {'number':8, 'head':{'ref':'fix/rams-audit-owner'}}))

    def test_release_requires_verified_receipt_for_exact_owner(self):
        lease={'kind':'audit','fingerprint':'a'*64,'planKey':'qa-suite/reports/remediation/content/run/groups/'+'a'*64+'.json'}
        with patch.object(worker, 's3', return_value=({'schemaVersion':'audit-remediation-verification/v1','repository':REPO,
            'batchId':'b'*64,'mergeSha':'c'*40}, 'etag')) as storage:
            self.assertFalse(worker.release_verified_audit(REPO,lease,'lease-etag'))
            self.assertEqual(storage.call_count,1)

    def test_duplicate_event_cannot_overwrite_uncertain_provider_handoff(self):
        with patch.object(worker, 'read_plan', return_value={}), patch.object(worker, 's3', return_value=({'workflowRun':'earlier'},'etag')) as storage:
            worker.dispatch('qa-suite/reports/remediation/content/run/groups/'+'a'*64+'.json',REPO)
            self.assertEqual(storage.call_count,1)
            self.assertEqual(storage.call_args.args[0],'GET')

    def test_missing_provider_config_never_claims_or_reserves_a_writer(self):
        import hashlib
        plan={'auditJsonKey':'source','auditDigest':hashlib.sha256(worker.encoded({})).hexdigest(),
              'baseBranch':'main','sourceSha':'a'*40,'batchId':'b'*64,'branch':'fix/rams-audit-'+'b'*24,
              'regressionTestPath':'test/repair.test.js','tasks':[]}
        import sys
        sys.path.insert(0,str(path.parent))
        with patch.dict(worker.os.environ,{'KILO_REPAIR_TRIGGER_URL':''}):
            with patch.object(worker,'read_plan',return_value=plan),patch.object(worker,'gh',return_value={'sha':'a'*40}):
                with patch.object(worker,'s3',side_effect=[(None,None),({},None),(None,None)]) as storage:
                    with patch.object(worker,'acquire_writer',side_effect=AssertionError('must not claim')):
                        self.assertRaisesRegex(RuntimeError,'trigger required',worker.dispatch,'plan.json',REPO)
                    self.assertEqual(storage.call_args.args[3]['status'],'configuration_pending')

    def test_protected_paths_cannot_be_audit_scope(self):
        for path in ['../x','/etc/passwd','.github/workflows/ci.yml','package-lock.json','a\\b']:
            self.assertTrue(worker.protected(path))
        self.assertFalse(worker.protected('services/rss/prompt.js'))


if __name__ == '__main__':
    unittest.main()
