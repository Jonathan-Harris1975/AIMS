// The job store has several process writers (server and bootstrap utilities).
// Replace only after merging the current object under an exact R2 ETag.
export function retainJob(job, now = Date.now(), ttlMs = 86400000) {
  if (String(job.type || '').startsWith('audit:') && job.status !== 'completed' &&
      (['queued','running'].includes(job.status) || job.result?.remediationPending || job.evidenceRetentionRequired ||
       ['awaiting-remediation','remediation-blocked'].includes(job.phase))) return true;
  const updated = Date.parse(job.updatedAt || '');
  const visualEvidence = /^blotato-[a-z-]+-publish$/.test(String(job.type || '')) && job.status === 'completed' && job.result?.renderedVideoQa;
  const retentionMs = visualEvidence ? Math.max(ttlMs, 35 * 86400000) : ttlMs;
  return Number.isFinite(updated) && now - updated <= retentionMs;
}

export function mergeJobSnapshots(remote, incoming, {now = Date.now(), ttlMs = 86400000} = {}) {
  if (!Array.isArray(remote?.jobs) || !Array.isArray(incoming?.jobs)) throw new Error('Invalid durable job-store snapshot');
  const jobs = new Map(), retired = new Map();
  const identity = row => JSON.stringify([row.type,row.sessionId]);
  for (const snapshot of [remote,incoming]) {
    if (snapshot.retired !== undefined && !Array.isArray(snapshot.retired)) throw new Error('Invalid retired job versions');
    for (const row of snapshot.retired || []) {
      if (!row || typeof row.type !== 'string' || typeof row.sessionId !== 'string' || !Number.isFinite(Date.parse(row.updatedAt))) {
        throw new Error('Invalid retired job version');
      }
      const key=identity(row), previous=retired.get(key);
      if (!previous || Date.parse(row.updatedAt) >= Date.parse(previous.updatedAt)) retired.set(key,row);
    }
  }
  for (const row of [...remote.jobs,...incoming.jobs]) {
    if (!row || typeof row.type !== 'string' || typeof row.sessionId !== 'string') throw new Error('Invalid durable job identity');
    const key = identity(row), previous = jobs.get(key);
    if (String(row.type).startsWith('audit:') && ['completed','failed'].includes(row.status) && !Number.isFinite(Date.parse(row.updatedAt))) {
      if (!retired.has(key) || Date.parse(retired.get(key).updatedAt) <= now) {
        retired.set(key,{type:row.type,sessionId:row.sessionId,status:row.status,updatedAt:new Date(now).toISOString(),
          timestampBasis:'terminal_state_observed_without_valid_timestamp',sourceUpdatedAt:typeof row.updatedAt==='string'?row.updatedAt:null});
      }
      continue;
    }
    if (!previous || (Date.parse(row.updatedAt) || 0) >= (Date.parse(previous.updatedAt) || 0)) jobs.set(key,row);
  }
  const retained=[];
  for (const [key,row] of jobs) {
    const terminal=retired.get(key);
    if (terminal && Date.parse(terminal.updatedAt) >= (Date.parse(row.updatedAt) || 0)) continue;
    if (retainJob(row,now,ttlMs)) {
      retired.delete(key);
      retained.push(row);
    } else if (String(row.type).startsWith('audit:') && ['completed','failed'].includes(row.status)) {
      // Keep only its terminal version after payload expiry, so an arbitrarily
      // old process snapshot cannot resurrect a formerly running audit later.
      retired.set(key,{type:row.type,sessionId:row.sessionId,updatedAt:row.updatedAt,status:row.status});
    }
  }
  return {jobs:retained,...(retired.size?{retired:[...retired.values()]}:{})};
}

function missing(error) {
  return error?.$metadata?.httpStatusCode === 404 || error?.status === 404 || ['NoSuchKey','NotFound'].includes(error?.name || error?.code);
}

function conflict(error) {
  return [409,412].includes(error?.$metadata?.httpStatusCode || error?.status) ||
    ['PreconditionFailed','ConditionalRequestConflict'].includes(error?.name || error?.code);
}

export async function persistJobSnapshot(snapshot, {read,write,ttlMs = 86400000,maxAttempts = 5}) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let object;
    try { object = await read(); } catch(error) { if (!missing(error)) throw error; }
    if (object && !object.eTag) throw new Error('Durable job store is missing its ETag; refusing an unconditional overwrite');
    const remote = object ? JSON.parse(object.text) : {jobs:[]};
    const merged = mergeJobSnapshots(remote,snapshot,{ttlMs});
    try {
      await write(merged,object ? {ifMatch:object.eTag} : {ifNoneMatch:'*'});
      return merged;
    } catch(error) {
      if (!conflict(error) || attempt === maxAttempts - 1) throw error;
    }
  }
  throw new Error('Durable job-store contention exceeded its bounded retry budget');
}
