import {
  arr,
  firstText,
  formatNumber,
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

const AUDIT_TYPE = "mobile-ux-council";
const PIPELINE = "mobile-ux";
const SOURCE_LATEST_KEY = "audits/mobile-ux/latest.json";

function councilMembers() {
  return [
    { role: "Mobile UX Lead", remit: "Release verdict, mobile quality score, P0/P1 blocker themes and user journey risk." },
    { role: "CSS & Responsive Systems Lead", remit: "Shared CSS, grids, overflow, breakpoints, typography and image responsiveness." },
    { role: "Navigation & Interaction Lead", remit: "Hamburger menu, mobile drawer, overlay, escape/outside click behaviour and resize reset." },
    { role: "Accessibility Lead", remit: "Phase 5C WCAG evidence, focus order, labels, accessible names and keyboard behaviour." },
    { role: "Conversion Journey Lead", remit: "CTA continuity, touch targets, buy/newsletter/contact paths and conversion friction." },
    { role: "Visual Evidence & Screenshot Lead", remit: "Screenshot evidence quality, viewport recurrence and before/after verification assets." },
    { role: "Performance & Asset Efficiency Lead", remit: "Image and media sizing, avoidable layout weight and mobile asset behaviour where the hard gate exposes it." },
    { role: "QA Regression Lead", remit: "Validation commands, repeated MUX group tracking and rerun requirements before release." },
    { role: "Automation Safety Lead", remit: "RAMS patch safety, protected paths, source ownership and PR-gated remediation." },
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
    mobileUx: {
      latestKey: SOURCE_LATEST_KEY,
      loaded: bundle.latestLoaded,
      reportPrefix: bundle.latest.reportPrefix || null,
      reportUrl: bundle.latest.reportUrl || null,
      reportJsonUrl: bundle.latest.reportJsonUrl || null,
      summaryUrl: bundle.latest.summaryUrl || null,
      coverageUrl: bundle.latest.coverageUrl || null,
      repositoryIssueAppendixUrl: bundle.latest.repositoryIssueAppendixUrl || null,
      mandatoryMobileScorecardUrl: bundle.latest.mandatoryMobileScorecardUrl || null,
      responsiveFixAppendixUrl: bundle.latest.responsiveFixAppendixUrl || null,
      errors: bundle.errors,
    },
  };
}

function scoreSnapshot(report, summary, coverage, latest) {
  return {
    mobileQualityScore: toNumber(report.mobileQualityScore ?? summary.mobileQualityScore ?? latest.mobileQualityScore),
    releaseVerdict: firstText(report.releaseVerdict, summary.releaseVerdict, latest.releaseVerdict, report.commercialDecision, "unknown"),
    renderedUrls: toNumber(report.renderedUrlsChecked ?? report.renderedMobileUrlsChecked ?? summary.renderedUrlsChecked ?? coverage.renderedUrlsChecked),
    viewportRuns: toNumber(report.viewportRuns ?? summary.viewportRuns ?? coverage.viewportRuns),
    failingRecords: toNumber(report.failingViewportRecords ?? report.mobileFailureCount ?? summary.mobileFailureCount ?? latest.mobileFailureCount),
    issueCount: toNumber(report.issueCount ?? summary.issueCount ?? latest.issueCount),
    p0Groups: toNumber(report.p0TechnicalGroups ?? summary.p0TechnicalGroups ?? latest.p0TechnicalGroups),
    p1Groups: toNumber(report.p1TechnicalGroups ?? summary.p1TechnicalGroups ?? latest.p1TechnicalGroups),
    screenshotCount: toNumber(latest.screenshotCount ?? report.screenshotCount ?? summary.screenshotCount),
  };
}

function pathsFromCandidate(candidate, check, text) {
  const explicit = normalisePathList(candidate.affectedPaths);
  if (explicit.length) return explicit;
  const source = firstText(candidate.bestAvailableAnchor, candidate.selectorComponentCodeAnchor, candidate.anchor, candidate.source, candidate.filePathOrUrl, candidate.path);
  if (source && !/^https?:\/\//i.test(source) && source.includes("/")) return normalisePathList([source]);
  const haystack = `${check} ${text}`.toLowerCase();
  if (haystack.includes("hamburger") || haystack.includes("mobile nav") || haystack.includes("jh-mobile-nav") || haystack.includes("header")) return ["assets/partials/header.html", "assets/css/site.css", "assets/js/site-ui.min.js"];
  if (haystack.includes("overflow") || haystack.includes("responsive") || haystack.includes("typography") || haystack.includes("image") || haystack.includes("touch target")) return ["assets/css/site.css"];
  return [];
}

function fixClassFor(check, text, paths) {
  const haystack = `${check} ${text}`.toLowerCase();
  if (haystack.includes("accessibility") || haystack.includes("wcag") || haystack.includes("aria") || haystack.includes("keyboard") || haystack.includes("focus")) return "accessibility_fix";
  if (paths.some((path) => path.endsWith(".css"))) return "css_fix";
  if (paths.some((path) => path.includes("partials/"))) return "partial_fix";
  if (paths.some((path) => path.endsWith(".html"))) return "html_fix";
  if (haystack.includes("viewport")) return "viewport_fix";
  return "";
}

function councilMemberFor(check, text) {
  const haystack = `${check} ${text}`.toLowerCase();
  if (haystack.includes("hamburger") || haystack.includes("mobile nav") || haystack.includes("menu")) return "Navigation & Interaction Lead";
  if (haystack.includes("accessibility") || haystack.includes("wcag") || haystack.includes("aria")) return "Accessibility Lead";
  if (haystack.includes("cta") || haystack.includes("touch target") || haystack.includes("conversion")) return "Conversion Journey Lead";
  if (haystack.includes("screenshot")) return "Visual Evidence & Screenshot Lead";
  if (haystack.includes("image") || haystack.includes("asset")) return "Performance & Asset Efficiency Lead";
  if (haystack.includes("overflow") || haystack.includes("responsive") || haystack.includes("typography") || haystack.includes("breakpoint")) return "CSS & Responsive Systems Lead";
  return "Mobile UX Lead";
}

function mapExistingFinding(candidate, index) {
  const check = firstText(candidate.check, candidate.metric, candidate.issueType, candidate.title, candidate.groupTitle, "mobile UX");
  const title = firstText(candidate.title, candidate.groupTitle, candidate.issueType, `Mobile UX finding ${index}`);
  const remediation = firstText(candidate.requiredOutcome, candidate.exactRemediation, candidate.remediation, candidate.recommendation, candidate.acceptanceCriteria);
  const description = firstText(candidate.description, candidate.defectDescription, candidate.consequence, candidate.executiveConsequence);
  const text = [title, remediation, description, ...arr(candidate.evidence)].join(" ");
  const paths = pathsFromCandidate(candidate, check, text);
  const fixClass = firstText(candidate.allowedFixClass, candidate.fixClass, candidate.fix_class) || fixClassFor(check, text, paths);
  const deterministic = paths.length > 0 && paths.every(isWebsiteRepoPath) && Boolean(fixClass) && Boolean(remediation || description);
  const evidence = [
    ...arr(candidate.evidence).map(String),
    firstText(candidate.route) ? `route: ${firstText(candidate.route)}` : "",
    firstText(candidate.viewport) ? `viewport: ${firstText(candidate.viewport)}` : "",
    firstText(candidate.screenshotRefs) ? `screenshotRefs: ${firstText(candidate.screenshotRefs)}` : "",
    firstText(candidate.selectorComponentCodeAnchor, candidate.bestAvailableAnchor) ? `anchor: ${firstText(candidate.selectorComponentCodeAnchor, candidate.bestAvailableAnchor)}` : "",
  ].filter(Boolean);
  return makeCouncilFinding({
    id: firstText(candidate.issueId, candidate.findingId, candidate.id, candidate.groupId) || `MUXC-${String(index).padStart(3, "0")}`,
    title,
    severity: candidate.severity || (text.toLowerCase().includes("p0") ? "critical" : "medium"),
    pipeline: PIPELINE,
    sourceType: "mobile_ux_council",
    sourceOwner: deterministic ? "website_repo" : "manual_review",
    councilMember: councilMemberFor(check, text),
    classification: deterministic ? "code_fix" : "manual_review",
    automationReadiness: deterministic ? "auto_patch_ready" : "manual_review_only",
    fixClass,
    allowedFixClass: deterministic ? fixClass : "",
    affectedPaths: paths,
    evidence,
    requiredOutcome: remediation || description || "Review this Mobile UX issue and create a deterministic source-level remediation.",
    verificationMethod: firstText(candidate.verificationMethod) || "Rerun the Mobile UX hard-gate and confirm the same route, viewport and check passes with superseding screenshots.",
    confidence: candidate.confidence ?? 0.9,
  });
}

function candidateLists(bundle) {
  const report = obj(bundle.report);
  const summary = obj(bundle.summary);
  const appendix = obj(bundle.repositoryIssueAppendix);
  const responsive = obj(bundle.responsiveFixAppendix);
  const scorecard = obj(bundle.mandatoryMobileScorecard);
  return [
    ...arr(appendix.findings),
    ...arr(appendix.issues),
    ...arr(appendix.rows),
    ...arr(responsive.findings),
    ...arr(responsive.issues),
    ...arr(responsive.rows),
    ...arr(scorecard.findings),
    ...arr(scorecard.issues),
    ...arr(report.findings),
    ...arr(report.issues),
    ...arr(report.technicalRootCauseGroups),
    ...arr(report.rootCauseGroups),
    ...arr(report.executiveBlockerThemes),
    ...arr(summary.findings),
    ...arr(summary.issues),
  ].filter((item) => item && typeof item === "object" && !Array.isArray(item));
}

function executiveThemes(bundle) {
  const report = obj(bundle.report);
  const summary = obj(bundle.summary);
  return [
    ...arr(report.executiveBlockerThemes),
    ...arr(report.blockerThemes),
    ...arr(summary.executiveBlockerThemes),
    ...arr(summary.blockerThemes),
  ].filter((item) => item && typeof item === "object" && !Array.isArray(item));
}

function buildAggregateFindings({ bundle, scores }) {
  const findings = [];
  if (trim(scores.releaseVerdict).toLowerCase().includes("block") || scores.p0Groups > 0) {
    findings.push(makeCouncilFinding({
      id: "MUXC-RELEASE-001",
      title: "Mobile UX release remains blocked",
      severity: "critical",
      pipeline: PIPELINE,
      sourceType: "mobile_ux_council",
      sourceOwner: "manual_review",
      councilMember: "Mobile UX Lead",
      classification: "manual_review",
      automationReadiness: "manual_review_only",
      evidence: [`releaseVerdict: ${scores.releaseVerdict}`, `mobileQualityScore: ${scores.mobileQualityScore}`, `P0 groups: ${scores.p0Groups}`],
      requiredOutcome: "Resolve P0 Mobile UX groups before considering the site release-ready. Only deterministic website-owned findings should be handed to RAMS as code fixes.",
      verificationMethod: "Rerun the Mobile UX hard-gate and confirm release verdict is no longer BLOCKED and P0 group count is zero.",
    }));
  }
  for (const [index, theme] of executiveThemes(bundle).slice(0, 8).entries()) {
    const title = firstText(theme.title, theme.theme, theme.name, `Mobile UX blocker theme ${index + 1}`);
    const text = [title, theme.executiveConsequence, theme.remediationProgramme, theme.metrics].join(" ");
    const paths = pathsFromCandidate(theme, firstText(theme.metrics), text);
    const fixClass = fixClassFor(firstText(theme.metrics), text, paths);
    findings.push(makeCouncilFinding({
      id: firstText(theme.themeId, theme.id, theme.groupId) || `MUXC-THEME-${String(index + 1).padStart(3, "0")}`,
      title,
      severity: String(theme.severity || "medium").toUpperCase() === "P0" ? "critical" : String(theme.severity || "medium").toUpperCase() === "P1" ? "high" : theme.severity || "medium",
      pipeline: PIPELINE,
      sourceType: "mobile_ux_council",
      sourceOwner: paths.length ? "website_repo" : "manual_review",
      councilMember: councilMemberFor(firstText(theme.metrics), text),
      classification: paths.length && fixClass ? "code_fix" : "manual_review",
      automationReadiness: paths.length && fixClass ? "auto_patch_ready" : "manual_review_only",
      fixClass,
      allowedFixClass: paths.length && fixClass ? fixClass : "",
      affectedPaths: paths,
      evidence: [`metrics: ${firstText(theme.metrics)}`, `urls: ${theme.urls ?? "unknown"}`, `viewportRange: ${firstText(theme.viewportRange)}`, `technicalGroups: ${theme.technicalGroups ?? "unknown"}`],
      requiredOutcome: firstText(theme.remediationProgramme, "Resolve this systemic Mobile UX blocker and verify it with a fresh rendered audit."),
      verificationMethod: "Rerun the Mobile UX hard-gate and confirm the blocker theme no longer appears in executive blocker themes.",
    }));
  }
  return findings;
}

function buildFindings(bundle, scores) {
  const direct = candidateLists(bundle)
    .slice(0, 50)
    .map((candidate, index) => mapExistingFinding(candidate, index + 1));
  const aggregate = buildAggregateFindings({ bundle, scores });
  return uniqueBy([...direct, ...aggregate], (finding) => finding.issueId)
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
    .slice(0, 70);
}

function buildCouncilReport({ sessionId, reportPrefix, bundle }) {
  const generatedAt = new Date().toISOString();
  const scores = scoreSnapshot(obj(bundle.report), obj(bundle.summary), obj(bundle.coverage), obj(bundle.latest));
  const findings = buildFindings(bundle, scores);
  const codeFixCount = findings.filter((finding) => finding.classification === "code_fix").length;
  const criticalHigh = findings.filter((finding) => ["critical", "high"].includes(finding.severity)).length;
  const sourceReportMap = sourceReports(bundle);
  const sourceErrors = bundle.errors.map((error) => ({ source: "mobile-ux", ...error }));
  const status = criticalHigh ? "Action required before mobile release" : findings.length ? "Review before RAMS automation" : "No material Mobile UX council findings";
  return {
    auditType: AUDIT_TYPE,
    pipeline: PIPELINE,
    sessionId,
    generatedAt,
    reportPrefix,
    cadence: "monthly",
    purpose: "Master Mobile UX council report for RAMS planning, source ownership and safe responsive remediation routing.",
    executiveVerdict: {
      status,
      summary: findings.length
        ? `The Mobile UX council produced ${findings.length} RAMS-readable finding(s), including ${codeFixCount} deterministic website-owned code-fix candidate(s).`
        : "The source report produced no material Mobile UX council findings for this cycle.",
    },
    ramsPolicy: ramsPolicy(),
    councilMembers: councilMembers(),
    sourceReports: sourceReportMap,
    scores,
    findings,
    decisions: {
      websiteRepo: findings.filter((item) => item.sourceOwner === "website_repo").map((item) => item.title),
      manualReview: findings.filter((item) => item.sourceOwner === "manual_review").map((item) => item.title),
      rams: ["Use this council report as the preferred mobile-ux source. Patch only code_fix findings with exact website-owned affectedPaths and validation commands."],
    },
    coverage: {
      sourceLoaded: sourceReportMap.mobileUx.loaded,
      childArtefactsLoaded: bundle.loaded,
      sourceErrors,
      partial: !bundle.latestLoaded || sourceErrors.length > 0,
    },
  };
}

export function renderMobileUxCouncilHtml(report) {
  const scores = obj(report.scores);
  return renderCouncilHtml({
    title: "Mobile UX Council",
    generatedAt: report.generatedAt,
    verdict: report.executiveVerdict,
    badges: [{ label: "R2 audits bucket", className: "ok" }, { label: "RAMS-readable" }, { label: "PR-gated remediation", className: "warn" }],
    metrics: [
      { label: "Mobile score", value: formatNumber(scores.mobileQualityScore) },
      { label: "Verdict", value: scores.releaseVerdict },
      { label: "P0 groups", value: formatNumber(scores.p0Groups) },
      { label: "P1 groups", value: formatNumber(scores.p1Groups) },
      { label: "Failing records", value: formatNumber(scores.failingRecords) },
      { label: "Findings", value: formatNumber(arr(report.findings).length) },
    ],
    councilMembers: report.councilMembers,
    findings: report.findings,
    coverage: report.coverage,
    ramsPolicy: report.ramsPolicy,
  });
}

export async function runMobileUxCouncilReport(options = {}) {
  const sessionId = trim(options.sessionId) || newCouncilSessionId("mobile-ux-council");
  const reportPrefix = reportPrefixFor(AUDIT_TYPE, sessionId);
  const bundle = await loadAuditBundle("mobile-ux", SOURCE_LATEST_KEY);
  const report = buildCouncilReport({ sessionId, reportPrefix, bundle });
  const html = renderMobileUxCouncilHtml(report);
  return publishCouncilReport({ auditType: AUDIT_TYPE, pipeline: PIPELINE, sessionId, reportPrefix, report, html });
}

export function getMobileUxCouncilStatus() {
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

export const __mobileUxCouncilTestHooks = {
  buildCouncilReport,
  renderMobileUxCouncilHtml,
};

export default runMobileUxCouncilReport;
