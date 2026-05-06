import { flushStateWrites, readJsonState, readJsonStateFresh, writeJsonState } from "./stateFile.js";

const STATE_FILE = "job-store.json";
const JOB_TTL_MS = Number(process.env.JOB_STATUS_TTL_MS) || 24 * 60 * 60 * 1000;

function makeKey(type, sessionId) {
  return `${type}:${sessionId}`;
}

function nowIso() {
  return new Date().toISOString();
}

function cloneJob(job) {
  return job ? { ...job } : null;
}

function sanitiseJobError(err) {
  if (!err) return undefined;
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      code: err.code,
      status: err.status,
    };
  }

  if (typeof err === "object") {
    return {
      name: err.name,
      message: err.message || String(err),
      code: err.code,
      status: err.status,
    };
  }

  return { message: String(err) };
}

export function toPublicJob(job) {
  const cloned = cloneJob(job);
  if (!cloned) return null;

  if (cloned.error) {
    cloned.error = sanitiseJobError(cloned.error);
  }

  return cloned;
}

function persistedJobsFrom(value) {
  return Array.isArray(value?.jobs) ? value.jobs : [];
}

function isValidPersistedJob(job) {
  return job && typeof job.type === "string" && typeof job.sessionId === "string";
}

function mergePersistedJobs(persistedJobs = []) {
  for (const job of persistedJobs.filter(isValidPersistedJob)) {
    const key = makeKey(job.type, job.sessionId);
    const incoming = { ...job, error: sanitiseJobError(job.error) };
    const existing = jobs.get(key);
    const existingUpdated = existing?.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
    const incomingUpdated = incoming?.updatedAt ? new Date(incoming.updatedAt).getTime() : 0;

    if (!existing || incomingUpdated >= existingUpdated) {
      jobs.set(key, incoming);
    }
  }
}

function loadJobs() {
  const persisted = readJsonState(STATE_FILE, { jobs: [] });
  const loaded = new Map();

  for (const job of persistedJobsFrom(persisted).filter(isValidPersistedJob)) {
    loaded.set(makeKey(job.type, job.sessionId), { ...job, error: sanitiseJobError(job.error) });
  }

  return loaded;
}

const jobs = loadJobs();

function persistJobs() {
  writeJsonState(STATE_FILE, {
    jobs: [...jobs.values()].map((job) => ({
      ...job,
      error: sanitiseJobError(job.error),
    })),
  });
}

function pruneExpired(now = Date.now()) {
  let changed = false;

  for (const [key, job] of jobs.entries()) {
    const updated = job?.updatedAt ? new Date(job.updatedAt).getTime() : 0;
    if (!updated || now - updated > JOB_TTL_MS) {
      jobs.delete(key);
      changed = true;
    }
  }

  if (changed) {
    persistJobs();
  }
}

function upsertJob(type, sessionId, patch = {}) {
  pruneExpired();

  const key = makeKey(type, sessionId);
  const existing = jobs.get(key);
  const timestamp = nowIso();

  const next = {
    type,
    sessionId,
    status: existing?.status || "queued",
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    ...existing,
    ...patch,
    error: sanitiseJobError(patch.error ?? existing?.error),
  };

  jobs.set(key, next);
  persistJobs();
  return cloneJob(next);
}

function isActiveStatus(status) {
  return status === "queued" || status === "running";
}


export function queueJob(type, sessionId, metadata = {}) {
  return upsertJob(type, sessionId, {
    status: "queued",
    finishedAt: undefined,
    error: undefined,
    ...metadata,
  });
}

export function startJob(type, sessionId, metadata = {}) {
  const existing = jobs.get(makeKey(type, sessionId));
  const attempt = Number(existing?.attempt || 0) + 1;

  return upsertJob(type, sessionId, {
    status: "running",
    attempt,
    startedAt: existing?.startedAt || nowIso(),
    finishedAt: undefined,
    error: undefined,
    result: undefined,
    ...metadata,
  });
}

export function beginJob(type, sessionId, metadata = {}) {
  pruneExpired();

  const existing = jobs.get(makeKey(type, sessionId));
  if (existing && isActiveStatus(existing.status)) {
    return {
      started: false,
      job: cloneJob(existing),
    };
  }

  return {
    started: true,
    job: startJob(type, sessionId, metadata),
  };
}

export function completeJob(type, sessionId, metadata = {}) {
  return upsertJob(type, sessionId, {
    status: "completed",
    finishedAt: nowIso(),
    error: undefined,
    ...metadata,
  });
}

export function failJob(type, sessionId, err, metadata = {}) {
  return upsertJob(type, sessionId, {
    status: "failed",
    finishedAt: nowIso(),
    error: sanitiseJobError(err),
    ...metadata,
  });
}

export async function refreshJobStoreFromState() {
  const persisted = await readJsonStateFresh(STATE_FILE, { jobs: [] });
  mergePersistedJobs(persistedJobsFrom(persisted));
  pruneExpired();
  return true;
}

export async function flushJobStoreWrites(options = {}) {
  return flushStateWrites(options);
}

export function getJob(type, sessionId) {
  pruneExpired();
  return cloneJob(jobs.get(makeKey(type, sessionId)));
}

export async function getJobFresh(type, sessionId) {
  await refreshJobStoreFromState();
  return getJob(type, sessionId);
}

export function getJobsByType(type) {
  pruneExpired();
  return [...jobs.values()]
    .filter((job) => job.type === type)
    .map(cloneJob);
}

export function getPublicJobsByType(type) {
  return getJobsByType(type).map(toPublicJob);
}

function isRecentEnough(job, maxAgeMs) {
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return true;
  const timestamp = Date.parse(job?.updatedAt || job?.startedAt || job?.createdAt || "");
  return Number.isFinite(timestamp) && Date.now() - timestamp <= maxAgeMs;
}

export function getMostRecentActiveJob(type, { maxAgeMs = 20 * 60 * 1000 } = {}) {
  pruneExpired();
  return [...jobs.values()]
    .filter((job) => job.type === type && isActiveStatus(job.status) && isRecentEnough(job, maxAgeMs))
    .sort((a, b) => Date.parse(b.updatedAt || b.startedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.startedAt || a.createdAt || 0))
    .map(toPublicJob)[0] || null;
}

export async function getMostRecentActiveJobFresh(type, options = {}) {
  await refreshJobStoreFromState();
  return getMostRecentActiveJob(type, options);
}

export function getPublicJob(type, sessionId) {
  return toPublicJob(getJob(type, sessionId));
}

export async function getPublicJobFresh(type, sessionId) {
  return toPublicJob(await getJobFresh(type, sessionId));
}
