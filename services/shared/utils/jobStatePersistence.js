// The job store has several process writers (server and bootstrap utilities).
// Replace only after merging the current object under an exact R2 ETag.
export function retainJob(job, now = Date.now(), ttlMs = 86400000) {
  if (String(job.type || '').startsWith('audit:') && job.status !== 'completed' &&
      (['queued','running'].includes(job.status) || job.result?.remediationPending || job.evidenceRetentionRequired ||
       ['awaiting-remediation','remediation-blocked'].includes(job.phase))) return true;
  const updated = Date.parse(job.updatedAt || '');
  return Number.isFinite(updated) && now - updated <= ttlMs;
}

export function mergeJobSnapshots(remote, incoming, {now = Date.now(), ttlMs = 86400000} = {}) {
  if (!Array.isArray(remote?.jobs) || !Array.isArray(incoming?.jobs)) throw new Error('Invalid durable job-store snapshot');
  const jobs = new Map();
  for (const row of [...remote.jobs,...incoming.jobs]) {
    if (!row || typeof row.type !== 'string' || typeof row.sessionId !== 'string') throw new Error('Invalid durable job identity');
    if (!retainJob(row,now,ttlMs)) continue;
    const key = JSON.stringify([row.type,row.sessionId]);
    const previous = jobs.get(key);
    if (!previous || (Date.parse(row.updatedAt) || 0) >= (Date.parse(previous.updatedAt) || 0)) jobs.set(key,row);
  }
  return {jobs:[...jobs.values()]};
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
