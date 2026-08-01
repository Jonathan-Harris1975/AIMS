import { readJsonState, writeJsonState } from "./stateFile.js";

const STATE_FILE = "request-dedupe.json";
const DEFAULT_TTL_MS = Number(process.env.REQUEST_DEDUPE_TTL_MS) || 6 * 60 * 60 * 1000;

function loadSeenRequests() {
  const persisted = readJsonState(STATE_FILE, { entries: [] });
  const entries = Array.isArray(persisted?.entries) ? persisted.entries : [];

  return new Map(
    entries
      .filter((entry) => entry && typeof entry.key === "string")
      .map((entry) => [
        entry.key,
        {
          state: entry.state === "completed" ? "completed" : "pending",
          expiresAt: Number(entry.expiresAt) || 0,
        },
      ])
  );
}

const seenRequests = loadSeenRequests();

function persistSeenRequests() {
  const entries = [...seenRequests.entries()].map(([key, value]) => ({
    key,
    state: value?.state === "completed" ? "completed" : "pending",
    expiresAt: Number(value?.expiresAt) || 0,
  }));

  writeJsonState(STATE_FILE, { entries });
}

function cleanupExpired(now = Date.now()) {
  let changed = false;
  for (const [key, record] of seenRequests.entries()) {
    if (!record?.expiresAt || record.expiresAt <= now) {
      seenRequests.delete(key);
      changed = true;
    }
  }
  if (changed) persistSeenRequests();
}

function makeRecord(state, ttlMs = DEFAULT_TTL_MS) {
  return { state, expiresAt: Date.now() + ttlMs };
}

function makeKey(scope, idempotencyKey) {
  return `${scope}:${idempotencyKey}`;
}

export function getRequestIdempotencyKey(req = {}) {
  const raw =
    req.idempotencyKey ||
    req.get?.("x-idempotency-key") ||
    req.get?.("x-trigger-run-key") ||
    req.headers?.["x-idempotency-key"] ||
    req.headers?.["x-trigger-run-key"];

  if (typeof raw !== "string") return null;
  const idempotencyKey = raw.trim();
  return idempotencyKey || null;
}

export function claimRequest(req, scope = "global") {
  cleanupExpired();
  const idempotencyKey = getRequestIdempotencyKey(req);
  if (!idempotencyKey) {
    return { idempotencyKey: null, isDuplicate: false, key: null, state: null };
  }

  const key = makeKey(scope, idempotencyKey);
  const existing = seenRequests.get(key);
  if (existing) {
    return { idempotencyKey, key, isDuplicate: true, state: existing.state };
  }

  seenRequests.set(key, makeRecord("pending"));
  persistSeenRequests();
  return { idempotencyKey, key, isDuplicate: false, state: "pending" };
}

export function completeRequest(scope, idempotencyKey) {
  if (!idempotencyKey) return;
  const key = makeKey(scope, idempotencyKey);
  if (!seenRequests.has(key)) return;
  seenRequests.set(key, makeRecord("completed"));
  persistSeenRequests();
}

export function releaseRequest(scope, idempotencyKey) {
  if (!idempotencyKey) return;
  const key = makeKey(scope, idempotencyKey);
  if (!seenRequests.delete(key)) return;
  persistSeenRequests();
}

export function requestDedupe(scope) {
  return (req, res, next) => {
    const { idempotencyKey, isDuplicate, state } = claimRequest(req, scope);
    if (idempotencyKey) req.idempotencyKey = idempotencyKey;

    if (isDuplicate) {
      return res.status(202).json({
        ok: true,
        duplicate: true,
        idempotencyKey,
        state,
        message: "Duplicate idempotent request ignored",
      });
    }

    if (!idempotencyKey) return next();

    let settled = false;
    const finalize = () => {
      if (settled) return;
      settled = true;
      if (res.statusCode >= 400) releaseRequest(scope, idempotencyKey);
      else completeRequest(scope, idempotencyKey);
    };
    const onClose = () => {
      if (settled) return;
      settled = true;
      releaseRequest(scope, idempotencyKey);
    };

    res.once("finish", finalize);
    res.once("close", onClose);
    return next();
  };
}
