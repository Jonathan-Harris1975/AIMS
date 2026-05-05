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
  assertCompletedAuditArtifactUrls,
  assertAuditR2Config,
  cleanupAuditPrefix,
  getAuditPublicBaseUrl,
  getAuditBucketName,
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
  const callbackBaseUrl = String(
    process.env.AUDIT_CALLBACK_BASE_URL || process.env.APP_URL || ""
  )
    .trim()
    .replace(/\/+$/, "");
  const callbackToken = String(process.env.AUDIT_CALLBACK_TOKEN || process.env.AI_SUITE_AUDIT_CALLBACK_TOKEN || "").trim();
  const callbackTokenConfigured = Boolean(callbackToken);

  if (!callbackBaseUrl) {
    throw new Error("AUDIT_CALLBACK_BASE_URL or APP_URL is required to dispatch audit workflows with a callback_url");
  }

  if (!callbackTokenConfigured) {
    throw new Error("AUDIT_CALLBACK_TOKEN or AI_SUITE_AUDIT_CALLBACK_TOKEN is required so the website audit workflow can call back securely");
  }

  const callbackUrl = `${callbackBaseUrl}${callbackPath}`;
  const analysisUrl = callbackUrl.replace(/\/callback\/?$/, "/analysis");
  const auditR2 = assertAuditR2Config();

  const payload = {
    sessionId,
    websiteUrl: body.websiteUrl || DEFAULT_WEBSITE_URL,
    reportPrefix,
    excludePatterns: resolveExcludePatterns(auditType, body),
    requestedBy: body.requestedBy || "manual",
    notes: body.notes || "",
    workflowRef: body.workflowRef,
    callbackUrl,
    analysisUrl,
    callbackTokenConfigured,
    auditBucket: auditR2.bucket,
    auditPublicBaseUrl: auditR2.publicBaseUrl,
    auditBucketEnv: "R2_BUCKET_AUDITS",
    auditPublicBaseEnv: "R2_PUBLIC_BASE_URL_AUDITS",
  };

  queueJob(jobType, sessionId, {
    auditType,
    workflowId,
    reportPrefix,
    websiteUrl: payload.websiteUrl,
    excludePatterns: payload.excludePatterns,
    callbackUrl,
    analysisUrl,
    callbackTokenConfigured,
    auditBucket: auditR2.bucket,
    auditPublicBaseUrl: auditR2.publicBaseUrl,
  });

  await publishAuditRequest({ auditType, sessionId, payload, reportPrefix });

  const inputs = {
    session_id: sessionId,
    report_prefix: reportPrefix,
    base_url: payload.websiteUrl,
    exclude_prefixes: payload.excludePatterns.join(","),
    callback_url: callbackUrl,
    analysis_url: analysisUrl,
    callback_token: callbackToken,
    audit_bucket: auditR2.bucket,
    audit_public_base_url: auditR2.publicBaseUrl,
    audit_bucket_env: "R2_BUCKET_AUDITS",
    audit_public_base_env: "R2_PUBLIC_BASE_URL_AUDITS",
  };

  try {
    startJob(jobType, sessionId, {
      dispatchStartedAt: new Date().toISOString(),
      callbackUrl,
      analysisUrl,
      callbackTokenConfigured,
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
        analysisUrl,
        callbackTokenConfigured,
        auditBucket: auditR2.bucket,
        auditPublicBaseUrl: auditR2.publicBaseUrl,
        workflowRunUrl: workflowRun.workflowRunUrl || null,
      },
    });

    info("audit.workflow.dispatched", {
      auditType,
      sessionId,
      workflowId,
      reportPrefix,
      callbackUrl,
      analysisUrl,
      callbackTokenConfigured,
      auditBucket: auditR2.bucket,
      auditPublicBaseUrl: auditR2.publicBaseUrl,
      workflowRunUrl: workflowRun.workflowRunUrl || null,
    });

    return {
      ok: true,
      auditType,
      sessionId,
      status: "queued",
      reportPrefix,
      callbackUrl,
      analysisUrl,
      callbackTokenConfigured,
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
      analysisUrl,
      callbackTokenConfigured,
    });
    throw err;
  }
}

export async function completeAuditRun({ auditType, payload }) {
  if (String(payload.status || "completed").trim().toLowerCase() !== "failed") {
    assertCompletedAuditArtifactUrls(payload);
  }

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
    auditBucket: getAuditBucketName(),
    auditPublicBaseUrl: getAuditPublicBaseUrl(),
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
      keepNames: ["request.json", "report.json", "report.html", "summary.json", "coverage.json", "evidence.json", "execution.json", "preflight.json", "reconciliation.json"],
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
