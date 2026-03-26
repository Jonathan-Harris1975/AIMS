import { readJsonState, writeJsonState } from "./stateFile.js";

const STATE_FILE = "job-store.json";
const JOB_TTL_MS = Number(process.env.JOB_STATUS_TTL_MS) || 24 * 60 * 60 * 1000;

function makeKey(type, sessionId) {
  return `${type}:${sessionId}`;
}

function nowIso() {
  return new Date().toISOString();
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

function existingOrNow(type, sessionId) {
  const existing = jobs.get(makeKey(type, sessionId));
  return existing?.startedAt || nowIso();
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
  };

  jobs.set(key, next);
  persistJobs();
  return next;
}

export function startJob(type, sessionId, metadata = {}) {
  return upsertJob(type, sessionId, {
    status: "running",
    startedAt: existingOrNow(type, sessionId),
    finishedAt: undefined,
    error: undefined,
    ...metadata,
  });
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
  const job = jobs.get(makeKey(type, sessionId));
  return job ? { ...job } : null;
}
