import crypto from "node:crypto";
import { beginJob, completeJob, failJob, flushJobStoreWrites, getPublicJobFresh } from "./jobStore.js";
import { info, error as logError } from "../../../logger.js";

function trim(value) {
  return String(value || "").trim();
}

function slug(value) {
  return trim(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "service";
}

function hookdeckEventId(req = {}) {
  return req.hookdeckEventId
    || req.get?.("x-hookdeck-eventid")
    || req.get?.("x-hookdeck-event-id")
    || req.headers?.["x-hookdeck-eventid"]
    || req.headers?.["x-hookdeck-event-id"]
    || null;
}

function boolEnv(name, fallback = false, env = process.env) {
  const raw = String(env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

export function shouldRunAsyncServiceRoute(req = {}, env = process.env) {
  if (!boolEnv("HOOKDECK_ASYNC_SERVICE_ROUTES", true, env)) return false;
  if (boolEnv("ASYNC_SERVICE_ROUTES_ALWAYS", false, env)) return true;
  if (String(req.query?.async || "").toLowerCase() === "true") return true;
  if (req.body?.async === true || String(req.body?.async || "").toLowerCase() === "true") return true;
  return Boolean(hookdeckEventId(req));
}

export function asyncServiceJobType(service, lane) {
  return `service:${slug(service)}:${slug(lane)}`;
}

export function asyncServiceSessionId(service, lane, payload = {}) {
  return trim(payload.sessionId) || `${slug(service)}-${slug(lane)}-${crypto.randomUUID()}`;
}

function statusUrlFor(req, service, lane, sessionId) {
  const path = `/${slug(service)}/jobs/${slug(lane)}/${encodeURIComponent(sessionId)}`;
  if (!req?.protocol || !req?.get) return path;
  return `${req.protocol}://${req.get("host")}${path}`;
}

function publicShape(service, lane, job, req = null) {
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
    statusUrl: job.statusUrl || statusUrlFor(req, service, lane, job.sessionId),
    result: job.result,
    error: job.error,
  };
}

async function executeServiceJob({ service, lane, sessionId, payload, runner, metadata = {} }) {
  const jobType = asyncServiceJobType(service, lane);
  try {
    const result = await runner(payload);
    const completed = completeJob(jobType, sessionId, {
      ...metadata,
      result,
      ok: result?.ok !== false,
    });
    await flushJobStoreWrites({ throwOnError: false });
    info("service.async_route.completed", { service, lane, sessionId, ok: result?.ok !== false });
    return completed;
  } catch (err) {
    const failed = failJob(jobType, sessionId, err, metadata);
    await flushJobStoreWrites({ throwOnError: false });
    logError("service.async_route.failed", { service, lane, sessionId, message: err?.message || String(err) });
    return failed;
  }
}

export async function startAsyncServiceRouteJob({ service, lane, payload = {}, runner, req = null, metadata = {} }) {
  if (typeof runner !== "function") throw new Error("Async service route runner must be a function");
  const sessionId = asyncServiceSessionId(service, lane, payload);
  const jobType = asyncServiceJobType(service, lane);
  const statusUrl = statusUrlFor(req, service, lane, sessionId);
  const payloadWithSession = { ...payload, sessionId };
  const { started, job } = beginJob(jobType, sessionId, {
    service,
    lane,
    route: metadata.route || `${service}.${lane}`,
    eventId: hookdeckEventId(req),
    statusUrl,
    hookdeckAsync: true,
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
    ...publicShape(service, lane, job, req),
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
