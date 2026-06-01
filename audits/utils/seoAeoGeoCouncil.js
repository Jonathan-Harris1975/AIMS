import {
  arr,
  clampScore,
  firstText,
  formatNumber,
  isR2PodcastEpisodePath,
  isWebsiteRepoPath,
  loadAuditBundle,
  makeCouncilFinding,
  newCouncilSessionId,
  normalisePathList,
  obj,
  percentage,
  publishCouncilReport,
  ramsCouncilPolicy,
  renderCouncilHtml,
  reportPrefixFor,
  severityRank,
  slug,
  toNumber,
  trim,
  uniqueBy,
} from "./siteCouncilShared.js";

const AUDIT_TYPE = "seo-aeo-geo-council";
const PIPELINE = "seo-aeo-geo";
const SOURCE_LATEST_KEY = "audits/seo-aeo-geo/latest.json";

function councilMembers() {
  return [
    { role: "SEO/AEO/GEO Lead", remit: "Search visibility, answer-engine readiness, GEO citation quality and overall JH-* issue movement." },
    { role: "Route & Coverage Lead", remit: "404s, failed routes, workbook vs repo mismatches, redirect/canonical evidence and coverage state." },
    { role: "Workbook & Source Governance Lead", remit: "Workbook, repo, sitemap, feed and R2 manifest alignment before RAMS is allowed to act." },
    { role: "R2 & Podcast Source Ownership Lead", remit: "Podcast/blog/transcript ownership, R2-hosted route handling and legacy URL exclusion or redirect decisions." },
    { role: "Transcript & Episode Quality Lead", remit: "Transcript summaries, takeaways, entity indexes, section anchors, PodcastEpisode and Transcript schema alignment." },
    { role: "Schema & Structured Data Lead", remit: "JSON-LD coverage, schema type correctness and visible-content alignment across page families." },
    { role: "Content Architecture Lead", remit: "Topic hubs, glossary, blog structure, question-led headings, internal linking and duplicated standfirst patterns." },
    { role: "Internal Linking & Conversion Path Lead", remit: "Book/topic/podcast/newsletter connections, CTA continuity and commercial search paths." },
    { role: "eBook Discovery & Commercial Intent Lead", remit: "Whether search, AEO snippets and topic pages lead readers clearly towards relevant Jonathan Harris ebooks without hype." },
    { role: "Automation Safety Lead", remit: "RAMS source ownership, deterministic evidence, patch eligibility and manual-review boundaries." },
  ];
}

function ramsPolicy() {
  return ramsCouncilPolicy({
    councilType: AUDIT_TYPE,
    defaultClassification: "manual_review",
    codePatchAllowed: "deterministic_website_repo_only",
  });
}

function sourceReports(bundle) {
  return {
    seoAeoGeo: {
      latestKey: SOURCE_LATEST_KEY,
      loaded: bundle.latestLoaded,
      reportPrefix: bundle.latest.reportPrefix || null,
      reportUrl: bundle.latest.reportUrl || null,
      reportJsonUrl: bundle.latest.reportJsonUrl || null,
      summaryUrl: bundle.latest.summaryUrl || null,
      coverageUrl: bundle.latest.coverageUrl || null,
      repositoryIssueAppendixUrl: bundle.latest.repositoryIssueAppendixUrl || null,
      errors: bundle.errors,
    },
  };
}

function getScore(report, summary, key, fallback = 0) {
  const scoreTable = obj(report?.scoreTable || summary?.scoreTable);
  const executiveScores = obj(report?.executiveSummary?.scores || summary?.executiveSummary?.scores);
  const scoreBlock = obj(scoreTable?.[key] || scoreTable?.[key.toUpperCase?.()] || executiveScores?.[key] || executiveScores?.[key.toUpperCase?.()]);
  return clampScore(
    report?.scores?.[key]
      ?? report?.scorecard?.[key]
      ?? scoreBlock.score
      ?? scoreBlock.value
      ?? scoreBlock.total
      ?? summary?.scores?.[key]
      ?? summary?.scorecard?.[key]
      ?? summary?.[key],
    fallback
  );
}

function scoreSnapshot(report, summary, coverage) {
  const assurance = obj(report.coverageAssurance || summary.coverageAssurance);
  const reconciliation = obj(report.inventoryReconciliationSummary || summary.inventoryReconciliationSummary);
  const control = obj(report.reportControl || report.controlBlock || summary.reportControl || summary.controlBlock || assurance || reconciliation);
  return {
    seo: getScore(report, summary, "seo", 0),
    aeo: getScore(report, summary, "aeo", 0),
    geo: getScore(report, summary, "geo", 0),
    entityAuthority: getScore(report, summary, "entityAuthority", 0),
    conversionSupport: getScore(report, summary, "conversionSupport", 0),
    discoveredUrls: toNumber(control.totalDiscoveredUrls ?? control.discoveredUrls ?? summary.totalDiscoveredUrls ?? coverage.totalDiscoveredUrls),
    analysedUrls: toNumber(control.totalAnalysedUrls ?? control.analysedUrls ?? summary.totalAnalysedUrls ?? coverage.totalAnalysedUrls),
    failedUrls: toNumber(control.totalFailedUrls ?? control.failedUrls ?? summary.totalFailedUrls ?? coverage.totalFailedUrls),
    coveragePercent: toNumber(control.coveragePercent ?? summary.coveragePercent ?? coverage.coveragePercent),
  };
}

function pathsFromCandidate(candidate) {
  const explicit = normalisePathList(candidate.affectedPaths);
  if (explicit.length) return explicit;
  const path = firstText(candidate.path, candidate.file, candidate.filePath, candidate.exactUrlOrFilePath, candidate.route);
  if (!path) return [];
  if (/^https?:\/\//i.test(path)) return [];
  return normalisePathList([path]);
}

function sourceOwnerFor(candidate, paths) {
  const owner = trim(candidate.sourceOwner || candidate.owner || candidate.patchOwner);
  if (owner) return owner;
  const haystack = [candidate.title, candidate.issueType, candidate.lens, candidate.affected, candidate.requiredOutcome, candidate.exactRemediation, ...arr(candidate.evidence)].join(" ").toLowerCase();
  if (paths.some(isR2PodcastEpisodePath) || haystack.includes("podcast episode") || haystack.includes("podcast rss")) return "aims_r2_podcast";
  if (haystack.includes("transcript")) return "transcript_pipeline";
  if (haystack.includes("blog/posts") || haystack.includes("blog article")) return "aims_r2_blog";
  if (paths.length && paths.every(isWebsiteRepoPath)) return "website_repo";
  if (haystack.includes("workbook") || haystack.includes("sitemap") || haystack.includes("manifest") || haystack.includes("route")) return "source_governance";
  return "manual_review";
}

function fixClassFor(candidate, text) {
  const explicit = firstText(candidate.allowedFixClass, candidate.fixClass, candidate.fix_class);
  if (explicit) return explicit;
  const haystack = text.toLowerCase();
  if (haystack.includes("schema") || haystack.includes("json-ld")) return "schema_fix";
  if (haystack.includes("canonical")) return "canonical_fix";
  if (haystack.includes("sitemap")) return "sitemap_fix";
  if (haystack.includes("internal link")) return "internal_link_fix";
  if (haystack.includes("meta") || haystack.includes("title")) return "meta_fix";
  return "";
}

function mapExistingFinding(candidate, index) {
  const paths = pathsFromCandidate(candidate);
  const title = firstText(candidate.title, candidate.issueType, candidate.issueTitle, candidate.id, `SEO/AEO/GEO finding ${index}`);
  const remediation = firstText(candidate.requiredOutcome, candidate.exactRemediation, candidate.recommendation, candidate.remediation, candidate.fix, candidate.action);
  const evidence = [
    firstText(candidate.evidence, candidate.exactEvidence, candidate.observed, candidate.summary, candidate.description),
    firstText(candidate.url, candidate.route, candidate.path),
    firstText(candidate.verificationMethod),
  ].filter(Boolean);
  const sourceOwner = sourceOwnerFor(candidate, paths);
  const text = [title, remediation, ...evidence].join(" ");
  const fixClass = fixClassFor(candidate, text);
  const explicitClassification = trim(candidate.classification);
  const codeReady = explicitClassification === "code_fix"
    && sourceOwner === "website_repo"
    && paths.length > 0
    && paths.every(isWebsiteRepoPath)
    && Boolean(fixClass)
    && Boolean(remediation)
    && evidence.length > 0;
  return makeCouncilFinding({
    id: firstText(candidate.issueId, candidate.findingId, candidate.id) || `SAG-${String(index).padStart(3, "0")}`,
    title,
    severity: candidate.severity || "medium",
    pipeline: PIPELINE,
    sourceType: "seo_aeo_geo_council",
    sourceOwner,
    councilMember: sourceOwner === "aims_r2_podcast" ? "R2 & Podcast Source Ownership Lead" : sourceOwner === "transcript_pipeline" ? "Transcript & Episode Quality Lead" : "SEO/AEO/GEO Lead",
    classification: codeReady ? "code_fix" : explicitClassification === "future_guidance" ? "future_guidance" : "manual_review",
    automationReadiness: codeReady ? "auto_patch_ready" : sourceOwner.includes("r2") ? "r2_generator_fix" : "manual_review_only",
    fixClass,
    allowedFixClass: codeReady ? fixClass : "",
    affectedPaths: paths,
    evidence,
    requiredOutcome: remediation || "Review the SEO/AEO/GEO evidence and produce a deterministic owner-specific remediation.",
    verificationMethod: firstText(candidate.verificationMethod) || "Rerun the SEO/AEO/GEO audit and confirm the source finding no longer appears.",
    confidence: candidate.confidence ?? 0.82,
  });
}

function candidateLists(bundle) {
  const report = obj(bundle.report);
  const summary = obj(bundle.summary);
  const coverage = obj(bundle.coverage);
  const appendix = obj(bundle.repositoryIssueAppendix);
  return [
    ...arr(appendix.findings),
    ...arr(appendix.issues),
    ...arr(report.findings),
    ...arr(report.issues),
    ...arr(report.rankedIssueLedger),
    ...arr(report.fullIssueRecords),
    ...arr(summary.findings),
    ...arr(summary.issues),
    ...arr(coverage.findings),
    ...arr(coverage.issues),
  ].filter((item) => item && typeof item === "object" && !Array.isArray(item));
}

function familyRows(report, summary, coverage) {
  return [
    ...arr(report.pageTypes),
    ...arr(report.pageTypeFindings),
    ...arr(report.familyCoverage),
    ...arr(summary.pageTypes),
    ...arr(summary.pageTypeFindings),
    ...arr(summary.familyCoverage),
    ...arr(coverage.familyCoverage),
    ...arr(coverage.pageTypes),
    ...arr(coverage.pageTypeFindings),
    ...arr(report.inventory?.families),
  ].filter((item) => item && typeof item === "object" && !Array.isArray(item));
}

function buildAggregateFindings({ bundle, scores }) {
  const report = obj(bundle.report);
  const summary = obj(bundle.summary);
  const coverage = obj(bundle.coverage);
  const findings = [];
  if (scores.failedUrls > 0) {
    findings.push(makeCouncilFinding({
      id: "SAG-COVERAGE-001",
      title: "Failed in-scope URLs block a complete SEO/AEO/GEO verdict",
      severity: scores.failedUrls >= 10 ? "critical" : "high",
      pipeline: PIPELINE,
      sourceType: "seo_aeo_geo_council",
      sourceOwner: "source_governance",
      councilMember: "Route & Coverage Lead",
      classification: "manual_review",
      automationReadiness: "redirect_governance_fix",
      evidence: [`failedUrls: ${scores.failedUrls}`, `coveragePercent: ${scores.coveragePercent || "unknown"}`],
      requiredOutcome: "Classify failed URLs as current live pages, legacy redirects, R2-owned routes or retired workbook rows before RAMS is allowed to plan patches.",
      verificationMethod: "Rerun SEO/AEO/GEO and confirm failed URL count is zero or each failed URL has explicit redirect/exclusion evidence.",
    }));
  }

  const mandatory = arr(report.mandatoryFamiliesIncomplete || summary.mandatoryFamiliesIncomplete || coverage.mandatoryFamiliesIncomplete);
  for (const family of mandatory.slice(0, 4)) {
    const familyText = trim(family);
    findings.push(makeCouncilFinding({
      id: `SAG-FAMILY-${slug(familyText).toUpperCase()}`,
      title: `${familyText} family needs source ownership before scoring`,
      severity: familyText.toLowerCase().includes("podcast") ? "high" : "medium",
      pipeline: PIPELINE,
      sourceType: "seo_aeo_geo_council",
      sourceOwner: familyText.toLowerCase().includes("podcast") ? "aims_r2_podcast" : "source_governance",
      councilMember: familyText.toLowerCase().includes("podcast") ? "R2 & Podcast Source Ownership Lead" : "Workbook & Source Governance Lead",
      classification: "manual_review",
      automationReadiness: familyText.toLowerCase().includes("podcast") ? "r2_generator_fix" : "manual_review_only",
      evidence: [`mandatoryFamiliesIncomplete: ${familyText}`],
      requiredOutcome: "Resolve source ownership and coverage state for this mandatory family before repo patching is considered.",
      verificationMethod: "Rerun the SEO/AEO/GEO audit and confirm the mandatory family is no longer incomplete.",
    }));
  }

  for (const row of familyRows(report, summary, coverage)) {
    const pageType = firstText(row.pageType, row.type, row.family, row.name);
    const averageScore = toNumber(row.averageScore ?? row.score ?? row.total);
    const failed = toNumber(row.failed ?? row.failedUrls ?? row.totalFailedUrls);
    if (!pageType) continue;
    if (failed <= 0 && (!averageScore || averageScore >= 75)) continue;
    findings.push(makeCouncilFinding({
      id: `SAG-PAGEFAMILY-${slug(pageType).toUpperCase()}`,
      title: `${pageType} page-family review`,
      severity: failed > 0 ? "high" : "medium",
      pipeline: PIPELINE,
      sourceType: "seo_aeo_geo_council",
      sourceOwner: pageType.toLowerCase().includes("podcast") ? "aims_r2_podcast" : pageType.toLowerCase().includes("transcript") ? "transcript_pipeline" : "manual_review",
      councilMember: pageType.toLowerCase().includes("transcript") ? "Transcript & Episode Quality Lead" : "SEO/AEO/GEO Lead",
      classification: "manual_review",
      automationReadiness: pageType.toLowerCase().includes("podcast") ? "r2_generator_fix" : "manual_review_only",
      evidence: [`pageType: ${pageType}`, `analysed: ${row.analysed ?? "unknown"}`, `failed: ${failed}`, `score: ${averageScore || "unknown"}`],
      requiredOutcome: "Review the family-level evidence and create deterministic source-owner findings for any safe repo or generator changes.",
      verificationMethod: "Rerun SEO/AEO/GEO and compare the page-family row in coverage.json/summary.json.",
    }));
  }

  if (scores.aeo > 0 && scores.aeo < 70) {
    findings.push(makeCouncilFinding({
      id: "SAG-AEO-001",
      title: "AEO readiness remains the weakest search layer",
      severity: scores.aeo < 50 ? "high" : "medium",
      pipeline: PIPELINE,
      sourceType: "seo_aeo_geo_council",
      sourceOwner: "content_architecture",
      councilMember: "Content Architecture Lead",
      classification: "manual_review",
      automationReadiness: "content_strategy_fix",
      evidence: [`AEO score: ${scores.aeo}`],
      requiredOutcome: "Prioritise answer-first summaries, question-led headings, takeaways, internal links and transcript/entity blocks in the weakest page families.",
      verificationMethod: "Rerun SEO/AEO/GEO and confirm AEO score improves without harming SEO/GEO scores.",
    }));
  }
  return findings;
}

function buildFindings(bundle, scores) {
  const direct = candidateLists(bundle)
    .slice(0, 40)
    .map((candidate, index) => mapExistingFinding(candidate, index + 1));
  const aggregate = buildAggregateFindings({ bundle, scores });
  return uniqueBy([...direct, ...aggregate], (finding) => finding.issueId)
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
    .slice(0, 60);
}

function buildCouncilReport({ sessionId, reportPrefix, bundle }) {
  const generatedAt = new Date().toISOString();
  const report = obj(bundle.report);
  const summary = obj(bundle.summary);
  const coverage = obj(bundle.coverage);
  const scores = scoreSnapshot(report, summary, coverage);
  const findings = buildFindings(bundle, scores);
  const codeFixCount = findings.filter((finding) => finding.classification === "code_fix").length;
  const criticalHigh = findings.filter((finding) => ["critical", "high"].includes(finding.severity)).length;
  const sourceReportMap = sourceReports(bundle);
  const sourceErrors = bundle.errors.map((error) => ({ source: "seo-aeo-geo", ...error }));
  const status = criticalHigh ? "Action required before RAMS automation" : findings.length ? "Review before RAMS automation" : "No material search council findings";
  return {
    auditType: AUDIT_TYPE,
    pipeline: PIPELINE,
    sessionId,
    generatedAt,
    reportPrefix,
    cadence: "monthly",
    purpose: "Master SEO/AEO/GEO council report for RAMS planning, source ownership and safe remediation routing.",
    executiveVerdict: {
      status,
      summary: findings.length
        ? `The SEO/AEO/GEO council produced ${findings.length} RAMS-readable finding(s), including ${codeFixCount} deterministic website-owned code-fix candidate(s).`
        : "The source report produced no material council findings for this cycle.",
    },
    ramsPolicy: ramsPolicy(),
    councilMembers: councilMembers(),
    sourceReports: sourceReportMap,
    scores,
    findings,
    decisions: {
      websiteRepo: findings.filter((item) => item.sourceOwner === "website_repo").map((item) => item.title),
      aimsR2: findings.filter((item) => ["aims_r2_blog", "aims_r2_podcast", "transcript_pipeline"].includes(item.sourceOwner)).map((item) => item.title),
      sourceGovernance: findings.filter((item) => item.sourceOwner === "source_governance").map((item) => item.title),
      rams: ["Use this council report as the preferred seo-aeo-geo source. Only patch code_fix findings with exact website-owned affectedPaths and validation commands."],
    },
    coverage: {
      sourceLoaded: sourceReportMap.seoAeoGeo.loaded,
      childArtefactsLoaded: bundle.loaded,
      sourceErrors,
      partial: !bundle.latestLoaded || sourceErrors.length > 0,
    },
  };
}

export function renderSeoAeoGeoCouncilHtml(report) {
  const scores = obj(report.scores);
  return renderCouncilHtml({
    title: "SEO/AEO/GEO Council",
    generatedAt: report.generatedAt,
    verdict: report.executiveVerdict,
    badges: [{ label: "R2 audits bucket", className: "ok" }, { label: "RAMS-readable" }, { label: "deterministic patches only", className: "warn" }],
    metrics: [
      { label: "SEO", value: formatNumber(scores.seo) },
      { label: "AEO", value: formatNumber(scores.aeo) },
      { label: "GEO", value: formatNumber(scores.geo) },
      { label: "Failed URLs", value: formatNumber(scores.failedUrls) },
      { label: "Coverage", value: percentage(scores.coveragePercent) },
      { label: "Findings", value: formatNumber(arr(report.findings).length) },
    ],
    councilMembers: report.councilMembers,
    findings: report.findings,
    coverage: report.coverage,
    ramsPolicy: report.ramsPolicy,
  });
}

export async function runSeoAeoGeoCouncilReport(options = {}) {
  const sessionId = trim(options.sessionId) || newCouncilSessionId("seo-aeo-geo-council");
  const reportPrefix = reportPrefixFor(AUDIT_TYPE, sessionId);
  const bundle = await loadAuditBundle("seo-aeo-geo", SOURCE_LATEST_KEY, {
    children: ["report", "summary", "coverage", "evidence", "repositoryIssueAppendix"],
    optionalChildren: ["report", "evidence", "repositoryIssueAppendix"],
  });
  const report = buildCouncilReport({ sessionId, reportPrefix, bundle });
  const html = renderSeoAeoGeoCouncilHtml(report);
  return publishCouncilReport({ auditType: AUDIT_TYPE, pipeline: PIPELINE, sessionId, reportPrefix, report, html });
}

export function getSeoAeoGeoCouncilStatus() {
  return {
    ok: true,
    auditType: AUDIT_TYPE,
    pipeline: PIPELINE,
    sourceLatestKey: SOURCE_LATEST_KEY,
    output: ["report.html", "report.json", "summary.json", "coverage.json", "repository-issue-appendix.json", "latest.json"],
    councilMembers: councilMembers().map((member) => member.role),
    ramsPolicy: ramsPolicy(),
  };
}

export const __seoAeoGeoCouncilTestHooks = {
  buildCouncilReport,
  renderSeoAeoGeoCouncilHtml,
};

export default runSeoAeoGeoCouncilReport;
