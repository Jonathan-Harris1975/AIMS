import { info } from "../../logger.js";
import {
  failJob,
  queueJob,
  startJob,
  completeJob,
  getPublicJob,
} from "../../services/shared/utils/jobStore.js";
import { sanitizeSessionId } from "../../services/shared/utils/sessionId.js";
import {
  dispatchGithubWorkflow,
  verifyGithubWorkflowRun,
} from "./githubDispatch.js";
import { buildAuditPrefix, makeAuditJobType } from "./auditPaths.js";
import {
  cleanupAuditPrefix,
  publishAuditLatest,
  publishAuditRequest,
} from "./publishAuditArtifacts.js";

const DEFAULT_WEBSITE_URL = "https://jonathan-harris.online";
const DEFAULT_EXCLUDE_PATTERNS = {
  "mobile-ux": ["/podcast", "/blog"],
  "seo-aeo-geo": [],
};

function resolveExcludePatterns(auditType, body) {
  if (Array.isArray(body.excludePatterns)) {
    return body.excludePatterns;
  }
  return DEFAULT_EXCLUDE_PATTERNS[auditType] || [];
}

function resolveAuditCallbackBaseUrl() {
  return String(process.env.AUDIT_CALLBACK_BASE_URL || process.env.APP_URL || "")
    .trim()
    .replace(/\/+$/, "");
}

function resolveAuditCallbackToken() {
  return String(process.env.AUDIT_CALLBACK_TOKEN || process.env.AI_SUITE_AUDIT_CALLBACK_TOKEN || "").trim();
}

function requireAuditCallbackConfig(callbackPath) {
  const callbackBaseUrl = resolveAuditCallbackBaseUrl();
  const callbackToken = resolveAuditCallbackToken();

  if (!callbackBaseUrl) {
    throw new Error("AUDIT_CALLBACK_BASE_URL or APP_URL is required to dispatch audit workflows with a callback_url");
  }

  if (!callbackToken) {
    throw new Error("AUDIT_CALLBACK_TOKEN or AI_SUITE_AUDIT_CALLBACK_TOKEN is required so the website audit workflow can call back securely");
  }

  return {
    callbackUrl: `${callbackBaseUrl}${callbackPath}`,
    callbackToken,
  };
}

export async function startAuditRun({
  auditType,
  workflowId,
  body,
  callbackPath,
}) {
  const sessionId = sanitizeSessionId(
    body.sessionId || `${auditType}-${Date.now()}`,
    `AUD-${auditType.toUpperCase()}`
  );
  const reportPrefix = body.reportPrefix || buildAuditPrefix(auditType, sessionId);
  const jobType = makeAuditJobType(auditType);
  const { callbackUrl, callbackToken } = requireAuditCallbackConfig(callbackPath);

  const payload = {
    sessionId,
    websiteUrl: body.websiteUrl || DEFAULT_WEBSITE_URL,
    reportPrefix,
    excludePatterns: resolveExcludePatterns(auditType, body),
    requestedBy: body.requestedBy || "manual",
    notes: body.notes || "",
    workflowRef: body.workflowRef,
    callbackUrl,
    callbackTokenConfigured: Boolean(callbackToken),
  };

  queueJob(jobType, sessionId, {
    auditType,
    workflowId,
    reportPrefix,
    websiteUrl: payload.websiteUrl,
    excludePatterns: payload.excludePatterns,
    callbackUrl,
    callbackTokenConfigured: true,
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
      callbackUrl,
      callbackTokenConfigured: true,
    });

    const dispatch = await dispatchGithubWorkflow({
      workflowId,
      inputs,
      ref: payload.workflowRef,
    });

    const workflowRun = await verifyGithubWorkflowRun({
      workflowId,
      ref: payload.workflowRef,
      sessionId,
      dispatchedAt: dispatch.dispatchedAt,
    });

    await publishAuditLatest({
      auditType,
      sessionId,
      payload: {
        status: "queued",
        reportPrefix,
        workflowId,
        websiteUrl: payload.websiteUrl,
        callbackUrl,
        callbackTokenConfigured: true,
        workflowRunUrl: workflowRun.workflowRunUrl || null,
      },
    });

    info("audit.workflow.dispatched", {
      auditType,
      sessionId,
      workflowId,
      reportPrefix,
      callbackUrl,
      callbackTokenConfigured: true,
      workflowRunUrl: workflowRun.workflowRunUrl || null,
    });

    return {
      ok: true,
      auditType,
      sessionId,
      status: "queued",
      reportPrefix,
      callbackUrl,
      callbackTokenConfigured: true,
      dispatch: {
        ...dispatch,
        workflowRunUrl: workflowRun.workflowRunUrl || null,
        workflowRunId: workflowRun.runId || null,
      },
      job: getPublicJob(jobType, sessionId),
    };
  } catch (err) {
    failJob(jobType, sessionId, err, {
      reportPrefix,
      workflowId,
      callbackUrl,
      callbackTokenConfigured: true,
    });
    throw err;
  }
}

export async function completeAuditRun({ auditType, payload }) {
  const jobType = makeAuditJobType(auditType);
  const sessionId = sanitizeSessionId(
    payload.sessionId || "",
    `AUD-${auditType.toUpperCase()}`
  );
  const status = String(payload.status || "completed").trim().toLowerCase();
  const jobMetadata = {
    reportPrefix: payload.reportPrefix,
    reportUrl: payload.reportUrl || null,
    summaryUrl: payload.summaryUrl || null,
    coverageUrl: payload.coverageUrl || null,
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
    failJob(
      jobType,
      sessionId,
      payload.message || payload.error || "Audit workflow failed",
      jobMetadata
    );
  } else {
    completeJob(jobType, sessionId, jobMetadata);
    await cleanupAuditPrefix({
      reportPrefix: payload.reportPrefix,
      keepNames: ["report.html", "summary.json", "coverage.json"],
    });
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
