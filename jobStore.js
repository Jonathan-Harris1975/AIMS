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

function loadJobs() {
  const persisted = readJsonState(STATE_FILE, { jobs: [] });
  const jobs = Array.isArray(persisted?.jobs) ? persisted.jobs : [];

  return new Map(
    jobs
      .filter((job) => job && typeof job.type === "string" && typeof job.sessionId === "string")
      .map((job) => [makeKey(job.type, job.sessionId), job])
  );
}

const jobs = loadJobs();

function persistJobs() {
  writeJsonState(STATE_FILE, {
    jobs: [...jobs.values()],
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
    attempt: Number(existing?.attempt || 0),
    ...existing,
    ...patch,
  };

  jobs.set(key, next);
  persistJobs();
  return cloneJob(next);
}

function isActiveStatus(status) {
  return status === "queued" || status === "running";
}

export function startJob(type, sessionId, metadata = {}) {
  const existing = jobs.get(makeKey(type, sessionId));
  const attempt = Number(existing?.attempt || 0) + 1;

  return upsertJob(type, sessionId, {
    status: "running",
    attempt,
    startedAt: nowIso(),
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
  const error =
    err instanceof Error
      ? { message: err.message, stack: err.stack }
      : { message: String(err) };

  return upsertJob(type, sessionId, {
    status: "failed",
    finishedAt: nowIso(),
    error,
    ...metadata,
  });
}

export function getJob(type, sessionId) {
  pruneExpired();
  return cloneJob(jobs.get(makeKey(type, sessionId)));
}
