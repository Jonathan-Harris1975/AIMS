import crypto from "node:crypto";
import { beginJob, completeJob, failJob, flushJobStoreWrites, getPublicJobFresh } from "./jobStore.js";
import { info, error as logError } from "../../../logger.js";
import { getRequestIdempotencyKey } from "./requestDedupe.js";
import { statusUrlFor } from "./asyncServiceStatusUrl.js";

function trim(value) {
  return String(value || "").trim();
}

function slug(value) {
  return trim(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "service";
}

function requestIdempotencyKey(req = {}) {
  return getRequestIdempotencyKey(req || {});
}

function boolEnv(name, fallback = false, env = process.env) {
  const raw = String(env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

export function shouldRunAsyncServiceRoute(req = {}, env = process.env) {
  if (!boolEnv("ASYNC_SERVICE_ROUTES_ENABLED", true, env)) return false;
  if (boolEnv("ASYNC_SERVICE_ROUTES_ALWAYS", false, env)) return true;
  if (String(req.query?.async || "").toLowerCase() === "true") return true;
  if (req.body?.async === true || String(req.body?.async || "").toLowerCase() === "true") return true;
  return Boolean(requestIdempotencyKey(req));
}

export function asyncServiceJobType(service, lane) {
  return `service:${slug(service)}:${slug(lane)}`;
}

export function asyncServiceSessionId(service, lane, payload = {}) {
  return trim(payload.sessionId) || `${slug(service)}-${slug(lane)}-${crypto.randomUUID()}`;
}

function publicShape(service, lane, job, req = null, statusBasePath = "") {
  if (!job) return null;
  return {
    ok: true,
    accepted: job.status === "queued" || job.status === "running",
    service,
    lane,
    sessionId: job.sessionId,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    attempt: job.attempt,
    statusUrl: job.statusUrl || statusUrlFor(req, service, lane, job.sessionId, statusBasePath),
    result: job.result,
    error: job.error,
  };
}

async function executeServiceJob({ service, lane, sessionId, payload, runner, metadata = {} }) {
  const jobType = asyncServiceJobType(service, lane);
  try {
    const result = await runner(payload);
    const succeeded = result?.ok !== false;
    const job = succeeded
      ? completeJob(jobType, sessionId, { ...metadata, result, ok: true })
      : failJob(jobType, sessionId, new Error(
        String(result?.error || result?.reason || "Async service task returned ok:false").slice(0, 500),
      ), { ...metadata, result, ok: false });
    await flushJobStoreWrites({ throwOnError: false });
    const outcome = !succeeded
      ? (result?.quarantined ? "quarantined" : "not-ok")
      : (result?.skipped ? "skipped" : "succeeded");
    (succeeded ? info : logError)(succeeded ? "service.async_route.completed" : "service.async_route.result_failed", {
      service,
      lane,
      sessionId,
      ok: succeeded,
      outcome,
      skipped: Boolean(result?.skipped),
      quarantined: Boolean(result?.quarantined),
      reason: result?.reason || null,
    });
    return job;
  } catch (err) {
    const failed = failJob(jobType, sessionId, err, metadata);
    await flushJobStoreWrites({ throwOnError: false });
    logError("service.async_route.failed", { service, lane, sessionId, message: err?.message || String(err) });
    return failed;
  }
}

export async function startAsyncServiceRouteJob({ service, lane, payload = {}, runner, req = null, statusBasePath = "", metadata = {}, reuseTerminal = false }) {
  if (typeof runner !== "function") throw new Error("Async service route runner must be a function");
  const sessionId = asyncServiceSessionId(service, lane, payload);
  const jobType = asyncServiceJobType(service, lane);
  const statusUrl = statusUrlFor(req, service, lane, sessionId, statusBasePath);
  const payloadWithSession = { ...payload, sessionId };
  // A confirmed published result is immutable for this schedule window.
  // Failed, ambiguous or unconfirmed results may resume under the same
  // deterministic ID, but never beyond three total attempts. Durable Zernio
  // slot leases remain the publication-level duplicate barrier.
  if (reuseTerminal) {
    const previous = await getPublicJobFresh(jobType, sessionId);
    const result = previous?.result;
    const published = previous?.status === "completed"
      && result?.ok === true
      && result?.partialFailure !== true
      && result?.confirmed !== false
      && result?.reason !== "same-slot-already-running";
    const terminal = ["completed", "failed"].includes(previous?.status);
    const exhausted = terminal && !published && Number(previous?.attempt || 0) >= 3;
    if (published || exhausted) {
      return {
        ...publicShape(service, lane, previous, req, statusBasePath),
        ok: published,
        started: false, duplicateJob: true, accepted: false,
        retryExhausted: exhausted,
        message: published
          ? "Original confirmed service job already completed; no duplicate publication."
          : "Original service job is unconfirmed or failed; bounded attempts exhausted.",
      };
    }
  }
  const { started, job } = beginJob(jobType, sessionId, {
    service,
    lane,
    route: metadata.route || `${service}.${lane}`,
    eventId: requestIdempotencyKey(req),
    statusUrl,
    requestAsync: true,
    ...metadata,
  });

  if (started) {
    setImmediate(() => {
      executeServiceJob({ service, lane, sessionId, payload: payloadWithSession, runner, metadata: { statusUrl, ...metadata } })
        .catch((err) => logError("service.async_route.unhandled", { service, lane, sessionId, message: err?.message || String(err) }));
    });
  }

  await flushJobStoreWrites({ throwOnError: false });
  return {
    ...publicShape(service, lane, job, req, statusBasePath),
    started,
    duplicateJob: !started,
    accepted: true,
    message: started
      ? "Service job accepted. Poll the status URL for completion."
      : "Service job is already queued or running for this session.",
  };
}

export async function getAsyncServiceRouteJobFresh(service, lane, sessionId, req = null) {
  return publicShape(service, lane, await getPublicJobFresh(asyncServiceJobType(service, lane), sessionId), req);
}

export default {
  shouldRunAsyncServiceRoute,
  asyncServiceJobType,
  startAsyncServiceRouteJob,
  getAsyncServiceRouteJobFresh,
};
