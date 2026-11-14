import test from 'node:test';
import assert from 'node:assert/strict';
import { readRamsRemediationCompletion } from '../audits/utils/ramsRemediationCompletion.js';
const config = { baseUrl: 'https://rams.test', apiKey: 'key', timeoutMs: 100 };
const read = body => readRamsRemediationCompletion({pipeline:'content',runId:'run-1',config,
  fetchImpl:async()=>new Response(JSON.stringify(body),{status:200})});
const state = {pipeline:'content',runId:'run-1',status:'completed',manualReview:[],batches:[]};
test('only verified repairs can close an actionable audit',async()=>{
  assert.equal((await read(state)).status,'completed');
  await assert.rejects(read({...state,batches:[{status:'verified',mergeSha:'a'.repeat(40)}]}),/lacks verified/);
  await assert.rejects(read({...state,manualReview:[{id:'unresolved'}]}),/lacks verified/);
  assert.equal((await read({...state,batches:[{status:'verified',mergeSha:'a'.repeat(40),
    verification:{regressionTestPath:'test/repair.test.js',productionCheck:'Deployment'}}]})).status,'completed');
});
test('source identity and status must match the exact run',async()=>{
  await assert.rejects(read({...state,runId:'other'}),/identity mismatch/);
  await assert.rejects(read({...state,status:'accepted'}),/status is invalid/);
});
test('temporary status failures leave the durable job pending',async()=>{
  for (const fetchImpl of [async()=>{throw new TypeError('network');},async()=>new Response('',{status:503})]) {
    const result=await readRamsRemediationCompletion({pipeline:'content',runId:'run-1',config,fetchImpl});
    assert.equal(result.status,'pending');
    assert.ok(result.probeError);
  }
});
