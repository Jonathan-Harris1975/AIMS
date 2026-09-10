import crypto from "node:crypto";
import {
  getObjectAsTextWithMetadata,
  putPrivateJson,
} from "./r2-client.js";
import { hasDurableStateEnv } from "./durableStateEnv.js";

const LOCAL_LEASES = new Map();
const DEFAULT_PENDING_TTL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_COMPLETED_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function normalise(value = "") {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function useRemoteLeaseBackend() {
  const mode = normalise(process.env.STATE_BACKEND || "auto");
  if (["local", "file", "filesystem"].includes(mode)) return false;
  return hasDurableStateEnv(process.env);
}

function leaseObjectKey(namespace, key) {
  const safeNamespace = normalise(namespace || "shared")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "shared";
  const digest = crypto.createHash("sha256").update(normalise(key)).digest("hex");
  return `leases/${safeNamespace}/${digest}.json`;
}

function isMissingObject(error) {
  const status = Number(error?.$metadata?.httpStatusCode || error?.statusCode || error?.status || 0);
  const text = `${error?.name || ""} ${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  return status === 404 || /nosuchkey|not[ -]?found|specified key does not exist/.test(text);
}

function isPreconditionFailure(error) {
  const status = Number(error?.$metadata?.httpStatusCode || error?.statusCode || error?.status || 0);
  const text = `${error?.name || ""} ${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  return status === 409 || status === 412 || /precondition|conditionalrequestconflict/.test(text);
}

function positiveTtl(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function makeRecord({ namespace, key, ownerToken, state = "pending", pendingTtlMs, completedTtlMs, metadata = {}, result = null }) {
  const now = Date.now();
  const ttl = state === "completed" ? completedTtlMs : pendingTtlMs;
  return {
    schemaVersion: 1,
    namespace,
    key,
    ownerToken,
    state,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAt: now + ttl,
    metadata,
    result,
  };
}

function publicLease({ namespace, key, ownerToken, objectKey, backend, pendingTtlMs, completedTtlMs }) {
  return {
    namespace,
    key,
    ownerToken,
    objectKey,
    backend,
    pendingTtlMs,
    completedTtlMs,
  };
}

function duplicateResult(record = {}, objectKey, backend) {
  return {
    claimed: false,
    duplicatePrevented: true,
    state: record.state || "pending",
    reason: record.state === "completed" ? "already-completed" : "already-owned",
    existing: record,
    objectKey,
    backend,
  };
}

async function readRemoteLease(objectKey) {
  try {
    const response = await getObjectAsTextWithMetadata("metaSystem", objectKey);
    return {
      record: JSON.parse(String(response.text || "{}")),
      eTag: response.eTag,
    };
  } catch (error) {
    if (isMissingObject(error)) return null;
    throw error;
  }
}

export async function claimDurableLease({
  namespace,
  key,
  pendingTtlMs = DEFAULT_PENDING_TTL_MS,
  completedTtlMs = DEFAULT_COMPLETED_TTL_MS,
  metadata = {},
  force = false,
} = {}) {
  const cleanNamespace = normalise(namespace || "shared");
  const cleanKey = normalise(key);
  if (!cleanKey) throw new Error("Durable lease key is required");

  const safePendingTtl = positiveTtl(pendingTtlMs, DEFAULT_PENDING_TTL_MS);
  const safeCompletedTtl = positiveTtl(completedTtlMs, DEFAULT_COMPLETED_TTL_MS);
  const objectKey = leaseObjectKey(cleanNamespace, cleanKey);
  const ownerToken = crypto.randomUUID();
  const backend = useRemoteLeaseBackend() ? "r2" : "local";
  const record = makeRecord({
    namespace: cleanNamespace,
    key: cleanKey,
    ownerToken,
    pendingTtlMs: safePendingTtl,
    completedTtlMs: safeCompletedTtl,
    metadata,
  });

  if (backend === "local") {
    const existing = LOCAL_LEASES.get(objectKey);
    const active = existing && Number(existing.expiresAt || 0) > Date.now();
    if (active && (existing.state === "pending" || (!force && existing.state === "completed"))) {
      return duplicateResult(existing, objectKey, backend);
    }
    LOCAL_LEASES.set(objectKey, record);
    return {
      claimed: true,
      duplicatePrevented: false,
      state: "pending",
      lease: publicLease({ namespace: cleanNamespace, key: cleanKey, ownerToken, objectKey, backend, pendingTtlMs: safePendingTtl, completedTtlMs: safeCompletedTtl }),
      record,
    };
  }

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await putPrivateJson("metaSystem", objectKey, record, { ifNoneMatch: "*" });
      return {
        claimed: true,
        duplicatePrevented: false,
        state: "pending",
        lease: publicLease({ namespace: cleanNamespace, key: cleanKey, ownerToken, objectKey, backend, pendingTtlMs: safePendingTtl, completedTtlMs: safeCompletedTtl }),
        record,
      };
    } catch (error) {
      if (!isPreconditionFailure(error)) throw error;
    }

    const current = await readRemoteLease(objectKey);
    if (!current) continue;
    const active = Number(current.record?.expiresAt || 0) > Date.now();
    if (active && (current.record?.state === "pending" || (!force && current.record?.state === "completed"))) {
      return duplicateResult(current.record, objectKey, backend);
    }
    if (!current.eTag) throw new Error(`Durable lease '${cleanNamespace}:${cleanKey}' cannot be replaced without an ETag`);

    try {
      await putPrivateJson("metaSystem", objectKey, record, { ifMatch: current.eTag });
      return {
        claimed: true,
        duplicatePrevented: false,
        state: "pending",
        lease: publicLease({ namespace: cleanNamespace, key: cleanKey, ownerToken, objectKey, backend, pendingTtlMs: safePendingTtl, completedTtlMs: safeCompletedTtl }),
        record,
        reclaimed: true,
      };
    } catch (error) {
      if (!isPreconditionFailure(error) || attempt === 4) throw error;
    }
  }

  throw new Error(`Unable to acquire durable lease '${cleanNamespace}:${cleanKey}' after concurrent updates`);
}

async function updateRemoteLease(lease, updater) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const current = await readRemoteLease(lease.objectKey);
    if (!current || current.record?.ownerToken !== lease.ownerToken) {
      return { updated: false, reason: "lease-no-longer-owned", existing: current?.record || null };
    }
    if (!current.eTag) throw new Error(`Durable lease '${lease.namespace}:${lease.key}' cannot be updated without an ETag`);
    const next = updater(current.record);
    try {
      await putPrivateJson("metaSystem", lease.objectKey, next, { ifMatch: current.eTag });
      return { updated: true, record: next };
    } catch (error) {
      if (!isPreconditionFailure(error) || attempt === 4) throw error;
    }
  }
  return { updated: false, reason: "lease-update-conflict" };
}

export async function completeDurableLease(lease, result = {}) {
  if (!lease?.objectKey || !lease?.ownerToken) return { updated: false, reason: "missing-lease" };
  const now = Date.now();
  const update = (existing) => ({
    ...existing,
    state: "completed",
    updatedAt: new Date(now).toISOString(),
    expiresAt: now + positiveTtl(lease.completedTtlMs, DEFAULT_COMPLETED_TTL_MS),
    result,
  });

  if (lease.backend === "local") {
    const existing = LOCAL_LEASES.get(lease.objectKey);
    if (!existing || existing.ownerToken !== lease.ownerToken) return { updated: false, reason: "lease-no-longer-owned", existing: existing || null };
    const record = update(existing);
    LOCAL_LEASES.set(lease.objectKey, record);
    return { updated: true, record };
  }
  return updateRemoteLease(lease, update);
}

export async function releaseDurableLease(lease, result = {}) {
  if (!lease?.objectKey || !lease?.ownerToken) return { updated: false, reason: "missing-lease" };
  const now = Date.now();
  const update = (existing) => ({
    ...existing,
    state: "released",
    updatedAt: new Date(now).toISOString(),
    expiresAt: now - 1,
    result,
  });

  if (lease.backend === "local") {
    const existing = LOCAL_LEASES.get(lease.objectKey);
    if (!existing || existing.ownerToken !== lease.ownerToken) return { updated: false, reason: "lease-no-longer-owned", existing: existing || null };
    const record = update(existing);
    LOCAL_LEASES.set(lease.objectKey, record);
    return { updated: true, record };
  }
  return updateRemoteLease(lease, update);
}

export default {
  claimDurableLease,
  completeDurableLease,
  releaseDurableLease,
};
