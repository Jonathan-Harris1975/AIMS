import { info, error as logError } from "../../logger.js";
import {
  completeJob,
  failJob,
  flushJobStoreWrites,
  getPublicJobFresh,
  getMostRecentActiveJobFresh,
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
  getAuditPublicBaseUrl,
  publishAuditBuffer,
  publishAuditJson,
  publishAuditText,
  readAuditJson,
} from "./publishAuditArtifacts.js";
import {
  buildWebsiteAuditHtml,
  compactWebsiteAuditInputs,
  evaluateWebsiteAuditStageHealth,
  renderWebsiteAuditPdf,
  runWebsiteAuditCouncil,
} from "./websiteAuditCouncil.js";
import { assertRamsWebsiteDispatchConfigured, dispatchWebsiteAuditToRams } from "./ramsWebsiteDispatch.js";
import { compactWebsiteAuditPolicy, websiteAuditDefaultExclusions } from "./websiteAuditPolicy.js";

export const WEBSITE_PIPELINE_AUDIT_TYPE = "website";
export const WEBSITE_PIPELINE_JOB_TYPE = makeAuditJobType(WEBSITE_PIPELINE_AUDIT_TYPE);
const DEFAULT_WEBSITE_URL = "https://jonathan-harris.online";
const WEBSITE_ACTIVE_RUN_REUSE_MS = Number(process.env.WEBSITE_AUDIT_RUN_REUSE_ACTIVE_MS || 6 * 60 * 60 * 1000);
const AUDIT_ARTEFACT_READ_ATTEMPTS = Math.max(1, Number(process.env.AUDIT_ARTEFACT_READ_ATTEMPTS || 3));
const AUDIT_ARTEFACT_READ_TIMEOUT_MS = Math.max(1000, Number(process.env.AUDIT_ARTEFACT_READ_TIMEOUT_MS || 15000));

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

export function websitePipelineFinalKeys(sessionId, date = new Date()) {
  const month = date.toISOString().slice(0, 7);
  const prefix = `audits/website/${month}/${safeSegment(sessionId)}`;
  return {
    prefix,
    pdf: `${prefix}/website-audit.pdf`,
    html: `${prefix}/website-audit.html`,
    json: `${prefix}/website-audit.json`,
  };
}

export function websitePipelineFinalKey(sessionId, date = new Date()) {
  return websitePipelineFinalKeys(sessionId, date).pdf;
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
        notes: `Temporary child stage of website audit pipeline ${parentSessionId}. AIMS owns sequencing and final retention. Blog and transcript routes are delegated to their dedicated R2 audit pipelines; podcast routes remain in scope.`,
        excludePatterns: websiteAuditDefaultExclusions(stage.auditType),
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
  // Fail before dispatching expensive audit workflows when the final RAMS handoff
  // cannot possibly succeed. RAMS availability is handled by MAST wake-up, but
  // the URL and shared bearer secret must already be configured in AIMS.
  assertRamsWebsiteDispatchConfigured();
  const forceNewRun = body.forceNewRun === true
    || ["1", "true", "yes", "on"].includes(String(body.forceNewRun || body.force || "").trim().toLowerCase());
  const explicitSessionId = body.sessionId
    ? sanitizeSessionId(body.sessionId, "AUD-WEBSITE")
    : null;

  if (!explicitSessionId && !forceNewRun) {
    const active = await getMostRecentActiveJobFresh(WEBSITE_PIPELINE_JOB_TYPE, {
      maxAgeMs: WEBSITE_ACTIVE_RUN_REUSE_MS,
    });
    if (active) {
      return {
        ok: active.status !== "failed",
        auditType: WEBSITE_PIPELINE_AUDIT_TYPE,
        sessionId: active.sessionId,
        status: active.status,
        currentStage: active.currentStage || null,
        reusedActiveRun: true,
        message: "A website audit pipeline is already active; returning the existing canonical run.",
        finalReportKey: active.finalReportKey || null,
        finalReportKeys: active.finalReportKeys || null,
        job: active,
      };
    }
  }

  const sessionId = explicitSessionId || sanitizeSessionId(`website-${Date.now()}`, "AUD-WEBSITE");
  const existing = await getPublicJobFresh(WEBSITE_PIPELINE_JOB_TYPE, sessionId);
  if (existing && ["queued", "running", "completed"].includes(existing.status) && !forceNewRun) {
    return { ok: existing.status !== "failed", auditType: WEBSITE_PIPELINE_AUDIT_TYPE, sessionId, status: existing.status, reused: true, job: existing };
  }

  const websiteUrl = String(body.websiteUrl || DEFAULT_WEBSITE_URL).trim().replace(/\/+$/, "");
  const tempPrefix = websitePipelineTempPrefix(sessionId);
  const finalReportKeys = websitePipelineFinalKeys(sessionId);
  queueJob(WEBSITE_PIPELINE_JOB_TYPE, sessionId, {
    auditType: WEBSITE_PIPELINE_AUDIT_TYPE,
    websiteUrl,
    requestedBy: body.requestedBy || "MAST",
    notes: body.notes || "",
    phase: "queued",
    currentStage: null,
    tempPrefix,
    finalReportKey: finalReportKeys.pdf,
    finalReportKeys,
    retentionPolicy: "conditional-final-set-with-failure-evidence-retention",
    websiteAuditPolicy: compactWebsiteAuditPolicy(),
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
    finalReportKey: finalReportKeys.pdf,
    finalReportKeys,
    retentionPolicy: "conditional-final-set-with-failure-evidence-retention",
    websiteAuditPolicy: compactWebsiteAuditPolicy(),
    stages: {},
  });
  await flushJobStoreWrites({ throwOnError: false });

  const first = WEBSITE_PIPELINE_STAGES[0];
  const result = await dispatchStage(sessionId, first, await getPublicJobFresh(WEBSITE_PIPELINE_JOB_TYPE, sessionId));
  if (!result?.ok && result?.status === "failed") {
    await continueAfterDispatchFailure(sessionId, first.auditType);
  }

  const job = await getPublicJobFresh(WEBSITE_PIPELINE_JOB_TYPE, sessionId);
  info("audit.website.pipeline.started", { sessionId, websiteUrl, finalReportKeys });
  return {
    ok: true,
    auditType: WEBSITE_PIPELINE_AUDIT_TYPE,
    sessionId,
    status: job?.status || "running",
    currentStage: job?.currentStage || first.auditType,
    finalReportKey: finalReportKeys.pdf,
    finalReportKeys,
    job,
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalisePrefix(value) {
  return String(value || "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

function publicAuditUrlForKey(key) {
  const base = String(getAuditPublicBaseUrl() || "").trim().replace(/\/+$/, "");
  const cleanKey = normalisePrefix(key);
  return base && cleanKey ? `${base}/${cleanKey}` : "";
}

function uniqueLocations(values = []) {
  const seen = new Set();
  return values.map((value) => String(value || "").trim()).filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

async function fetchAuditJson(url) {
  if (!url || typeof fetch !== "function") throw new Error("Public audit JSON fetch is unavailable");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUDIT_ARTEFACT_READ_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function readAuditJsonLocation(location) {
  const value = String(location || "").trim();
  if (!value) throw new Error("Audit JSON location is empty");
  const key = auditKeyFromPublicUrl(value);
  const url = /^https?:\/\//i.test(value) ? value : publicAuditUrlForKey(key || value);
  const errors = [];

  for (let attempt = 1; attempt <= AUDIT_ARTEFACT_READ_ATTEMPTS; attempt += 1) {
    if (key) {
      try {
        return { data: await readAuditJson({ key }), location: key, transport: "r2-sdk", attempt };
      } catch (err) {
        errors.push(`R2 attempt ${attempt}: ${err?.message || String(err)}`);
      }
    }

    if (url) {
      try {
        return { data: await fetchAuditJson(url), location: url, transport: "public-http", attempt };
      } catch (err) {
        errors.push(`HTTP attempt ${attempt}: ${err?.message || String(err)}`);
      }
    }

    if (attempt < AUDIT_ARTEFACT_READ_ATTEMPTS) await wait(attempt * 500);
  }

  throw new Error(errors.join(" | ") || `Unable to read audit JSON from ${value}`);
}

async function loadJsonArtefact(label, locations = []) {
  const diagnostics = [];
  for (const location of uniqueLocations(locations)) {
    try {
      const loaded = await readAuditJsonLocation(location);
      return { value: loaded.data, loadedFrom: loaded.location, transport: loaded.transport, attempt: loaded.attempt, errors: diagnostics };
    } catch (err) {
      diagnostics.push(`${location}: ${err?.message || String(err)}`);
    }
  }
  return { value: null, loadedFrom: null, transport: null, attempt: null, errors: diagnostics.length ? diagnostics : [`No ${label} location was available`] };
}

function stageArtefactLocations({ stageState, childJob, reportPrefix, directKey, artefactName }) {
  return uniqueLocations([
    childJob?.[directKey],
    stageState?.[directKey],
    childJob?.artefacts?.[artefactName],
    stageState?.artefacts?.[artefactName],
    `${reportPrefix}/${artefactName}`,
  ]);
}

function compactArtefactLoadDiagnostic(load = {}) {
  return {
    loaded: Boolean(load.loadedFrom),
    loadedFrom: load.loadedFrom || null,
    transport: load.transport || null,
    attempt: load.attempt || null,
    errors: Array.isArray(load.errors) ? load.errors.slice(0, 12) : [],
  };
}

async function loadChildStage(parentSessionId, stage, parentJob) {
  const stageState = parentJob?.stages?.[stage.key] || {};
  const expectedChildId = stageState.sessionId || websitePipelineChildSessionId(parentSessionId, stage.auditType);
  const expectedReportPrefix = normalisePrefix(
    stageState.reportPrefix || `${websitePipelineTempPrefix(parentSessionId)}/${stage.prefixLeaf}`
  );
  const childJob = await getPublicJobFresh(makeAuditJobType(stage.auditType), expectedChildId);
  const mismatches = [];

  if (childJob?.pipelineSessionId && childJob.pipelineSessionId !== parentSessionId) {
    mismatches.push(`Child job pipelineSessionId ${childJob.pipelineSessionId} does not match ${parentSessionId}`);
  }
  if (childJob?.reportPrefix && normalisePrefix(childJob.reportPrefix) !== expectedReportPrefix) {
    mismatches.push(`Child job reportPrefix ${childJob.reportPrefix} does not match ${expectedReportPrefix}`);
  }

  const trustedChildJob = mismatches.length ? null : childJob;
  const [reportLoad, summaryLoad, coverageLoad, evidenceLoad, executionLoad, preflightLoad] = await Promise.all([
    loadJsonArtefact("report.json", stageArtefactLocations({ stageState, childJob: trustedChildJob, reportPrefix: expectedReportPrefix, directKey: "reportJsonUrl", artefactName: "report.json" })),
    loadJsonArtefact("summary.json", stageArtefactLocations({ stageState, childJob: trustedChildJob, reportPrefix: expectedReportPrefix, directKey: "summaryUrl", artefactName: "summary.json" })),
    loadJsonArtefact("coverage.json", stageArtefactLocations({ stageState, childJob: trustedChildJob, reportPrefix: expectedReportPrefix, directKey: "coverageUrl", artefactName: "coverage.json" })),
    loadJsonArtefact("evidence.json", stageArtefactLocations({ stageState, childJob: trustedChildJob, reportPrefix: expectedReportPrefix, directKey: "evidenceUrl", artefactName: "evidence.json" })),
    loadJsonArtefact("execution.json", stageArtefactLocations({ stageState, childJob: trustedChildJob, reportPrefix: expectedReportPrefix, directKey: "executionUrl", artefactName: "execution.json" })),
    loadJsonArtefact("preflight.json", uniqueLocations([
      ...stageArtefactLocations({ stageState, childJob: trustedChildJob, reportPrefix: expectedReportPrefix, directKey: "preflightUrl", artefactName: "preflight.json" }),
      trustedChildJob?.reconciliationUrl,
      stageState?.reconciliationUrl,
      `${expectedReportPrefix}/reconciliation.json`,
    ])),
  ]);

  const report = reportLoad.value && typeof reportLoad.value === "object" ? reportLoad.value : {};
  const summary = summaryLoad.value && typeof summaryLoad.value === "object" ? summaryLoad.value : {};
  const coverage = coverageLoad.value && typeof coverageLoad.value === "object" ? coverageLoad.value : {};
  const evidence = evidenceLoad.value && typeof evidenceLoad.value === "object" ? evidenceLoad.value : {};
  const execution = executionLoad.value && typeof executionLoad.value === "object" ? executionLoad.value : {};
  const preflight = preflightLoad.value && typeof preflightLoad.value === "object" ? preflightLoad.value : {};
  const completionState = String(
    report.auditCompletionState
      || report.analysisCompletionState
      || report.analysis?.auditCompletionState
      || coverage.auditCompletionState
      || summary.auditCompletionState
      || ""
  ).trim().toLowerCase();
  const status = trustedChildJob?.status
    || stageState.status
    || (completionState === "complete" ? "completed" : "unknown");
  const reportJsonUrl = trustedChildJob?.reportJsonUrl
    || stageState.reportJsonUrl
    || publicAuditUrlForKey(`${expectedReportPrefix}/report.json`)
    || null;

  const loadDiagnostics = {
    expectedParentSessionId: parentSessionId,
    expectedChildSessionId: expectedChildId,
    expectedReportPrefix,
    childJobFound: Boolean(childJob),
    childJobTrusted: Boolean(trustedChildJob),
    mismatches,
    artefacts: {
      reportJson: compactArtefactLoadDiagnostic(reportLoad),
      summary: compactArtefactLoadDiagnostic(summaryLoad),
      coverage: compactArtefactLoadDiagnostic(coverageLoad),
      evidence: compactArtefactLoadDiagnostic(evidenceLoad),
      execution: compactArtefactLoadDiagnostic(executionLoad),
      preflight: compactArtefactLoadDiagnostic(preflightLoad),
    },
  };

  return {
    ...report,
    auditType: stage.auditType,
    sessionId: expectedChildId,
    pipelineSessionId: parentSessionId,
    reportPrefix: expectedReportPrefix,
    status,
    summary: report.summary || summary,
    coverage: report.coverage || coverage,
    evidence: report.evidence || evidence,
    execution: report.execution || execution,
    preflight: report.preflight || preflight,
    reportUrl: trustedChildJob?.reportUrl || stageState.reportUrl || publicAuditUrlForKey(`${expectedReportPrefix}/report.html`) || null,
    reportJsonUrl,
    summaryUrl: trustedChildJob?.summaryUrl || stageState.summaryUrl || publicAuditUrlForKey(`${expectedReportPrefix}/summary.json`) || null,
    coverageUrl: trustedChildJob?.coverageUrl || stageState.coverageUrl || publicAuditUrlForKey(`${expectedReportPrefix}/coverage.json`) || null,
    evidenceUrl: trustedChildJob?.evidenceUrl || stageState.evidenceUrl || publicAuditUrlForKey(`${expectedReportPrefix}/evidence.json`) || null,
    executionUrl: trustedChildJob?.executionUrl || stageState.executionUrl || publicAuditUrlForKey(`${expectedReportPrefix}/execution.json`) || null,
    preflightUrl: trustedChildJob?.preflightUrl || stageState.preflightUrl || publicAuditUrlForKey(`${expectedReportPrefix}/preflight.json`) || null,
    workflowRunUrl: trustedChildJob?.workflowRunUrl || stageState.workflowRunUrl || null,
    hardGateBlocked: Boolean(
      trustedChildJob?.hardGateBlocked === true
      || report.hardGateBlocked === true
      || summary.hardGateBlocked === true
      || [trustedChildJob?.releaseVerdict, report.releaseVerdict, summary.releaseVerdict]
        .some((value) => String(value || "").trim().toUpperCase() === "BLOCKED")
    ),
    mobileQualityScore: trustedChildJob?.mobileQualityScore ?? report.mobileQualityScore ?? summary.mobileQualityScore ?? null,
    releaseVerdict: trustedChildJob?.releaseVerdict ?? report.releaseVerdict ?? summary.releaseVerdict ?? null,
    screenshotCount: trustedChildJob?.screenshotCount ?? report.screenshotCount ?? summary.screenshotCount ?? null,
    mobileFailureCount: trustedChildJob?.mobileFailureCount ?? report.mobileFailureCount ?? summary.mobileFailureCount ?? null,
    sourceRevisionSha: trustedChildJob?.sourceRevisionSha ?? report.sourceRevisionSha ?? execution.sourceRevisionSha ?? null,
    liveReleaseSha: trustedChildJob?.liveReleaseSha ?? report.liveReleaseSha ?? execution.liveReleaseSha ?? null,
    liveReleaseMarkerUrl: trustedChildJob?.liveReleaseMarkerUrl ?? report.liveReleaseMarkerUrl ?? execution.liveReleaseMarkerUrl ?? null,
    liveSourceParity: trustedChildJob?.liveSourceParity ?? report.liveSourceParity ?? execution.liveSourceParity ?? "unverified",
    accessibilityEvidence: trustedChildJob?.accessibilityEvidence ?? report.accessibilityEvidence ?? evidence.accessibilityEvidence ?? null,
    visualDesignEvidence: trustedChildJob?.visualDesignEvidence ?? report.visualDesignEvidence ?? evidence.visualDesignEvidence ?? null,
    performanceEvidence: trustedChildJob?.performanceEvidence ?? report.performanceEvidence ?? evidence.performanceEvidence ?? null,
    searchConsoleEvidence: trustedChildJob?.searchConsoleEvidence ?? report.searchConsoleEvidence ?? evidence.searchConsoleEvidence ?? null,
    securityEvidence: trustedChildJob?.securityEvidence ?? report.securityEvidence ?? evidence.securityEvidence ?? null,
    callbackDiagnostics: trustedChildJob?.callbackDiagnostics || stageState.callbackDiagnostics || report.callbackDiagnostics || null,
    artifactLoadDiagnostics: loadDiagnostics,
    jobError: trustedChildJob?.error
      || stageState.error
      || report.error
      || (mismatches.length ? { message: mismatches.join("; ") } : null)
      || (!reportLoad.value ? { message: `Unable to load ${stage.auditType} report.json: ${reportLoad.errors.join(" | ")}` } : null),
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
  if (parent.status === "completed" && parent.finalReportJsonUrl && parent.ramsDispatch?.ok) return parent;

  await persistParent(parentSessionId, {
    status: "running",
    phase: "council-and-final-report",
    currentStage: "council-and-final-report",
    finalising: true,
    finalisingAt: parent.finalisingAt || new Date().toISOString(),
  });

  const generatedAt = new Date().toISOString();
  const finalReportKeys = parent.finalReportKeys || websitePipelineFinalKeys(parentSessionId, new Date(generatedAt));
  let publishedSet = null;
  let cleanupResult = null;
  let sourceStageHealth = null;
  let ramsDispatch = null;
  try {
    const current = await getPublicJobFresh(WEBSITE_PIPELINE_JOB_TYPE, parentSessionId);
    const [digitalGrowth, seoAeoGeo, mobileUx] = await Promise.all(
      WEBSITE_PIPELINE_STAGES.map((stage) => loadChildStage(parentSessionId, stage, current))
    );
    const stageReports = { digitalGrowth, seoAeoGeo, mobileUx };
    sourceStageHealth = evaluateWebsiteAuditStageHealth(stageReports);
    const council = await runWebsiteAuditCouncil(stageReports);
    const completeEvidenceContract = sourceStageHealth.ok && String(council.synthesisState || "").trim().toLowerCase() === "complete";
    const reportType = completeEvidenceContract ? "unified-website-audit" : "controlled-website-audit-failure";
    const retentionPolicy = completeEvidenceContract ? "final-pdf-html-json-only-after-rams-acceptance" : "final-report-set-plus-retained-source-evidence";

    const html = buildWebsiteAuditHtml({
      websiteUrl: current.websiteUrl || DEFAULT_WEBSITE_URL,
      sessionId: parentSessionId,
      generatedAt,
      council,
      stageReports,
    });
    const pdfBuffer = await renderWebsiteAuditPdf(html);

    const pdf = await publishAuditBuffer({ key: finalReportKeys.pdf, body: pdfBuffer, contentType: "application/pdf" });
    const htmlReport = await publishAuditText({ key: finalReportKeys.html, text: html, contentType: "text/html; charset=utf-8" });
    const jsonPayload = {
      schemaVersion: "website-audit-report/v2",
      remediationContractVersion: "rams-website/v1",
      auditType: WEBSITE_PIPELINE_AUDIT_TYPE,
      reportType,
      reportStatus: completeEvidenceContract ? "complete" : "incomplete",
      sessionId: parentSessionId,
      websiteUrl: current.websiteUrl || DEFAULT_WEBSITE_URL,
      generatedAt,
      retentionPolicy,
      websiteAuditPolicy: compactWebsiteAuditPolicy(),
      sourceStageHealth,
      sourceStages: compactWebsiteAuditInputs(stageReports),
      sourceArtifactDiagnostics: Object.fromEntries(
        Object.entries(stageReports).map(([key, value]) => [key, value.artifactLoadDiagnostics || null])
      ),
      council,
      reportSet: {
        pdf: { key: pdf.key, url: pdf.url },
        html: { key: htmlReport.key, url: htmlReport.url },
        json: { key: finalReportKeys.json },
      },
      operational: {
        orchestrator: "AIMS",
        temporaryEvidencePrefix: current.tempPrefix || websitePipelineTempPrefix(parentSessionId),
        temporaryEvidenceRetention: completeEvidenceContract
          ? "retained-until-rams-acceptance-then-deleted"
          : "retained-for-diagnosis-and-rerun",
        ramsPipeline: "website",
        ramsDispatchPermitted: completeEvidenceContract,
        delegatedAuditFamilies: compactWebsiteAuditPolicy().delegatedAuditFamilies,
      },
    };
    const jsonReport = await publishAuditJson({ key: finalReportKeys.json, payload: jsonPayload });
    publishedSet = { pdf, html: htmlReport, json: jsonReport };
    const retainedArtefacts = [pdf.url, htmlReport.url, jsonReport.url];

    if (!completeEvidenceContract) {
      const failedLabels = sourceStageHealth.failures.map((stage) => `${stage.label} (${stage.status})`).join(", ");
      const incompleteError = new Error(`Website audit evidence contract incomplete: ${failedLabels || "council synthesis was incomplete"}`);
      const failed = failJob(WEBSITE_PIPELINE_JOB_TYPE, parentSessionId, incompleteError, {
        auditType: WEBSITE_PIPELINE_AUDIT_TYPE,
        phase: "controlled-audit-failure",
        currentStage: null,
        finalising: false,
        finalReportKey: pdf.key,
        finalReportKeys,
        finalReportUrl: pdf.url,
        finalReportPdfUrl: pdf.url,
        finalReportHtmlUrl: htmlReport.url,
        finalReportJsonUrl: jsonReport.url,
        retainedArtefacts,
        retentionPolicy,
        temporaryCleanup: { ok: false, skipped: true, reason: "Source audit evidence is incomplete and must be retained for diagnosis." },
        cleanupRequired: false,
        evidenceRetentionRequired: true,
        ramsDispatch: { ok: false, skipped: true, reason: "RAMS dispatch is prohibited until all required source audit stages complete." },
        synthesisState: "Incomplete",
        targetAssessment: council.targetAssessment || null,
        sourceStageHealth,
        stageStatuses: {
          digitalGrowth: digitalGrowth.status,
          seoAeoGeo: seoAeoGeo.status,
          mobileUx: mobileUx.status,
        },
      });
      await flushJobStoreWrites({ throwOnError: false });
      logError("audit.website.pipeline.controlled_failure", {
        pipelineSessionId: parentSessionId,
        finalReportJsonUrl: jsonReport.url,
        retainedTemporaryEvidencePrefix: current.tempPrefix || websitePipelineTempPrefix(parentSessionId),
        failedStages: sourceStageHealth.failures.map((stage) => ({ key: stage.key, status: stage.status, reason: stage.reason, workflowRunUrl: stage.workflowRunUrl })),
      });
      return failed;
    }

    // RAMS must accept the complete machine-readable report before temporary
    // source evidence is removed. This preserves the forensic trail if the
    // handoff fails and makes a retry safe.
    ramsDispatch = await dispatchWebsiteAuditToRams({
      sessionId: parentSessionId,
      auditJsonKey: jsonReport.key,
    });
    cleanupResult = await strictTemporaryCleanup(current.tempPrefix || websitePipelineTempPrefix(parentSessionId));

    const completed = completeJob(WEBSITE_PIPELINE_JOB_TYPE, parentSessionId, {
      auditType: WEBSITE_PIPELINE_AUDIT_TYPE,
      phase: "completed",
      currentStage: null,
      finalising: false,
      finalReportKey: pdf.key,
      finalReportKeys,
      finalReportUrl: pdf.url,
      finalReportPdfUrl: pdf.url,
      finalReportHtmlUrl: htmlReport.url,
      finalReportJsonUrl: jsonReport.url,
      retainedArtefacts,
      retentionPolicy,
      temporaryCleanup: { ok: true, deletedCount: cleanupResult.deleted.length, attempts: cleanupResult.attempts, remainingCount: cleanupResult.remaining?.length || 0 },
      cleanupRequired: false,
      evidenceRetentionRequired: false,
      ramsDispatch,
      synthesisState: council.synthesisState,
      targetAssessment: council.targetAssessment || null,
      sourceStageHealth,
      stageStatuses: {
        digitalGrowth: digitalGrowth.status,
        seoAeoGeo: seoAeoGeo.status,
        mobileUx: mobileUx.status,
      },
    });
    await flushJobStoreWrites({ throwOnError: false });
    info("audit.website.pipeline.completed", {
      pipelineSessionId: parentSessionId,
      finalReportPdfUrl: pdf.url,
      finalReportHtmlUrl: htmlReport.url,
      finalReportJsonUrl: jsonReport.url,
      deletedTemporaryObjects: cleanupResult.deleted.length,
      ramsRunId: ramsDispatch.runId || null,
      synthesisState: council.synthesisState,
    });
    return completed;
  } catch (err) {
    // Remove only an incomplete final report set. Temporary child evidence is
    // never deleted on report, RAMS or cleanup failure.
    if (!publishedSet) {
      try { await cleanupAuditPrefix({ reportPrefix: finalReportKeys.prefix }); } catch {}
    }
    const retainedArtefacts = publishedSet
      ? [publishedSet.pdf?.url, publishedSet.html?.url, publishedSet.json?.url].filter(Boolean)
      : [];
    const failed = failJob(WEBSITE_PIPELINE_JOB_TYPE, parentSessionId, err, {
      auditType: WEBSITE_PIPELINE_AUDIT_TYPE,
      phase: publishedSet ? (ramsDispatch?.ok ? "temporary-cleanup-failed" : "rams-dispatch-failed") : "final-report-set-failed",
      currentStage: null,
      finalising: false,
      finalReportKey: publishedSet?.pdf?.key || finalReportKeys.pdf,
      finalReportKeys,
      finalReportUrl: publishedSet?.pdf?.url || null,
      finalReportPdfUrl: publishedSet?.pdf?.url || null,
      finalReportHtmlUrl: publishedSet?.html?.url || null,
      finalReportJsonUrl: publishedSet?.json?.url || null,
      retainedArtefacts,
      cleanupRequired: Boolean(ramsDispatch?.ok) && !cleanupResult,
      evidenceRetentionRequired: true,
      sourceStageHealth,
      ramsDispatch: ramsDispatch || { ok: false, error: err?.message || String(err) },
      temporaryCleanup: cleanupResult
        ? { ok: true, deletedCount: cleanupResult.deleted.length, attempts: cleanupResult.attempts, remainingCount: cleanupResult.remaining?.length || 0 }
        : { ok: false, skipped: true, reason: "Temporary evidence retained after pipeline failure." },
    });
    await flushJobStoreWrites({ throwOnError: false });
    logError("audit.website.pipeline.failed", {
      pipelineSessionId: parentSessionId,
      retainedArtefacts,
      temporaryEvidenceRetained: true,
      message: err?.message || String(err),
    });
    return failed;
  }
}

export async function retryWebsiteAuditRamsDispatch(parentSessionId) {
  const parent = await getPublicJobFresh(WEBSITE_PIPELINE_JOB_TYPE, parentSessionId);
  if (!parent) throw new Error(`Website audit pipeline job not found: ${parentSessionId}`);
  const auditJsonKey = parent.finalReportKeys?.json || auditKeyFromPublicUrl(parent.finalReportJsonUrl);
  if (!auditJsonKey) throw new Error("Final website audit JSON is not available for RAMS dispatch");
  if (!parent.sourceStageHealth?.ok || String(parent.synthesisState || "").toLowerCase() !== "complete") {
    throw new Error("RAMS dispatch is prohibited because the website audit source evidence contract is incomplete");
  }

  // A previous dispatch may already have succeeded while temporary cleanup failed.
  // Reuse that accepted handoff rather than sending the same audit to RAMS again.
  const ramsDispatch = parent.ramsDispatch?.ok
    ? parent.ramsDispatch
    : await dispatchWebsiteAuditToRams({ sessionId: parentSessionId, auditJsonKey });
  const cleanup = await strictTemporaryCleanup(parent.tempPrefix || websitePipelineTempPrefix(parentSessionId));
  const updated = updateJob(WEBSITE_PIPELINE_JOB_TYPE, parentSessionId, {
    ramsDispatch,
    temporaryCleanup: { ok: true, deletedCount: cleanup.deleted.length, attempts: cleanup.attempts, remainingCount: cleanup.remaining?.length || 0 },
    cleanupRequired: false,
    evidenceRetentionRequired: false,
    status: parent.finalReportJsonUrl ? "completed" : parent.status,
    phase: parent.finalReportJsonUrl ? "completed" : parent.phase,
    updatedAt: new Date().toISOString(),
  });
  await flushJobStoreWrites({ throwOnError: false });
  return updated;
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

  const expectedStage = parent.stages?.[stage.key] || parentStageMetadata(pipelineSessionId, stage, parent.websiteUrl || DEFAULT_WEBSITE_URL);
  const receivedSessionId = String(result?.sessionId || result?.job?.sessionId || "").trim();
  const receivedReportPrefix = normalisePrefix(result?.job?.reportPrefix || "");
  const expectedReportPrefix = normalisePrefix(expectedStage.reportPrefix);
  if (expectedStage.sessionId && receivedSessionId !== expectedStage.sessionId) {
    throw new Error(
      `Website audit child session mismatch for ${auditType}: expected ${expectedStage.sessionId}, received ${receivedSessionId || "<empty>"}`
    );
  }
  if (expectedReportPrefix && receivedReportPrefix && receivedReportPrefix !== expectedReportPrefix) {
    throw new Error(
      `Website audit child reportPrefix mismatch for ${auditType}: expected ${expectedReportPrefix}, received ${receivedReportPrefix}`
    );
  }
  if (result?.job?.pipelineSessionId && result.job.pipelineSessionId !== pipelineSessionId) {
    throw new Error(
      `Website audit child pipelineSessionId mismatch for ${auditType}: expected ${pipelineSessionId}, received ${result.job.pipelineSessionId}`
    );
  }

  const childStage = {
    ...expectedStage,
    sessionId: receivedSessionId || expectedStage.sessionId,
    auditType,
    status: result.status || result.job?.status || "unknown",
    reportPrefix: receivedReportPrefix || expectedReportPrefix,
    reportUrl: result.job?.reportUrl || expectedStage.reportUrl || null,
    reportJsonUrl: result.job?.reportJsonUrl || expectedStage.reportJsonUrl || null,
    summaryUrl: result.job?.summaryUrl || expectedStage.summaryUrl || null,
    coverageUrl: result.job?.coverageUrl || expectedStage.coverageUrl || null,
    evidenceUrl: result.job?.evidenceUrl || expectedStage.evidenceUrl || null,
    executionUrl: result.job?.executionUrl || expectedStage.executionUrl || null,
    preflightUrl: result.job?.preflightUrl || expectedStage.preflightUrl || null,
    reconciliationUrl: result.job?.reconciliationUrl || expectedStage.reconciliationUrl || null,
    screenshotManifestUrl: result.job?.screenshotManifestUrl || expectedStage.screenshotManifestUrl || null,
    focusedPageAppendixUrl: result.job?.focusedPageAppendixUrl || expectedStage.focusedPageAppendixUrl || null,
    repositoryIssueAppendixUrl: result.job?.repositoryIssueAppendixUrl || expectedStage.repositoryIssueAppendixUrl || null,
    mandatoryMobileScorecardUrl: result.job?.mandatoryMobileScorecardUrl || expectedStage.mandatoryMobileScorecardUrl || null,
    responsiveFixAppendixUrl: result.job?.responsiveFixAppendixUrl || expectedStage.responsiveFixAppendixUrl || null,
    artefacts: result.job?.artefacts || expectedStage.artefacts || {},
    callbackDiagnostics: result.job?.callbackDiagnostics || expectedStage.callbackDiagnostics || null,
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
  evaluateWebsiteAuditStageHealth,
};

export default {
  startWebsiteAuditPipeline,
  resumeWebsiteAuditPipelineFromChild,
  finaliseWebsiteAuditPipeline,
  getWebsiteAuditPipelineJobFresh,
  websitePipelineTempPrefix,
  websitePipelineFinalKey,
  websitePipelineFinalKeys,
  websitePipelineChildSessionId,
  retryWebsiteAuditRamsDispatch,
};
