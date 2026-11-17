import { publishAuditBuffer, publishAuditJson, publishAuditLatest, publishAuditText } from "./publishAuditArtifacts.js";
import { buildContentMasterHtml, loadContentMasterSources, renderContentMasterPdf, runContentMasterCouncil } from "./contentMasterCouncil.js";
import { runOnBrandAudit } from "./onBrandAudit.js";
import { runZernioSocialPerformanceReport } from "./zernioSocialPerformance.js";
import { runNewsletterAudit } from "./newsletterAudit.js";
import { collectMonthlyGrowthEvidence, renderMonthlyGrowthAppendix } from "../../services/podcast-growth/monthlyEvidence.js";
import { dispatchContentAuditToRams } from "./ramsContentDispatch.js";
import { info } from "../../logger.js";

const AUDIT_TYPE = "content-master";

function requireOk(result, label) {
  if (!result?.ok) {
    throw new Error(`${label} refresh failed: ${result?.error || "unknown failure"}`);
  }
  return result;
}

async function refreshMonthlySources(sessionId) {
  const onBrand = requireOk(await runOnBrandAudit({
    sessionId: `${sessionId}-on-brand`,
    runPodcastWebsiteReports: true,
    lookbackDays: 31,
    monthlyReview: true,
  }), "On-Brand audit");

  const podcastWebsite = requireOk(onBrand.podcastWebsiteReports, "Podcast website reports");

  const socialPerformance = requireOk(await runZernioSocialPerformanceReport({
    sessionId: `${sessionId}-social-performance`,
    runCouncil: true,
  }), "Social Performance audit");
  const brandSocialCouncil = requireOk(socialPerformance.council, "Brand/Social Council");

  const newsletter = requireOk(await runNewsletterAudit({
    sessionId: `${sessionId}-newsletter`,
  }), "Newsletter audit");

  return {
    onBrand,
    podcastEpisode: requireOk(podcastWebsite.podcastEpisode, "Podcast Episode audit"),
    podcastTranscript: requireOk(podcastWebsite.podcastTranscript, "Podcast Transcript audit"),
    socialPerformance,
    brandSocialCouncil,
    newsletter,
  };
}

function assertFreshSources(sources, refreshed) {
  const expectedSessions = {
    onBrand: refreshed.onBrand.sessionId,
    socialPerformance: refreshed.socialPerformance.sessionId,
    newsletter: refreshed.newsletter.sessionId,
    podcastEpisode: refreshed.podcastEpisode.sessionId,
    podcastTranscript: refreshed.podcastTranscript.sessionId,
    brandSocialCouncil: refreshed.brandSocialCouncil.sessionId,
  };

  const failures = [];
  for (const [label, expectedSessionId] of Object.entries(expectedSessions)) {
    const bundle = sources?.[label];
    const actualSessionId = String(bundle?.latest?.sessionId || "").trim();
    if (bundle?.status !== "complete") {
      failures.push(`${label}: expected complete source bundle, got ${bundle?.status || "missing"}`);
    }
    if (!expectedSessionId || actualSessionId !== String(expectedSessionId)) {
      failures.push(`${label}: latest session '${actualSessionId || "missing"}' does not match current refresh '${expectedSessionId || "missing"}'`);
    }
  }
  if (failures.length) {
    throw new Error(`Monthly content audit source freshness check failed: ${failures.join("; ")}`);
  }
  return expectedSessions;
}

export async function runContentMasterAudit({ sessionId = `content-master-${Date.now()}` } = {}) {
  if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) throw new Error("Content master sessionId must be a safe single path segment");
  const reportPrefix = `audits/${AUDIT_TYPE}/${new Date().toISOString().slice(0, 7)}/${sessionId}`;
  const generatedAt = new Date().toISOString();

  // A monthly master review is a transaction, not a reader of arbitrary
  // "latest" pointers. Refresh every source first, then prove every pointer
  // belongs to this run before the council is allowed to synthesise.
  const refreshed = await refreshMonthlySources(sessionId);
  const sources = await loadContentMasterSources();
  const sourceSessions = assertFreshSources(sources, refreshed);

  const council = await runContentMasterCouncil(sources);
  // Supplemental read-only evidence: never participates in the hard source-freshness
  // or editorial-quality gate and never initiates provider or KDP write operations.
  const podcastGrowth = await collectMonthlyGrowthEvidence();
  const sourceHtml = buildContentMasterHtml({ sessionId, generatedAt, council });
  const appendix = renderMonthlyGrowthAppendix(podcastGrowth);
  const html = sourceHtml.includes("</body>")
    ? sourceHtml.replace("</body>", appendix + "</body>")
    : sourceHtml + appendix;
  const pdfBuffer = await renderContentMasterPdf(html);
  const keys = {
    pdf: `${reportPrefix}/content-audit.pdf`,
    html: `${reportPrefix}/content-audit.html`,
    json: `${reportPrefix}/content-audit.json`,
  };

  const [pdf, htmlReport] = await Promise.all([
    publishAuditBuffer({ key: keys.pdf, body: pdfBuffer, contentType: "application/pdf" }),
    publishAuditText({ key: keys.html, text: html, contentType: "text/html; charset=utf-8" }),
  ]);

  const sourceRefresh = {
    completedAt: new Date().toISOString(),
    freshnessLocked: true,
    sessions: sourceSessions,
  };

  const jsonPayload = {
    schemaVersion: "content-audit-report/v2",
    remediationContractVersion: "rams-content/v1",
    auditType: AUDIT_TYPE,
    reportType: "unified-content-editorial-audit",
    sessionId,
    generatedAt,
    retentionPolicy: "final-pdf-html-json-only",
    sourceRefresh,
    council,
    podcastGrowth,
    reportSet: {
      pdf: { key: pdf.key, url: pdf.url },
      html: { key: htmlReport.key, url: htmlReport.url },
      json: { key: keys.json },
    },
    operational: {
      orchestrator: "AIMS",
      ramsPipeline: "content",
      ramsDispatchFeatureFlag: "CONTENT_AUDIT_TRIGGER_RAMS",
      remediationRouting: {
        schemaVersion: "audit-remediation-routing/v1",
        repairExecutionPolicy: "external-agent-only",
        singleWriterRequired: true,
        auditOwnsRepair: false,
        primaryRepairAgent: "kilo",
        plannedEngineeringAgent: "cto.new",
        ownershipTransferRequired: true,
        dependencyVersionOwner: "renovate",
        mergeAuthority: "github_native_auto_merge",
        humanDecisionSurface: "hive-ui",
      },
      retryPolicy: {
        maxTotalAttempts: 5,
        targetedRepair: true,
        carryPriorDefects: true,
        sourceIntegrityHardQuarantine: true,
      },
    },
  };

  const json = await publishAuditJson({ key: keys.json, payload: jsonPayload });
  const synthesisComplete = council.synthesisState === "Complete";
  let ramsDispatch = { ok: false, status: "blocked_incomplete_synthesis", enabled: false,
    reason: "Final synthesis is incomplete; retained for diagnosis only." };
  if (synthesisComplete) {
    try { ramsDispatch = await dispatchContentAuditToRams({ sessionId, auditJsonKey: json.key }); }
    catch (error) { ramsDispatch = { ok: false, status: "dispatch_failed", error: error.message }; }
  }
  const latest = await publishAuditLatest({
    auditType: AUDIT_TYPE,
    sessionId,
    payload: {
      reportPrefix,
      reportUrl: pdf.url,
      reportPdfUrl: pdf.url,
      reportHtmlUrl: htmlReport.url,
      reportJsonUrl: json.url,
      retentionPolicy: "final-pdf-html-json-only",
      sourceRefresh,
      podcastGrowth: { discoveryStatus: podcastGrowth.discovery.status, bookSalesStatus: podcastGrowth.bookSales.status },
      ramsDispatch,
      synthesisState: council.synthesisState,
    },
  });

  info("audit.content-master.complete", {
    sessionId,
    synthesisState: council.synthesisState,
    ramsStatus: ramsDispatch.status,
    sourceSessions,
  });

  return {
    ok: synthesisComplete && ramsDispatch.ok !== false && ramsDispatch.status !== "disabled",
    remediationPending: synthesisComplete && ramsDispatch.status === "awaiting-remediation",
    synthesisState: council.synthesisState,
    error: synthesisComplete ? (ramsDispatch.status === "disabled" ? "RAMS remediation dispatch is disabled"
      : ramsDispatch.ok === false ? "RAMS dispatch failed" : null) : "Content master synthesis incomplete",
    auditType: AUDIT_TYPE,
    sessionId,
    reportPrefix,
    reportUrl: pdf.url,
    reportPdfUrl: pdf.url,
    reportHtmlUrl: htmlReport.url,
    reportJsonUrl: json.url,
    latestUrl: latest.url,
    sourceRefresh,
    ramsDispatch,
    councilSeats: council.councilRecord?.seats?.length || 0,
  };
}

export function getContentMasterAuditStatus() {
  return {
    ok: true,
    auditType: AUDIT_TYPE,
    output: ["content-audit.pdf", "content-audit.html", "content-audit.json", "latest.json"],
    retentionPolicy: "final-pdf-html-json-only",
    sourceRefreshRequired: true,
    sourceFreshnessLocked: true,
    councilSeats: 36,
    rams: {
      schemaVersion: "rams-content/v1",
      featureFlag: "CONTENT_AUDIT_TRIGGER_RAMS",
      defaultDispatchEnabled: true,
      endpoint: "POST /rebuild/content/run",
    },
  };
}
