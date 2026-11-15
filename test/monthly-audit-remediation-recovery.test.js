import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.APP_STATE_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'audit-recovery-'));
const store=await import('../services/shared/utils/jobStore.js');
const content=await import('../audits/utils/asyncAuditRouteJobs.js');
const website=await import('../audits/utils/websiteAuditPipeline.js');
const dispatch=await import('../audits/utils/ramsContentDispatch.js');
const originalFetch=globalThis.fetch;
const originalEnv={...process.env};
test.afterEach(()=>{globalThis.fetch=originalFetch;
  for(const key of Object.keys(process.env))if(!(key in originalEnv))delete process.env[key];
  Object.assign(process.env,originalEnv);
});

test('a 202 payload cannot overwrite the locally controlled pending status',async()=>{
  Object.assign(process.env,{CONTENT_AUDIT_TRIGGER_RAMS:'true',RAMS_API_KEY:'test-key',RAMS_BASE_URL:'https://rams.test'});
  globalThis.fetch=async()=>new Response(JSON.stringify({status:'accepted',ok:true,runId:'run-1'}),{status:202});
  const result=await dispatch.dispatchContentAuditToRams({sessionId:'source-1',auditJsonKey:'audits/content-master/2026-11/source-1/content-audit.json'});
  assert.equal(result.status,'awaiting-remediation');
});

test('unresolved audit parents survive TTL while ordinary completed jobs expire',()=>{
  const old=new Date(Date.now()-3*86400000).toISOString();
  store.beginJob('audit:website','retained-source',{phase:'awaiting-remediation',evidenceRetentionRequired:true,updatedAt:old});
  store.completeJob('ordinary','expired-source',{updatedAt:old});
  assert.ok(store.getJob('audit:website','retained-source'));
  assert.equal(store.getJob('ordinary','expired-source'),null);
});

test('website retry retains evidence while remediation is pending and child callbacks cannot restart reports',async()=>{
  const sessionId='website-pending-retry';
  store.beginJob(website.WEBSITE_PIPELINE_JOB_TYPE,sessionId,{
    phase:'awaiting-remediation',sourceStageHealth:{ok:true},synthesisState:'Complete',
    finalReportJsonUrl:'https://audits.test/website-audit.json',
    finalReportKeys:{json:'audits/website/2026-11/source-1/website-audit.json'},
    ramsDispatch:{ok:true,status:'awaiting-remediation',runId:'run-1'},evidenceRetentionRequired:true,
  });
  globalThis.fetch=async()=>new Response('{}',{status:202});
  const retry=await website.retryWebsiteAuditRamsDispatch(sessionId);
  assert.equal(retry.status,'running');
  assert.equal(retry.phase,'awaiting-remediation');
  assert.equal(retry.evidenceRetentionRequired,true);
  const resumed=await website.resumeWebsiteAuditPipelineFromChild({auditType:'mobile-ux',result:{job:{pipelineSessionId:sessionId}}});
  assert.equal(resumed.ignored,true);
  assert.equal(store.getJob(website.WEBSITE_PIPELINE_JOB_TYPE,sessionId).phase,'awaiting-remediation');
});

test('permanent completion probe errors fail content parent and cannot resurrect it',async()=>{
  Object.assign(process.env,{RAMS_API_KEY:'test-key',RAMS_BASE_URL:'https://rams.test'});
  const type=content.asyncAuditJobType('content-master');
  store.beginJob(type,'content-probe-failure',{phase:'awaiting-remediation',
    result:{ok:true,remediationPending:true,ramsDispatch:{runId:'run-1'}}});
  globalThis.fetch=async()=>new Response('{}',{status:401});
  const failed=await content.getAsyncAuditRouteJobFresh('content-master','content-probe-failure');
  assert.equal(failed.status,'failed');
  assert.equal(failed.result.remediationPending,false);
  globalThis.fetch=async()=>{throw new Error('failed jobs must not poll again');};
  assert.equal((await content.getAsyncAuditRouteJobFresh('content-master','content-probe-failure')).status,'failed');
});
