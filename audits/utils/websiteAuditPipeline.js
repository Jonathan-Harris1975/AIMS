import { info, error as logError } from "../../logger.js";
import {
  completeJob,
  failJob,
  flushJobStoreWrites,
  getPublicJobFresh,
  queueJob,
  startJob,
  updateJob,
} from "../../services/shared/utils/jobStore.js";
import { sanitizeSessionId } from "../../services/shared/utils/sessionId.js";
import { makeAuditJobType } from "./auditPaths.js";
import { startAuditRun } from "./orchestrator.js";
import {
  auditKeyFromPublicUrl,
  cleanupAuditPrefix,
  publishAuditBuffer,
  readAuditJson,
} from "./publishAuditArtifacts.js";
import {
  buildWebsiteAuditHtml,
  renderWebsiteAuditPdf,
  runWebsiteAuditCouncil,
} from "./websiteAuditCouncil.js";

export const WEBSITE_PIPELINE_AUDIT_TYPE = "website";
export const WEBSITE_PIPELINE_JOB_TYPE = makeAuditJobType(WEBSITE_PIPELINE_AUDIT_TYPE);
const DEFAULT_WEBSITE_URL = "https://jonathan-harris.online";

export const WEBSITE_PIPELINE_STAGES = Object.freeze([
  {
    key: "digitalGrowth",
    auditType: "digital-growth",
    workflowId: "digital-growth-audit.yml",
    callbackPath: "/audits/digital-growth/callback",
    prefixLeaf: "digital-growth",
  },
  {
    key: "seoAeoGeo",
    auditType: "seo-aeo-geo",
    workflowId: "seo-aeo-geo-forensic.yml",
    callbackPath: "/audits/seo-aeo-geo/callback",
    prefixLeaf: "seo-aeo-geo",
  },
  {
    key: "mobileUx",
    auditType: "mobile-ux",
    workflowId: "mobile-ux-hard-gate.yml",
    callbackPath: "/audits/mobile-ux/callback",
    prefixLeaf: "mobile-ux",
  },
]);

function safeSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "website-audit";
}

export function websitePipelineTempPrefix(sessionId) {
  return `audits/_tmp/website/${safeSegment(sessionId)}`;
}

export function websitePipelineFinalKey(sessionId, date = new Date()) {
  const month = date.toISOString().slice(0, 7);
  return `audits/website/${month}/${safeSegment(sessionId)}/website-audit.pdf`;
}

export function websitePipelineChildSessionId(parentSessionId, auditType) {
  const parent = safeSegment(parentSessionId).slice(0, 80);
  const leaf = safeSegment(auditType).slice(0, 30);
  return sanitizeSessionId(`${parent}-${leaf}`, `AUD-${leaf.toUpperCase()}`);
}

function stageDefinition(auditType) {
  return WEBSITE_PIPELINE_STAGES.find((stage) => stage.auditType === auditType) || null;
}

function stageIndex(auditType) {
  return WEBSITE_PIPELINE_STAGES.findIndex((stage) => stage.auditType === auditType);
}

function parentStageMetadata(parentSessionId, stage, websiteUrl) {
  return {
    sessionId: websitePipelineChildSessionId(parentSessionId, stage.auditType),
    auditType: stage.auditType,
    status: "queued",
    reportPrefix: `${websitePipelineTempPrefix(parentSessionId)}/${stage.prefixLeaf}`,
    websiteUrl,
  };
}

async function persistParent(sessionId, metadata) {
  const job = updateJob(WEBSITE_PIPELINE_JOB_TYPE, sessionId, metadata);
  await flushJobStoreWrites({ throwOnError: false });
  return job;
}

async function dispatchStage(parentSessionId, stage, parentJob) {
  const websiteUrl = parentJob.websiteUrl || DEFAULT_WEBSITE_URL;
  const child = parentStageMetadata(parentSessionId, stage, websiteUrl);
  const stages = { ...(parentJob.stages || {}), [stage.key]: child };
  await persistParent(parentSessionId, {
    status: "running",
    phase: stage.auditType,
    currentStage: stage.auditType,
    stages,
    updatedAt: new Date().toISOString(),
  });

  try {
    const result = await startAuditRun({
      auditType: stage.auditType,
      workflowId: stage.workflowId,
      callbackPath: stage.callbackPath,
      body: {
        sessionId: child.sessionId,
        websiteUrl,
        reportPrefix: child.reportPrefix,
        requestedBy: "AIMS website audit pipeline",
        notes: `Temporary child stage of website audit pipeline ${parentSessionId}. AIMS owns sequencing and final retention.`,
        pipelineSessionId: parentSessionId,
        temporaryArtifacts: true,
        suppressLatest: true,
        runCouncil: false,
        runSeoAeoGeoCouncil: false,
        runMobileUxCouncil: false,
      },
    });
    await persistParent(parentSessionId, {
      stages: {
        ...stages,
        [stage.key]: {
          ...child,
          status: result.status || "queued",
          workflowRunUrl: result.workflowRunUrl || result.dispatch?.workflowRunUrl || null,
          callbackUrl: result.callbackUrl || null,
        },
      },
    });
    return result;
  } catch (err) {
    const failedStage = {
      ...child,
      status: "failed",
      error: err?.message || String(err),
      finishedAt: new Date().toISOString(),
    };
    await persistParent(parentSessionId, { stages: { ...stages, [stage.key]: failedStage } });
    logError("audit.website.pipeline.stage_dispatch_failed", {
      pipelineSessionId: parentSessionId,
      auditType: stage.auditType,
      message: failedStage.error,
    });
    return { ok: false, status: "failed", error: failedStage.error, job: failedStage };
  }
}

async function continueAfterDispatchFailure(parentSessionId, failedAuditType) {
  const index = stageIndex(failedAuditType);
  const next = WEBSITE_PIPELINE_STAGES[index + 1];
  const parent = await getPublicJobFresh(WEBSITE_PIPELINE_JOB_TYPE, parentSessionId);
  if (!parent) return null;
  if (next) {
    const result = await dispatchStage(parentSessionId, next, parent);
    if (!result?.ok && result?.status === "failed") {
      return continueAfterDispatchFailure(parentSessionId, next.auditType);
    }
    return result;
  }
  return scheduleFinalisation(parentSessionId);
}

export async function startWebsiteAuditPipeline(body = {}) {
  const sessionId = sanitizeSessionId(
    body.sessionId || `website-${Date.now()}`,
    "AUD-WEBSITE"
  );
  const existing = await getPublicJobFresh(WEBSITE_PIPELINE_JOB_TYPE, sessionId);
  if (existing && ["queued", "running", "completed"].includes(existing.status) && body.forceNewRun !== true) {
    return { ok: existing.status !== "failed", auditType: WEBSITE_PIPELINE_AUDIT_TYPE, sessionId, status: existing.status, reused: true, job: existing };
  }

  const websiteUrl = String(body.websiteUrl || DEFAULT_WEBSITE_URL).trim().replace(/\/+$/, "");
  const tempPrefix = websitePipelineTempPrefix(sessionId);
  const finalReportKey = websitePipelineFinalKey(sessionId);
  queueJob(WEBSITE_PIPELINE_JOB_TYPE, sessionId, {
    auditType: WEBSITE_PIPELINE_AUDIT_TYPE,
    websiteUrl,
    requestedBy: body.requestedBy || "MAST",
    notes: body.notes || "",
    phase: "queued",
    currentStage: null,
    tempPrefix,
    finalReportKey,
    retentionPolicy: "final-pdf-only",
    stages: {},
  });
  startJob(WEBSITE_PIPELINE_JOB_TYPE, sessionId, {
    auditType: WEBSITE_PIPELINE_AUDIT_TYPE,
    websiteUrl,
    requestedBy: body.requestedBy || "MAST",
    notes: body.notes || "",
    phase: "digital-growth",
    currentStage: "digital-growth",
    tempPrefix,
    finalReportKey,
    retentionPolicy: "final-pdf-only",
    stages: {},
  });
  await flushJobStoreWrites({ throwOnError: false });

  const first = WEBSITE_PIPELINE_STAGES[0];
  const result = await dispatchStage(sessionId, first, await getPublicJobFresh(WEBSITE_PIPELINE_JOB_TYPE, sessionId));
  if (!result?.ok && result?.status === "failed") {
    await continueAfterDispatchFailure(sessionId, first.auditType);
  }

  const job = await getPublicJobFresh(WEBSITE_PIPELINE_JOB_TYPE, sessionId);
  info("audit.website.pipeline.started", { sessionId, websiteUrl, finalReportKey });
  return {
    ok: true,
    auditType: WEBSITE_PIPELINE_AUDIT_TYPE,
    sessionId,
    status: job?.status || "running",
    currentStage: job?.currentStage || first.auditType,
    finalReportKey,
    job,
  };
}

async function safeReadJsonUrl(url) {
  const key = auditKeyFromPublicUrl(url);
  if (!key) return null;
  try { return await readAuditJson({ key }); } catch { return null; }
}

async function loadChildStage(parentSessionId, stage, parentJob) {
  const childId = parentJob?.stages?.[stage.key]?.sessionId || websitePipelineChildSessionId(parentSessionId, stage.auditType);
  const childJob = await getPublicJobFresh(makeAuditJobType(stage.auditType), childId);
  if (!childJob) {
    return { auditType: stage.auditType, sessionId: childId, status: "not-found", limitation: "Child job state was not found." };
  }
  const [reportJson, summary, coverage, evidence, execution, preflight] = await Promise.all([
    safeReadJsonUrl(childJob.reportJsonUrl),
    safeReadJsonUrl(childJob.summaryUrl),
    safeReadJsonUrl(childJob.coverageUrl),
    safeReadJsonUrl(childJob.evidenceUrl),
    safeReadJsonUrl(childJob.executionUrl),
    safeReadJsonUrl(childJob.preflightUrl),
  ]);
  const report = reportJson && typeof reportJson === "object" ? reportJson : {};
  return {
    ...report,
    auditType: stage.auditType,
    sessionId: childId,
    status: childJob.status || report.status || "unknown",
    summary: report.summary || summary || {},
    coverage: report.coverage || coverage || {},
    evidence: report.evidence || evidence || {},
    execution: report.execution || execution || {},
    preflight: report.preflight || preflight || {},
    reportUrl: childJob.reportUrl || null,
    reportJsonUrl: childJob.reportJsonUrl || null,
    workflowRunUrl: childJob.workflowRunUrl || null,
    hardGateBlocked: childJob.hardGateBlocked ?? report.hardGateBlocked ?? summary?.hardGateBlocked ?? false,
    mobileQualityScore: childJob.mobileQualityScore ?? report.mobileQualityScore ?? summary?.mobileQualityScore ?? null,
    releaseVerdict: childJob.releaseVerdict ?? report.releaseVerdict ?? summary?.releaseVerdict ?? null,
    screenshotCount: childJob.screenshotCount ?? report.screenshotCount ?? summary?.screenshotCount ?? null,
    mobileFailureCount: childJob.mobileFailureCount ?? report.mobileFailureCount ?? summary?.mobileFailureCount ?? null,
    jobError: childJob.error || null,
  };
}

async function strictTemporaryCleanup(tempPrefix, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await cleanupAuditPrefix({ reportPrefix: tempPrefix });
      return { ...result, attempts: attempt };
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError || new Error(`Temporary audit cleanup failed for ${tempPrefix}`);
}

export async function finaliseWebsiteAuditPipeline(parentSessionId) {
  const parent = await getPublicJobFresh(WEBSITE_PIPELINE_JOB_TYPE, parentSessionId);
  if (!parent) throw new Error(`Website audit pipeline job not found: ${parentSessionId}`);
  if (parent.status === "completed" && parent.finalReportUrl) return parent;

  await persistParent(parentSessionId, {
    status: "running",
    phase: "council-and-final-report",
    currentStage: "council-and-final-report",
    finalising: true,
    finalisingAt: parent.finalisingAt || new Date().toISOString(),
  });

  let finalReportUrl = parent.finalReportUrl || null;
  let finalReportKey = parent.finalReportKey || websitePipelineFinalKey(parentSessionId);
  try {
    const current = await getPublicJobFresh(WEBSITE_PIPELINE_JOB_TYPE, parentSessionId);
    const [digitalGrowth, seoAeoGeo, mobileUx] = await Promise.all(
      WEBSITE_PIPELINE_STAGES.map((stage) => loadChildStage(parentSessionId, stage, current))
    );
    const stageReports = { digitalGrowth, seoAeoGeo, mobileUx };
    const council = await runWebsiteAuditCouncil(stageReports);
    const html = buildWebsiteAuditHtml({
      websiteUrl: current.websiteUrl || DEFAULT_WEBSITE_URL,
      sessionId: parentSessionId,
      council,
      stageReports,
    });
    const pdfBuffer = await renderWebsiteAuditPdf(html);
    const published = await publishAuditBuffer({ key: finalReportKey, body: pdfBuffer, contentType: "application/pdf" });
    finalReportUrl = published.url;

    // Only after the final PDF is safely in R2 do we remove the entire temporary evidence tree.
    const cleanup = await strictTemporaryCleanup(current.tempPrefix || websitePipelineTempPrefix(parentSessionId));
    const completed = completeJob(WEBSITE_PIPELINE_JOB_TYPE, parentSessionId, {
      auditType: WEBSITE_PIPELINE_AUDIT_TYPE,
      phase: "completed",
      currentStage: null,
      finalising: false,
      finalReportKey,
      finalReportUrl,
      retainedArtefacts: [finalReportUrl],
      temporaryCleanup: { ok: true, deletedCount: cleanup.deleted.length, attempts: cleanup.attempts, remainingCount: cleanup.remaining?.length || 0 },
      synthesisState: council.synthesisState,
      stageStatuses: {
        digitalGrowth: digitalGrowth.status,
        seoAeoGeo: seoAeoGeo.status,
        mobileUx: mobileUx.status,
      },
    });
    await flushJobStoreWrites({ throwOnError: false });
    info("audit.website.pipeline.completed", {
      pipelineSessionId: parentSessionId,
      finalReportUrl,
      deletedTemporaryObjects: cleanup.deleted.length,
      synthesisState: council.synthesisState,
    });
    return completed;
  } catch (err) {
    const failed = failJob(WEBSITE_PIPELINE_JOB_TYPE, parentSessionId, err, {
      auditType: WEBSITE_PIPELINE_AUDIT_TYPE,
      phase: finalReportUrl ? "temporary-cleanup-failed" : "final-report-failed",
      currentStage: null,
      finalising: false,
      finalReportKey,
      finalReportUrl,
      retainedArtefacts: finalReportUrl ? [finalReportUrl] : [],
      cleanupRequired: Boolean(finalReportUrl),
    });
    await flushJobStoreWrites({ throwOnError: false });
    logError("audit.website.pipeline.failed", {
      pipelineSessionId: parentSessionId,
      finalReportUrl,
      message: err?.message || String(err),
    });
    return failed;
  }
}

function scheduleFinalisation(parentSessionId) {
  return persistParent(parentSessionId, {
    status: "running",
    phase: "council-queued",
    currentStage: "council-queued",
    finalising: true,
    finalisingAt: new Date().toISOString(),
  }).then((job) => {
    setImmediate(() => {
      finaliseWebsiteAuditPipeline(parentSessionId).catch((err) => {
        logError("audit.website.pipeline.finalise_unhandled", { pipelineSessionId: parentSessionId, message: err?.message || String(err) });
      });
    });
    return { ok: true, scheduled: true, job };
  });
}

export async function resumeWebsiteAuditPipelineFromChild({ auditType, result }) {
  const pipelineSessionId = result?.job?.pipelineSessionId;
  if (!pipelineSessionId) return null;
  const stage = stageDefinition(auditType);
  if (!stage) return null;
  const parent = await getPublicJobFresh(WEBSITE_PIPELINE_JOB_TYPE, pipelineSessionId);
  if (!parent) {
    logError("audit.website.pipeline.parent_missing", { pipelineSessionId, auditType, childSessionId: result?.sessionId });
    return null;
  }
  if (parent.status === "completed" || parent.phase === "council-and-final-report" || parent.phase === "council-queued" || parent.finalising) {
    return { ok: true, ignored: true, reason: "pipeline already finalising or completed", job: parent };
  }

  const callbackStageIndex = stageIndex(auditType);
  const currentStageIndex = stageIndex(parent.currentStage);
  if (currentStageIndex >= 0 && callbackStageIndex !== currentStageIndex) {
    return {
      ok: true,
      ignored: true,
      reason: callbackStageIndex < currentStageIndex ? "stale child callback" : "out-of-order child callback",
      pipelineSessionId,
      expectedStage: parent.currentStage,
      receivedStage: auditType,
      job: parent,
    };
  }

  const childStage = {
    ...(parent.stages?.[stage.key] || {}),
    sessionId: result.sessionId,
    auditType,
    status: result.status || result.job?.status || "unknown",
    reportUrl: result.job?.reportUrl || null,
    reportJsonUrl: result.job?.reportJsonUrl || null,
    summaryUrl: result.job?.summaryUrl || null,
    coverageUrl: result.job?.coverageUrl || null,
    finishedAt: result.job?.finishedAt || new Date().toISOString(),
    error: result.job?.error || result.error || null,
  };
  await persistParent(pipelineSessionId, { stages: { ...(parent.stages || {}), [stage.key]: childStage } });

  const index = stageIndex(auditType);
  const next = WEBSITE_PIPELINE_STAGES[index + 1];
  if (next) {
    const freshParent = await getPublicJobFresh(WEBSITE_PIPELINE_JOB_TYPE, pipelineSessionId);
    const dispatched = await dispatchStage(pipelineSessionId, next, freshParent);
    if (!dispatched?.ok && dispatched?.status === "failed") {
      await continueAfterDispatchFailure(pipelineSessionId, next.auditType);
    }
    return { ok: true, pipelineSessionId, nextStage: next.auditType, dispatch: dispatched };
  }

  return scheduleFinalisation(pipelineSessionId);
}

export async function getWebsiteAuditPipelineJobFresh(sessionId) {
  return getPublicJobFresh(WEBSITE_PIPELINE_JOB_TYPE, sessionId);
}

export const __websiteAuditPipelineTestHooks = {
  safeSegment,
  stageDefinition,
  stageIndex,
  parentStageMetadata,
  strictTemporaryCleanup,
};

export default {
  startWebsiteAuditPipeline,
  resumeWebsiteAuditPipelineFromChild,
  finaliseWebsiteAuditPipeline,
  getWebsiteAuditPipelineJobFresh,
  websitePipelineTempPrefix,
  websitePipelineFinalKey,
  websitePipelineChildSessionId,
};
