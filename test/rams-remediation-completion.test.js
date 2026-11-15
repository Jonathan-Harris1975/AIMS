import test from 'node:test';
import assert from 'node:assert/strict';
import { readRamsRemediationCompletion } from '../audits/utils/ramsRemediationCompletion.js';
const config = { baseUrl: 'https://rams.test', apiKey: 'key', timeoutMs: 100 };
const read = body => readRamsRemediationCompletion({pipeline:'content',runId:'run-1',config,
  fetchImpl:async()=>new Response(JSON.stringify(body),{status:200})});
const state = {pipeline:'content',runId:'run-1',status:'completed',manualReview:[],batches:[]};
test('only verified repairs can close an actionable audit',async()=>{
  assert.equal((await read(state)).status,'completed');
  assert.match((await read({...state,batches:[{status:'verified',mergeSha:'a'.repeat(40)}]})).error,/lacks verified/);
  assert.match((await read({...state,manualReview:[{id:'unresolved'}]})).error,/lacks verified/);
  assert.equal((await read({...state,batches:[{status:'verified',mergeSha:'a'.repeat(40),
    verification:{regressionTestPath:'test/repair.test.js',productionCheck:'Deployment'}}]})).status,'completed');
});
test('source identity and status must match the exact run',async()=>{
  assert.match((await read({...state,runId:'other'})).error,/identity mismatch/);
  assert.match((await read({...state,status:'accepted'})).error,/status is invalid/);
});
test('temporary status failures leave the durable job pending',async()=>{
  for (const fetchImpl of [async()=>{throw new TypeError('network');},async()=>new Response('',{status:503})]) {
    const result=await readRamsRemediationCompletion({pipeline:'content',runId:'run-1',config,fetchImpl});
    assert.equal(result.status,'pending');
    assert.ok(result.probeError);
  }
});

test('malformed ledgers produce attention instead of pretending to be network failures',async()=>{
  for (const value of [null,{...state,batches:[null]}]) {
    const result=await read(value);
    assert.equal(result.status,'attention_required');
    assert.ok(result.error);
    assert.equal(result.probeError,undefined);
  }
});
