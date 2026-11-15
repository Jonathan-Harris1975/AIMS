import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeJobSnapshots, persistJobSnapshot } from '../services/shared/utils/jobStatePersistence.js';

const job=(id,extra={})=>({type:'audit:website',sessionId:id,status:'running',updatedAt:new Date().toISOString(),...extra});

test('stale process snapshots cannot delete other running audit jobs',()=>{
  const current=job('source',{updatedAt:'2026-11-15T10:00:00Z',phase:'awaiting-remediation'});
  const stale=job('source',{updatedAt:'2026-11-15T09:00:00Z',phase:'seo'});
  const merged=mergeJobSnapshots({jobs:[current,job('other')]},{jobs:[stale,job('new')]});
  assert.equal(merged.jobs.length,3);
  assert.equal(merged.jobs.find(row=>row.sessionId==='source').phase,'awaiting-remediation');
});

test('two overlapping writers merge under the exact ETag instead of overwriting each other',async()=>{
  let stored={jobs:[job('original')]},version=1,reads=0,release;
  const bothRead=new Promise(resolve=>{release=resolve;});
  const read=async()=>{
    const result={text:JSON.stringify(stored),eTag:`"${version}"`};
    if (++reads===2) release();
    if (reads<=2) await bothRead;
    return result;
  };
  const write=async(value,{ifMatch})=>{
    if(ifMatch!==`"${version}"`) throw Object.assign(new Error('conflict'),{$metadata:{httpStatusCode:412}});
    stored=value;version++;
  };
  await Promise.all([
    persistJobSnapshot({jobs:[job('writer-a')]},{read,write}),
    persistJobSnapshot({jobs:[job('writer-b')]},{read,write}),
  ]);
  assert.deepEqual(stored.jobs.map(row=>row.sessionId).sort(),['original','writer-a','writer-b']);
  assert.equal(reads,3);
});

test('unknown, malformed or unauthenticated storage cannot turn into an empty overwrite',async()=>{
  let writes=0;
  const write=async()=>{writes++;};
  await assert.rejects(persistJobSnapshot({jobs:[]},{read:async()=>{throw new Error('AccessDenied');},write}),/AccessDenied/);
  await assert.rejects(persistJobSnapshot({jobs:[]},{read:async()=>({text:'{broken',eTag:'"1"'}),write}),SyntaxError);
  await assert.rejects(persistJobSnapshot({jobs:[]},{read:async()=>({text:'{"jobs":[]}',eTag:null}),write}),/ETag/);
  assert.equal(writes,0);
});

test('first storage write is conditional and contention has a bounded retry budget',async()=>{
  let writes=0;
  await assert.rejects(persistJobSnapshot({jobs:[job('new')]},{
    read:async()=>{throw Object.assign(new Error('missing'),{name:'NoSuchKey'});},
    write:async(_value,condition)=>{assert.deepEqual(condition,{ifNoneMatch:'*'});writes++;
      throw Object.assign(new Error('conflict'),{$metadata:{httpStatusCode:412}});}
  }),/conflict/);
  assert.equal(writes,5);
});

test('unfinished source audits survive TTL while expired terminal jobs are removed',()=>{
  const old='2020-01-01T00:00:00Z';
  const result=mergeJobSnapshots({jobs:[job('active',{updatedAt:old}),job('retained',{updatedAt:old,status:'failed',evidenceRetentionRequired:true}),
    job('done',{updatedAt:old,status:'completed'})]},{jobs:[]});
  assert.deepEqual(result.jobs.map(row=>row.sessionId),['active','retained']);
});

test('a fresh transition replaces an older active record without a valid timestamp',()=>{
  const result=mergeJobSnapshots({jobs:[job('legacy',{updatedAt:undefined})]},{jobs:[job('legacy',{phase:'awaiting-remediation'})]});
  assert.equal(result.jobs[0].phase,'awaiting-remediation');
});

test('audit admission hydrates the existing R2 parent before deciding whether to start a runner',async()=>{
  const {execFile}=await import('node:child_process');
  const {promisify}=await import('node:util');
  const {mkdtemp}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const script=`
    import assert from 'node:assert/strict';
    import {Readable} from 'node:stream';
    const r2=await import('./services/shared/utils/r2-client.js');
    const saved={jobs:[{type:'audit:content-master:route-run',sessionId:'persisted-parent',status:'running',updatedAt:new Date().toISOString()}]};
    r2.s3.send=async command=>{
      if(command.constructor.name==='GetObjectCommand'&&command.input.Key==='state/job-store.json'){
        await new Promise(resolve=>setTimeout(resolve,25));
        return {Body:Readable.from([JSON.stringify(saved)]),ETag:'"1"'};
      }
      throw Object.assign(new Error('missing'),{name:'NoSuchKey'});
    };
    const {startAsyncAuditRouteJob}=await import('./audits/utils/asyncAuditRouteJobs.js');
    let runs=0;
    const result=await startAsyncAuditRouteJob({auditType:'content-master',payload:{sessionId:'persisted-parent'},runner:async()=>{runs++;}});
    assert.equal(result.started,false);
    assert.equal(runs,0);
    console.log('PRESERVED');process.exit(0);
  `;
  const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script],{
    cwd:new URL('..',import.meta.url),timeout:15000,
    env:{...process.env,LOG_LEVEL:'silent',STATE_BACKEND:'r2',R2_ENDPOINT:'https://example.invalid',R2_ACCESS_KEY_ID:'test-access',
      R2_SECRET_ACCESS_KEY:'test-secret',R2_BUCKET_META_SYSTEM:'metasystem',APP_STATE_DIR:await mkdtemp(join(tmpdir(),'audit-hydration-'))}
  });
  assert.match(stdout,/PRESERVED/);
});

test('expired terminal audits cannot be resurrected by an earlier running snapshot, including later writes',()=>{
  const completed=job('finished',{status:'completed',updatedAt:'2020-01-02T00:00:00Z'});
  const stale=job('finished',{updatedAt:'2020-01-01T00:00:00Z'});
  const first=mergeJobSnapshots({jobs:[completed]},{jobs:[stale]});
  assert.equal(first.jobs.length,0);
  assert.equal(first.retired[0].status,'completed');
  const later=mergeJobSnapshots(first,{jobs:[stale]});
  assert.equal(later.jobs.length,0);
  assert.deepEqual(later.retired,first.retired);
  const retry=mergeJobSnapshots(later,{jobs:[job('finished')]});
  assert.equal(retry.jobs.length,1);
  assert.equal(retry.retired,undefined);
});

test('a duplicate audit request survives an unrelated shared write failure without starting another runner',async()=>{
  const {execFile}=await import('node:child_process');
  const {promisify}=await import('node:util');
  const {mkdtemp}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const script=`
    import assert from 'node:assert/strict';
    import {Readable} from 'node:stream';
    const r2=await import('./services/shared/utils/r2-client.js');
    const saved={jobs:[{type:'audit:newsletter:route-run',sessionId:'running-parent',status:'running',updatedAt:new Date().toISOString()},
      {type:'ordinary',sessionId:'expired',status:'completed',updatedAt:'2020-01-01T00:00:00Z'}]};
    r2.s3.send=async command=>{
      if(command.constructor.name==='GetObjectCommand'&&command.input.Key==='state/job-store.json')
        return {Body:Readable.from([JSON.stringify(saved)]),ETag:'"1"'};
      if(command.constructor.name==='PutObjectCommand')throw new Error('AccessDenied');
      throw Object.assign(new Error('missing'),{name:'NoSuchKey'});
    };
    const {startAsyncAuditRouteJob}=await import('./audits/utils/asyncAuditRouteJobs.js');
    const store=await import('./services/shared/utils/jobStore.js');
    let runs=0;
    const result=await startAsyncAuditRouteJob({auditType:'newsletter',payload:{sessionId:'running-parent'},runner:async()=>{runs++;}});
    assert.equal(result.started,false);assert.equal(result.status,'running');assert.equal(runs,0);
    assert.equal(store.getJob('audit:newsletter:route-run','running-parent').status,'running');
    console.log('RUNNER_PRESERVED');process.exit(0);
  `;
  const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script],{
    cwd:new URL('..',import.meta.url),timeout:15000,
    env:{...process.env,LOG_LEVEL:'silent',STATE_BACKEND:'r2',R2_ENDPOINT:'https://example.invalid',R2_ACCESS_KEY_ID:'test-access',
      R2_SECRET_ACCESS_KEY:'test-secret',R2_BUCKET_META_SYSTEM:'metasystem',APP_STATE_DIR:await mkdtemp(join(tmpdir(),'audit-duplicate-'))}
  });
  assert.match(stdout,/RUNNER_PRESERVED/);
});
