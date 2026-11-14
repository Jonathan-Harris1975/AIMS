import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evidenceChunks } from '../audits/utils/stagedAuditReview.js';
import { createAuditCapacityQueue, isAuditInFlightRefusal } from '../services/shared/utils/auditCapacity.js';

const busy = () => Object.assign(new Error('OpenRouter in_flight_budget_exhausted'), {status:402,retryAfterMs:120000});

test('paid audits wait sequentially and retry the explicit in-flight refusal once', async () => {
  const queue = createAuditCapacityQueue();
  const events = [];
  let calls = 0;
  const first = queue(async () => { events.push('first'); if (++calls === 1) throw busy(); return 'report'; }, {
    wait: async delay => { assert.equal(delay,120000); events.push('wait'); await new Promise(r=>setImmediate(r)); }
  });
  const second = queue(async () => { events.push('second'); return 'next'; });
  assert.deepEqual(await Promise.all([first,second]),['report','next']);
  assert.deepEqual(events,['first','wait','first','second']);
});

test('credit shortage and unrelated failures are not retried', async () => {
  for (const error of [Object.assign(new Error('Insufficient credits'),{status:402}), Object.assign(new Error('timeout'),{status:503})]) {
    let calls=0;
    await assert.rejects(createAuditCapacityQueue()(async()=>{calls++;throw error;},{wait:async()=>assert.fail('must not wait')}));
    assert.equal(calls,1);
  }
  assert.equal(isAuditInFlightRefusal(Object.assign(busy(),{status:400})),false);
});

test('a persistent refusal stops after two attempts and releases the queue', async () => {
  const queue=createAuditCapacityQueue();let calls=0;
  await assert.rejects(queue(async()=>{calls++;throw busy();},{wait:async()=>{}}));
  assert.equal(calls,2);
  assert.equal(await queue(async()=> 'released'),'released');
});

test('aborted requests do not run after the capacity wait', async () => {
  const controller=new AbortController();let calls=0;
  await assert.rejects(createAuditCapacityQueue()(async()=>{calls++;throw busy();},{
    signal:controller.signal,wait:async()=>controller.abort(new Error('cancelled'))
  }),/cancelled/);
  assert.equal(calls,1);
});

test('both website source analyses use staged economy requests with capped output', () => {
  for (const path of ['audits/utils/digitalGrowthAnalysis.js','audits/utils/seoAeoGeoAnalysis.js']) {
    const source=fs.readFileSync(path,'utf8');
    assert.doesNotMatch(source,/resilientRequest\("auditForensic"/);
    assert.match(source,/resilientRequest\("auditFinalReport"/);
    assert.match(source,/await reviewAuditEvidence\(/);
    assert.match(source,/Math\.min\(10000,/);
  }
});


test('optional undefined source fields are omitted without failing website analysis', () => {
  const chunks = evidenceChunks({generatedAt:undefined,baseUrl:undefined,inventory:{pages:7},missing:null});
  assert.deepEqual(chunks.map(c=>c.source),['inventory','missing']);
  assert.deepEqual(JSON.parse(chunks[0].evidence),{pages:7});
  assert.equal(chunks[1].evidence,'null');
});
