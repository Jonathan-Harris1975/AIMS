import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverContentAuditJob } from '../audits/utils/contentAuditJobRecovery.js';
const id='saved-audit',prefix=`audits/content-master/2026-11/${id}`,key=`${prefix}/content-audit.json`;
const latest={sessionId:id,reportPrefix:prefix,reportJsonUrl:`r2://audits/${key}`,
  ramsDispatch:{ok:true,pipeline:'content',runId:'run-1',auditJsonKey:key,status:'awaiting-remediation'}};
const report={schemaVersion:'content-audit-report/v2',sessionId:id,council:{synthesisState:'Complete'},sourceRefresh:{freshnessLocked:true}};
const reader=(l=latest,r=report)=>async({key:requested})=>requested.endsWith('latest.json')?l:r;

test('lost content bookkeeping is restored pending RAMS verification without running paid work',async()=>{
  const recovered=await recoverContentAuditJob(id,reader());
  assert.equal(recovered.status,'running');
  assert.equal(recovered.phase,'awaiting-remediation');
  assert.equal(recovered.result.ramsDispatch.runId,'run-1');
  assert.equal(recovered.result.recoveredFromReport,true);
  assert.equal(recovered.result.remediationPending,true);
});
test('another session, changed report identity or wrong handoff cannot certify completion',async()=>{
  assert.equal(await recoverContentAuditJob('other',reader()),null);
  await assert.rejects(recoverContentAuditJob(id,reader(latest,{...report,sessionId:'other'})),/identity mismatch/);
  const recovered=await recoverContentAuditJob(id,reader({...latest,ramsDispatch:{...latest.ramsDispatch,auditJsonKey:'other'}}));
  assert.equal(recovered.status,'failed');
  assert.equal(recovered.result.remediationPending,false);
});
test('incomplete synthesis remains failed and storage errors cannot trigger new source work',async()=>{
  const recovered=await recoverContentAuditJob(id,reader(latest,{...report,council:{synthesisState:'Incomplete'}}));
  assert.equal(recovered.status,'failed');
  await assert.rejects(recoverContentAuditJob(id,async()=>{throw new Error('AccessDenied');}),/AccessDenied/);
});
