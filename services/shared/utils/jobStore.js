import { readJsonState, writeJsonState } from "./stateFile.js";

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

function loadJobs() {
  const persisted = readJsonState(STATE_FILE, { jobs: [] });
  const jobs = Array.isArray(persisted?.jobs) ? persisted.jobs : [];

  return new Map(
    jobs
      .filter((job) => job && typeof job.type === "string" && typeof job.sessionId === "string")
      .map((job) => [makeKey(job.type, job.sessionId), { ...job, error: sanitiseJobError(job.error) }])
  );
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

export function getJob(type, sessionId) {
  pruneExpired();
  return cloneJob(jobs.get(makeKey(type, sessionId)));
}

export function getPublicJob(type, sessionId) {
  return toPublicJob(getJob(type, sessionId));
}
