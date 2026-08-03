import { info } from "../../logger.js";
import {
  failJob,
  queueJob,
  startJob,
  completeJob,
  flushJobStoreWrites,
  getPublicJob,
  getPublicJobFresh,
  getMostRecentActiveJobFresh,
} from "../../services/shared/utils/jobStore.js";
import { sanitizeSessionId } from "../../services/shared/utils/sessionId.js";
import {
  dispatchGithubWorkflow,
  verifyGithubWorkflowRun,
} from "./githubDispatch.js";
import { buildAuditPrefix, inferWebsitePipelineSessionIdFromPrefix, makeAuditJobType } from "./auditPaths.js";
import { websiteAuditDefaultExclusions } from "./websiteAuditPolicy.js";
import { buildAuditCallbackDiagnostics } from "./auditCallbackDiagnostics.js";
import {
  assertAuditR2Config,
  assertAuditArtifactUrls,
  auditKeyFromPublicUrl,
  assertCompletedAuditArtifactUrls,
  cleanupAuditPrefix,
  getAuditBucketName,
  getAuditPublicBaseUrl,
  publishAuditJson,
  publishAuditLatest,
  publishAuditRequest,
  publishAuditText,
} from "./publishAuditArtifacts.js";

const DEFAULT_WEBSITE_URL = "https://jonathan-harris.online";
const ACTIVE_RUN_REUSE_MS = Number(process.env.AUDIT_RUN_REUSE_ACTIVE_MS || 20 * 60 * 1000);

function forceNewRunRequested(body = {}) {
  const value = body.forceNewRun ?? body.force ?? body.force_new_run;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function resolveExcludePatterns(auditType, body) {
  if (Array.isArray(body.excludePatterns)) {
    return body.excludePatterns;
  }
  return websiteAuditDefaultExclusions(auditType);
}

function buildWorkflowInputs({ sessionId, reportPrefix, websiteUrl, excludePatterns, callbackUrl, analysisUrl, callbackToken, auditR2 }) {
  // Keep this list aligned with the website repo workflow_dispatch contract.
  // Newer website workflow revisions accept the audit bucket hints below; older
  // revisions reject them with GitHub's "Unexpected inputs provided" response,
  // so dispatchGithubWorkflow strips those exact keys and retries once.
  return {
    session_id: sessionId,
    report_prefix: reportPrefix,
    base_url: websiteUrl,
    exclude_prefixes: excludePatterns.join(","),
    callback_url: callbackUrl,
    analysis_url: analysisUrl,
    callback_token: callbackToken,
    audit_bucket: auditR2.bucket,
    audit_public_base_url: auditR2.publicBaseUrl,
    audit_bucket_env: "R2_BUCKET_AUDITS",
    audit_public_base_env: "R2_PUBLIC_BASE_URL_AUDITS",
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
  const pipelineSessionId = String(body.pipelineSessionId || "").trim() || null;
  const suppressLatest = body.suppressLatest === true || body.temporaryArtifacts === true || Boolean(pipelineSessionId);
  const temporaryArtifacts = body.temporaryArtifacts === true || Boolean(pipelineSessionId);

  if (body.sessionId && !forceNewRunRequested(body)) {
    const existing = await getPublicJobFresh(jobType, sessionId);
    if (existing && ["queued", "running", "completed"].includes(existing.status)) {
      info("audit.workflow.reused_explicit_run", {
        auditType,
        sessionId,
        status: existing.status,
        reportPrefix: existing.reportPrefix || reportPrefix,
        pipelineSessionId: existing.pipelineSessionId || pipelineSessionId,
      });
      return {
        ok: existing.status !== "failed",
        auditType,
        sessionId,
        status: existing.status,
        reusedExplicitRun: true,
        reportPrefix: existing.reportPrefix || reportPrefix,
        callbackUrl: existing.callbackUrl || null,
        analysisUrl: existing.analysisUrl || null,
        workflowRunUrl: existing.workflowRunUrl || null,
        job: existing,
      };
    }
  }

  if (!body.sessionId && !forceNewRunRequested(body)) {
    const activeJob = await getMostRecentActiveJobFresh(jobType, { maxAgeMs: ACTIVE_RUN_REUSE_MS });
    if (activeJob) {
      info("audit.workflow.reused_active_run", {
        auditType,
        requestedSessionId: sessionId,
        reusedSessionId: activeJob.sessionId,
        status: activeJob.status,
        reportPrefix: activeJob.reportPrefix || null,
      });
      return {
        ok: true,
        auditType,
        sessionId: activeJob.sessionId,
        status: activeJob.status || "running",
        reusedActiveRun: true,
        message: "An audit run is already queued or running; returning the existing job instead of dispatching another workflow.",
        reportPrefix: activeJob.reportPrefix || null,
        callbackUrl: activeJob.callbackUrl || null,
        analysisUrl: activeJob.analysisUrl || null,
        workflowRunUrl: activeJob.workflowRunUrl || null,
        job: activeJob,
      };
    }
  }

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
  const websiteUrl = body.websiteUrl || DEFAULT_WEBSITE_URL;
  const excludePatterns = resolveExcludePatterns(auditType, body);

  const payload = {
    sessionId,
    websiteUrl,
    reportPrefix,
    excludePatterns,
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
    pipelineSessionId,
    suppressLatest,
    temporaryArtifacts,
  };

  queueJob(jobType, sessionId, {
    auditType,
    workflowId,
    reportPrefix,
    websiteUrl,
    excludePatterns,
    callbackUrl,
    analysisUrl,
    callbackTokenConfigured,
    auditBucket: auditR2.bucket,
    auditPublicBaseUrl: auditR2.publicBaseUrl,
    pipelineSessionId,
    suppressLatest,
    temporaryArtifacts,
  });

  const inputs = buildWorkflowInputs({
    sessionId,
    reportPrefix,
    websiteUrl,
    excludePatterns,
    callbackUrl,
    analysisUrl,
    callbackToken,
    auditR2,
  });

  try {
    startJob(jobType, sessionId, {
      dispatchStartedAt: new Date().toISOString(),
      callbackUrl,
      analysisUrl,
      callbackTokenConfigured,
      auditBucket: auditR2.bucket,
      auditPublicBaseUrl: auditR2.publicBaseUrl,
      pipelineSessionId,
      suppressLatest,
      temporaryArtifacts,
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

    await publishAuditRequest({ auditType, sessionId, payload, reportPrefix });

    if (!suppressLatest) {
      await publishAuditLatest({
        auditType,
        sessionId,
        payload: {
          status: "queued",
          reportPrefix,
          workflowId,
          websiteUrl,
          callbackUrl,
          analysisUrl,
          callbackTokenConfigured,
          auditBucket: auditR2.bucket,
          auditPublicBaseUrl: auditR2.publicBaseUrl,
          workflowRunUrl: workflowRun.workflowRunUrl || null,
        },
      });
    }

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
      strippedWorkflowInputs: dispatch.strippedInputs || [],
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
      auditBucket: auditR2.bucket,
      auditPublicBaseUrl: auditR2.publicBaseUrl,
      pipelineSessionId,
      suppressLatest,
      temporaryArtifacts,
    });
    throw err;
  }
}

function normaliseWorkflowStatus(value) {
  const status = String(value || "completed").trim().toLowerCase();
  return ["queued", "running", "completed", "failed"].includes(status) ? status : "completed";
}

function serialiseCompletionError(err) {
  return {
    name: err?.name || "AuditCompletionError",
    message: err?.message || String(err),
    code: err?.code,
  };
}

function safeJsonForHtml(value) {
  return JSON.stringify(value ?? {}, null, 2)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function auditFailureReportHtml({ auditType, sessionId, message, payload }) {
  const title = `${auditType} audit controlled failure`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>body{font-family:Arial,sans-serif;max-width:980px;margin:40px auto;padding:0 20px;line-height:1.55;color:#111827}code,pre{background:#f3f4f6;border-radius:8px;padding:2px 6px}pre{padding:16px;overflow:auto}.badge{display:inline-block;background:#fee2e2;color:#991b1b;border-radius:999px;padding:6px 12px;font-weight:700}</style>
</head>
<body>
  <h1>${title}</h1>
  <p><span class="badge">FAILED</span></p>
  <p><strong>Session:</strong> <code>${sessionId}</code></p>
  <p>${message}</p>
  <p>This controlled failure report was written by the AI Management Suite because the external website workflow did not provide a complete published artefact set. It is a controlled failure record, not a successful scored audit report.</p>
  <h2>Callback payload</h2>
  <pre>${safeJsonForHtml(payload)}</pre>
</body>
</html>`;
}

async function publishControlledFailureArtifacts({ auditType, sessionId, payload, message }) {
  const reportPrefix = String(payload.reportPrefix || buildAuditPrefix(auditType, sessionId)).replace(/\/+$/, "");
  const now = payload.finishedAt || new Date().toISOString();
  const block = {
    stage: "external audit workflow",
    blocker: message,
    reason: payload.storageUploadError || payload.error || payload.message || "Audit workflow did not publish a complete artefact set.",
  };
  const coverage = {
    ok: false,
    auditType,
    sessionId,
    status: "failed",
    reportPrefix,
    complete: false,
    stage3Blocks: Array.isArray(payload.stage3Blocks) ? payload.stage3Blocks : Array.isArray(payload.blockedTests) ? payload.blockedTests : [block],
    skippedRequiredTasksCount: Array.isArray(payload.blockedTests) ? payload.blockedTests.length : 1,
    generatedAt: now,
  };
  const summary = {
    ok: false,
    auditType,
    sessionId,
    status: "failed",
    reportPrefix,
    message,
    blocked: payload.blocked ?? true,
    hardGateBlocked: payload.hardGateBlocked ?? false,
    storageUploadError: payload.storageUploadError || null,
    mobileQualityScore: null,
    releaseVerdict: null,
    coverage,
    callbackPayload: payload,
    finishedAt: now,
  };
  const evidence = {
    auditType,
    sessionId,
    status: "failed",
    message,
    callbackPayload: payload,
    coverage,
    generatedAt: now,
  };
  const reportJson = {
    auditType,
    sessionId,
    schemaVersion: "controlled-audit-failure-v1",
    status: "failed",
    message,
    mobileQualityScore: null,
    releaseVerdict: null,
    summary,
    coverage,
    evidence,
    generatedAt: now,
  };
  const preflight = {
    auditType,
    sessionId,
    status: "failed",
    message,
    source: "AI Management Suite controlled failure fallback",
    reason: block.reason,
    generatedAt: now,
  };

  const [summaryOut, coverageOut, evidenceOut, reportJsonOut, preflightOut, reportOut, haltOut] = await Promise.all([
    publishAuditJson({ key: `${reportPrefix}/summary.json`, payload: summary }),
    publishAuditJson({ key: `${reportPrefix}/coverage.json`, payload: coverage }),
    publishAuditJson({ key: `${reportPrefix}/evidence.json`, payload: evidence }),
    publishAuditJson({ key: `${reportPrefix}/report.json`, payload: reportJson }),
    publishAuditJson({ key: `${reportPrefix}/preflight.json`, payload: preflight }),
    publishAuditText({ key: `${reportPrefix}/report.html`, text: auditFailureReportHtml({ auditType, sessionId, message, payload }), contentType: "text/html; charset=utf-8" }),
    publishAuditText({ key: `${reportPrefix}/halt.txt`, text: message }),
  ]);

  return {
    reportPrefix,
    reportUrl: reportOut.url,
    reportJsonUrl: reportJsonOut.url,
    summaryUrl: summaryOut.url,
    coverageUrl: coverageOut.url,
    evidenceUrl: evidenceOut.url,
    preflightUrl: preflightOut.url,
    haltUrl: haltOut.url,
    artefacts: {
      "summary.json": summaryOut.url,
      "coverage.json": coverageOut.url,
      "evidence.json": evidenceOut.url,
      "report.json": reportJsonOut.url,
      "preflight.json": preflightOut.url,
      "report.html": reportOut.url,
      "halt.txt": haltOut.url,
    },
  };
}

const MOBILE_UX_REQUIRED_COMPLETION_URLS = [
  ["reportUrl", "report.html"],
  ["reportJsonUrl", "report.json"],
  ["summaryUrl", "summary.json"],
  ["coverageUrl", "coverage.json"],
  ["executionUrl", "execution.json"],
  ["preflightUrl", "preflight.json"],
  ["evidenceUrl", "evidence.json"],
  ["screenshotManifestUrl", "screenshot-manifest.json"],
  ["focusedPageAppendixUrl", "focused-page-appendix.json"],
  ["repositoryIssueAppendixUrl", "repository-issue-appendix.json"],
  ["mandatoryMobileScorecardUrl", "mandatory-mobile-scorecard.json"],
  ["responsiveFixAppendixUrl", "responsive-fix-appendix.json"],
];

function isUsableCallbackUrl(value) {
  if (value === undefined || value === null) return false;
  const text = String(value).trim();
  return Boolean(text) && !["undefined", "null", "false"].includes(text.toLowerCase());
}

function callbackUrlForArtefact(payload = {}, directKey, artefactName) {
  if (isUsableCallbackUrl(payload[directKey])) return String(payload[directKey]).trim();
  if (payload.artefacts && typeof payload.artefacts === "object" && isUsableCallbackUrl(payload.artefacts[artefactName])) {
    return String(payload.artefacts[artefactName]).trim();
  }
  return null;
}

function normaliseReportPrefix(value) {
  return String(value || "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

function assertCallbackMatchesAuditJob({ auditType, payload, existingJob }) {
  const callbackPrefix = normaliseReportPrefix(payload.reportPrefix);
  const expectedPrefix = normaliseReportPrefix(existingJob?.reportPrefix);

  if (expectedPrefix && callbackPrefix !== expectedPrefix) {
    throw new Error(
      `Audit callback reportPrefix mismatch for ${auditType}: expected ${expectedPrefix}, received ${callbackPrefix || "<empty>"}`
    );
  }

  const scopedPrefix = expectedPrefix || callbackPrefix;
  if (!scopedPrefix) return true;

  const { urls } = assertAuditArtifactUrls(payload, { requireAny: false });
  const outsidePrefix = urls.filter((url) => {
    const key = auditKeyFromPublicUrl(url);
    return !key || !(key === scopedPrefix || key.startsWith(`${scopedPrefix}/`));
  });

  if (outsidePrefix.length) {
    throw new Error(
      `Audit callback artefact URL(s) are outside expected reportPrefix ${scopedPrefix}: ${outsidePrefix.join(", ")}`
    );
  }

  return true;
}

const STAGE_REQUIRED_COMPLETION_URLS = Object.freeze({
  "digital-growth": [
    ["reportJsonUrl", "report.json"],
    ["summaryUrl", "summary.json"],
    ["evidenceUrl", "evidence.json"],
    ["reportUrl", "report.html"],
  ],
  "seo-aeo-geo": [
    ["reportJsonUrl", "report.json"],
    ["summaryUrl", "summary.json"],
    ["coverageUrl", "coverage.json"],
    ["reportUrl", "report.html"],
  ],
});

function assertCompletedSourceStagePayload(auditType, payload = {}) {
  const required = STAGE_REQUIRED_COMPLETION_URLS[auditType] || [];
  const missing = required
    .filter(([directKey, artefactName]) => !callbackUrlForArtefact(payload, directKey, artefactName))
    .map(([, artefactName]) => artefactName);
  if (missing.length) {
    throw new Error(`Completed ${auditType} callback is missing required artefact URL(s): ${missing.join(", ")}`);
  }
  const completionState = String(payload.auditCompletionState || payload.analysisCompletionState || "").trim().toLowerCase();
  if (completionState !== "complete") {
    throw new Error(`Completed ${auditType} callback must declare auditCompletionState=Complete`);
  }
  return true;
}

function assertCompletedMobileUxPayload(payload = {}) {
  const completionState = String(payload.auditCompletionState || payload.analysisCompletionState || "").trim().toLowerCase();
  if (completionState !== "complete") {
    throw new Error("Completed Mobile UX callback must declare auditCompletionState=Complete");
  }

  const missing = MOBILE_UX_REQUIRED_COMPLETION_URLS
    .filter(([directKey, artefactName]) => !callbackUrlForArtefact(payload, directKey, artefactName))
    .map(([, artefactName]) => artefactName);

  if (missing.length) {
    throw new Error(`Completed Mobile UX callback is missing required artefact URL(s): ${missing.join(", ")}`);
  }

  if (payload.screenshotCount === undefined || payload.screenshotCount === null || Number(payload.screenshotCount) <= 0) {
    throw new Error("Completed Mobile UX callback must include screenshotCount greater than 0");
  }

  if (payload.mobileFailureCount === undefined || payload.mobileFailureCount === null) {
    throw new Error("Completed Mobile UX callback must include mobileFailureCount");
  }

  return true;
}

function optionalCompletionMetadata(payload = {}) {
  const metadata = {};
  for (const key of [
    "message",
    "error",
    "blocked",
    "hardGateBlocked",
    "auditCompletionState",
    "analysisCompletionState",
    "blockedTests",
    "stage3Blocks",
    "capabilities",
    "mobileQualityScore",
    "releaseVerdict",
    "confidenceModel",
    "executionCoverageConfidence",
    "findingConfidence",
    "scoringConfidence",
    "releaseConfidence",
    "sourceRevisionSha",
    "liveReleaseSha",
    "liveReleaseMarkerUrl",
    "liveSourceParity",
    "accessibilityEvidence",
    "visualDesignEvidence",
    "performanceEvidence",
    "searchConsoleEvidence",
    "securityEvidence",
    "rootCauseGroupCount",
    "storageUploadError",
    "publicJsonValidation",
  ]) {
    if (payload[key] !== undefined) metadata[key] = payload[key];
  }
  return metadata;
}

export async function completeAuditRun({ auditType, payload }) {
  if (payload.auditType && payload.auditType !== auditType) {
    throw new Error(`Audit callback type mismatch: expected ${auditType}, received ${payload.auditType}`);
  }
  assertAuditArtifactUrls(payload, { requireAny: false });

  const jobType = makeAuditJobType(auditType);
  const sessionId = sanitizeSessionId(
    payload.sessionId || "",
    `AUD-${auditType.toUpperCase()}`
  );
  const existingJob = await getPublicJobFresh(jobType, sessionId);
  assertCallbackMatchesAuditJob({ auditType, payload, existingJob });
  const inferredPipelineSessionId = inferWebsitePipelineSessionIdFromPrefix(payload.reportPrefix, auditType);
  const pipelineSessionId = existingJob?.pipelineSessionId || inferredPipelineSessionId || null;
  if (existingJob?.pipelineSessionId && inferredPipelineSessionId && existingJob.pipelineSessionId !== inferredPipelineSessionId) {
    throw new Error(
      `Audit callback pipeline session mismatch for ${auditType}: expected ${existingJob.pipelineSessionId}, received ${inferredPipelineSessionId}`
    );
  }
  const suppressLatest = existingJob?.suppressLatest === true || existingJob?.temporaryArtifacts === true || Boolean(pipelineSessionId);
  const temporaryArtifacts = existingJob?.temporaryArtifacts === true || Boolean(pipelineSessionId);
  const status = normaliseWorkflowStatus(payload.status);
  const jobMetadata = {
    reportPrefix: payload.reportPrefix,
    reportUrl: callbackUrlForArtefact(payload, "reportUrl", "report.html") || payload.reportHtmlUrl || null,
    reportJsonUrl: callbackUrlForArtefact(payload, "reportJsonUrl", "report.json") || null,
    summaryUrl: callbackUrlForArtefact(payload, "summaryUrl", "summary.json") || null,
    coverageUrl: callbackUrlForArtefact(payload, "coverageUrl", "coverage.json") || null,
    executionUrl: callbackUrlForArtefact(payload, "executionUrl", "execution.json") || null,
    preflightUrl: callbackUrlForArtefact(payload, "preflightUrl", "preflight.json") || null,
    reconciliationUrl: callbackUrlForArtefact(payload, "reconciliationUrl", "reconciliation.json") || null,
    evidenceUrl: callbackUrlForArtefact(payload, "evidenceUrl", "evidence.json") || null,
    screenshotManifestUrl: callbackUrlForArtefact(payload, "screenshotManifestUrl", "screenshot-manifest.json") || null,
    focusedPageAppendixUrl: callbackUrlForArtefact(payload, "focusedPageAppendixUrl", "focused-page-appendix.json") || null,
    repositoryIssueAppendixUrl: callbackUrlForArtefact(payload, "repositoryIssueAppendixUrl", "repository-issue-appendix.json") || null,
    mandatoryMobileScorecardUrl: callbackUrlForArtefact(payload, "mandatoryMobileScorecardUrl", "mandatory-mobile-scorecard.json") || null,
    responsiveFixAppendixUrl: callbackUrlForArtefact(payload, "responsiveFixAppendixUrl", "responsive-fix-appendix.json") || null,
    workflowRunUrl: payload.workflowRunUrl || existingJob?.workflowRunUrl || null,
    screenshotCount: payload.screenshotCount ?? null,
    mobileFailureCount: payload.mobileFailureCount ?? null,
    issueCount: payload.issueCount ?? null,
    artefacts: payload.artefacts || {},
    auditBucket: getAuditBucketName(),
    auditPublicBaseUrl: getAuditPublicBaseUrl(),
    pipelineSessionId,
    suppressLatest,
    temporaryArtifacts,
    updatedAt: payload.finishedAt || new Date().toISOString(),
    callbackDiagnostics: buildAuditCallbackDiagnostics(payload, existingJob),
    ...optionalCompletionMetadata(payload),
  };

  if (status === "queued") {
    queueJob(jobType, sessionId, jobMetadata);
  } else if (status === "running") {
    startJob(jobType, sessionId, jobMetadata);
  } else if (status === "failed") {
    const failureMessage = payload.message || payload.error || "Audit workflow failed";
    let fallbackArtifacts = {};
    const hasCallbackArtefacts = assertAuditArtifactUrls(payload, { requireAny: false }).urls.length > 0;
    if (!hasCallbackArtefacts && payload.reportPrefix) {
      try {
        fallbackArtifacts = await publishControlledFailureArtifacts({
          auditType,
          sessionId,
          payload,
          message: failureMessage,
        });
      } catch (err) {
        info("audit.workflow.controlled_failure_publish_failed", {
          auditType,
          sessionId,
          reportPrefix: payload.reportPrefix,
          error: err?.message || String(err),
        });
      }
    }

    Object.assign(jobMetadata, fallbackArtifacts, {
      artefacts: {
        ...(jobMetadata.artefacts || {}),
        ...(fallbackArtifacts.artefacts || {}),
      },
    });

    failJob(
      jobType,
      sessionId,
      failureMessage,
      { ...jobMetadata, finishedAt: payload.finishedAt || new Date().toISOString() }
    );
  } else {
    try {
      assertCompletedAuditArtifactUrls(payload);
      assertCompletedSourceStagePayload(auditType, payload);
      if (auditType === "mobile-ux") {
        assertCompletedMobileUxPayload(payload);
      }
      completeJob(jobType, sessionId, {
        ...jobMetadata,
        finishedAt: payload.finishedAt || new Date().toISOString(),
      });
      await cleanupAuditPrefix({
        reportPrefix: payload.reportPrefix,
        keepNames: [
          "request.json",
          "report.json",
          "report.html",
          "summary.json",
          "coverage.json",
          "evidence.json",
          "execution.json",
          "preflight.json",
          "reconciliation.json",
          "screenshot-manifest.json",
          "focused-page-appendix.json",
          "repository-issue-appendix.json",
          "mandatory-mobile-scorecard.json",
          "responsive-fix-appendix.json",
        ],
        keepPrefixes: ["screenshots", "appendices", "capability-probe"],
      });
    } catch (err) {
      const safeError = serialiseCompletionError(err);
      let fallbackArtifacts = {};
      if (payload.reportPrefix) {
        try {
          fallbackArtifacts = await publishControlledFailureArtifacts({
            auditType,
            sessionId,
            payload: { ...payload, status: "failed", error: safeError.message },
            message: safeError.message,
          });
        } catch (publishErr) {
          info("audit.workflow.controlled_failure_publish_failed", {
            auditType,
            sessionId,
            reportPrefix: payload.reportPrefix,
            error: publishErr?.message || String(publishErr),
          });
        }
      }
      Object.assign(jobMetadata, fallbackArtifacts, {
        artefacts: {
          ...(jobMetadata.artefacts || {}),
          ...(fallbackArtifacts.artefacts || {}),
        },
      });
      failJob(jobType, sessionId, safeError.message, {
        ...jobMetadata,
        finishedAt: payload.finishedAt || new Date().toISOString(),
        error: safeError,
      });
      if (!suppressLatest) {
        await publishAuditLatest({
          auditType,
          sessionId,
          payload: {
            status: "failed",
            ...jobMetadata,
            error: safeError,
          },
        });
      }
      await flushJobStoreWrites({ throwOnError: false });
      return {
        ok: false,
        auditType,
        sessionId,
        status: "failed",
        error: safeError,
        job: getPublicJob(jobType, sessionId),
      };
    }
  }

  // The parent website pipeline resumes immediately after this function
  // returns.  Persist the complete callback contract first so a cold start,
  // another instance, or a retry cannot observe the older queued/running job.
  await flushJobStoreWrites({ throwOnError: false });

  info("audit.workflow.callback.completed", {
    auditType,
    sessionId,
    status,
    pipelineSessionId,
    workflowRunUrl: jobMetadata.workflowRunUrl,
    message: payload.message || null,
    error: payload.error || null,
    storageUploadError: payload.storageUploadError || null,
    artefactCount: jobMetadata.callbackDiagnostics?.artefactCount || 0,
    blockedTestCount: jobMetadata.callbackDiagnostics?.blockedTestCount || 0,
    stage3BlockCount: jobMetadata.callbackDiagnostics?.stage3BlockCount || 0,
    controlledFailureArtefacts: status === "failed" && Object.keys(jobMetadata.artefacts || {}).length > 0,
  });

  if (!suppressLatest) {
    await publishAuditLatest({
      auditType,
      sessionId,
      payload: {
        status,
        ...jobMetadata,
      },
    });
  }

  return {
    ok: status !== "failed",
    auditType,
    sessionId,
    status,
    job: getPublicJob(jobType, sessionId),
  };
}

export function getAuditJob(auditType, sessionId) {
  return getPublicJob(makeAuditJobType(auditType), sessionId);
}

export const __auditOrchestratorTestHooks = {
  buildAuditCallbackDiagnostics,
  assertCompletedMobileUxPayload,
};

export default {
  startAuditRun,
  completeAuditRun,
  getAuditJob,
};
