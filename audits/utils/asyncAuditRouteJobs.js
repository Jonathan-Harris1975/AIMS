import crypto from "node:crypto";
import { beginJob, completeJob, failJob, flushJobStoreWrites, getPublicJob, getPublicJobFresh } from "../../services/shared/utils/jobStore.js";
import { info, error as logError } from "../../logger.js";

function trim(value) {
  return String(value || "").trim();
}

function slug(value) {
  return trim(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "audit";
}

export function asyncAuditJobType(auditType) {
  return `audit:${slug(auditType)}:route-run`;
}

export function asyncAuditSessionId(auditType, payload = {}) {
  return trim(payload.sessionId) || `${slug(auditType)}-${crypto.randomUUID()}`;
}

function statusUrlFor(req, auditType, sessionId) {
  const path = `/audits/${slug(auditType)}/jobs/${encodeURIComponent(sessionId)}`;
  if (!req?.protocol || !req?.get) return path;
  return `${req.protocol}://${req.get("host")}${path}`;
}

function publicShape(auditType, job, req = null) {
  if (!job) return null;
  const sessionId = job.sessionId;
  return {
    ok: true,
    auditType,
    sessionId,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    attempt: job.attempt,
    statusUrl: job.statusUrl || statusUrlFor(req, auditType, sessionId),
    result: job.result,
    error: job.error,
  };
}

async function executeAuditJob({ auditType, sessionId, payload, runner, metadata = {} }) {
  const jobType = asyncAuditJobType(auditType);
  try {
    const result = await runner(payload);
    const completed = completeJob(jobType, sessionId, {
      ...metadata,
      result,
      ok: result?.ok !== false,
    });
    await flushJobStoreWrites({ throwOnError: false });
    info("audit.async_route.completed", {
      auditType,
      sessionId,
      ok: result?.ok !== false,
      reportUrl: result?.reportUrl || null,
      reportJsonUrl: result?.reportJsonUrl || null,
    });
    return completed;
  } catch (err) {
    const failed = failJob(jobType, sessionId, err, metadata);
    await flushJobStoreWrites({ throwOnError: false });
    logError("audit.async_route.failed", {
      auditType,
      sessionId,
      message: err?.message || String(err),
    });
    return failed;
  }
}

export async function startAsyncAuditRouteJob({ auditType, payload = {}, runner, req = null, metadata = {} }) {
  if (typeof runner !== "function") throw new Error("Async audit route runner must be a function");

  const sessionId = asyncAuditSessionId(auditType, payload);
  const jobType = asyncAuditJobType(auditType);
  const payloadWithSession = { ...payload, sessionId };
  const statusUrl = statusUrlFor(req, auditType, sessionId);

  const { started, job } = beginJob(jobType, sessionId, {
    auditType,
    statusUrl,
    route: metadata.route || `${auditType}.run`,
    eventId: req?.idempotencyKey || null,
    ...metadata,
  });

  if (started) {
    setImmediate(() => {
      executeAuditJob({ auditType, sessionId, payload: payloadWithSession, runner, metadata: { statusUrl, ...metadata } })
        .catch((err) => {
          logError("audit.async_route.unhandled", {
            auditType,
            sessionId,
            message: err?.message || String(err),
          });
        });
    });
  }

  await flushJobStoreWrites({ throwOnError: false });
  return {
    ...publicShape(auditType, job, req),
    started,
    duplicateJob: !started,
    accepted: true,
    message: started
      ? "Audit report job accepted. Poll the status URL for completion."
      : "Audit report job is already queued or running for this session.",
  };
}

export function getAsyncAuditRouteJob(auditType, sessionId, req = null) {
  return publicShape(auditType, getPublicJob(asyncAuditJobType(auditType), sessionId), req);
}

export async function getAsyncAuditRouteJobFresh(auditType, sessionId, req = null) {
  return publicShape(auditType, await getPublicJobFresh(asyncAuditJobType(auditType), sessionId), req);
}

export default {
  startAsyncAuditRouteJob,
  getAsyncAuditRouteJob,
  getAsyncAuditRouteJobFresh,
  asyncAuditJobType,
};
