import { info } from "../../logger.js";
import { failJob, queueJob, startJob, completeJob, getPublicJob } from "../../services/shared/utils/jobStore.js";
import { sanitizeSessionId } from "../../services/shared/utils/sessionId.js";
import { dispatchGithubWorkflow } from "./githubDispatch.js";
import { buildAuditPrefix, makeAuditJobType } from "./auditPaths.js";
import { publishAuditLatest, publishAuditRequest } from "./publishAuditArtifacts.js";

const DEFAULT_WEBSITE_URL = "https://jonathan-harris.online";
const DEFAULT_EXCLUDE_PATTERNS = ["/podcast", "/blog"];

export async function startAuditRun({
  auditType,
  workflowId,
  body,
  callbackPath,
}) {
  const sessionId = sanitizeSessionId(body.sessionId || `${auditType}-${Date.now()}`, `AUD-${auditType.toUpperCase()}`);
  const reportPrefix = body.reportPrefix || buildAuditPrefix(auditType, sessionId);
  const jobType = makeAuditJobType(auditType);
  const callbackBaseUrl = String(process.env.APP_URL || process.env.AUDIT_CALLBACK_BASE_URL || "").trim().replace(/\/$/, "");
  const callbackUrl = callbackBaseUrl ? `${callbackBaseUrl}${callbackPath}` : "";

  const payload = {
    sessionId,
    websiteUrl: body.websiteUrl || DEFAULT_WEBSITE_URL,
    reportPrefix,
    excludePatterns: Array.isArray(body.excludePatterns) && body.excludePatterns.length
      ? body.excludePatterns
      : DEFAULT_EXCLUDE_PATTERNS,
    requestedBy: body.requestedBy || "manual",
    notes: body.notes || "",
    workflowRef: body.workflowRef,
    callbackUrl,
  };

  queueJob(jobType, sessionId, {
    auditType,
    workflowId,
    reportPrefix,
    websiteUrl: payload.websiteUrl,
    excludePatterns: payload.excludePatterns,
  });

  await publishAuditRequest({ auditType, sessionId, payload, reportPrefix });

  const inputs = {
    session_id: sessionId,
    report_prefix: reportPrefix,
    base_url: payload.websiteUrl,
    exclude_prefixes: payload.excludePatterns.join(","),
    callback_url: callbackUrl,
  };

  try {
    startJob(jobType, sessionId, {
      dispatchStartedAt: new Date().toISOString(),
    });

    const dispatch = await dispatchGithubWorkflow({
      workflowId,
      inputs,
      ref: payload.workflowRef,
    });

    await publishAuditLatest({
      auditType,
      sessionId,
      payload: {
        status: "queued",
        reportPrefix,
        workflowId,
        websiteUrl: payload.websiteUrl,
      },
    });

    info("audit.workflow.dispatched", {
      auditType,
      sessionId,
      workflowId,
      reportPrefix,
    });

    return {
      ok: true,
      auditType,
      sessionId,
      status: "queued",
      reportPrefix,
      dispatch,
      job: getPublicJob(jobType, sessionId),
    };
  } catch (err) {
    failJob(jobType, sessionId, err, {
      reportPrefix,
      workflowId,
    });
    throw err;
  }
}

export async function completeAuditRun({ auditType, payload }) {
  const jobType = makeAuditJobType(auditType);
  const sessionId = sanitizeSessionId(payload.sessionId || "", `AUD-${auditType.toUpperCase()}`);
  const status = String(payload.status || "completed").trim().toLowerCase();
  const jobMetadata = {
    reportPrefix: payload.reportPrefix,
    reportUrl: payload.reportUrl || null,
    summaryUrl: payload.summaryUrl || null,
    executionUrl: payload.executionUrl || payload.evidenceUrl || null,
    preflightUrl: payload.preflightUrl || payload.reconciliationUrl || null,
    workflowRunUrl: payload.workflowRunUrl || null,
    screenshotCount: payload.screenshotCount ?? null,
    mobileFailureCount: payload.mobileFailureCount ?? null,
    issueCount: payload.issueCount ?? null,
    artefacts: payload.artefacts || {},
    finishedAt: payload.finishedAt || new Date().toISOString(),
  };

  if (status === "failed") {
    failJob(jobType, sessionId, payload.message || payload.error || "Audit workflow failed", jobMetadata);
  } else {
    completeJob(jobType, sessionId, jobMetadata);
  }

  await publishAuditLatest({
    auditType,
    sessionId,
    payload: {
      status,
      ...jobMetadata,
    },
  });

  return {
    ok: true,
    auditType,
    sessionId,
    status,
    job: getPublicJob(jobType, sessionId),
  };
}

export function getAuditJob(auditType, sessionId) {
  return getPublicJob(makeAuditJobType(auditType), sessionId);
}

export default {
  startAuditRun,
  completeAuditRun,
  getAuditJob,
};
