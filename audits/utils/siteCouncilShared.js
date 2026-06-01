import crypto from "node:crypto";
import { buildAuditPrefix } from "./auditPaths.js";
import {
  auditKeyFromPublicUrl,
  publishAuditJson,
  publishAuditLatest,
  publishAuditText,
  readAuditJson,
} from "./publishAuditArtifacts.js";

export function trim(value) {
  return String(value ?? "").trim();
}

export function arr(value) {
  return Array.isArray(value) ? value : [];
}

export function obj(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function clampScore(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

export function firstText(...values) {
  for (const value of values) {
    const text = trim(value);
    if (text) return text;
  }
  return "";
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatNumber(value) {
  return new Intl.NumberFormat("en-GB").format(toNumber(value));
}

export function percentage(value) {
  return `${toNumber(value).toFixed(2)}%`;
}

export function normaliseSeverity(value, fallback = "medium") {
  const text = trim(value).toLowerCase();
  return ["critical", "high", "medium", "low"].includes(text) ? text : fallback;
}

export function severityRank(value) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[normaliseSeverity(value)] ?? 4;
}

export function slug(value) {
  return trim(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

export function uniqueBy(items, getKey) {
  const seen = new Set();
  const output = [];
  for (const item of arr(items)) {
    const key = getKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

export function isR2PodcastEpisodePath(path) {
  const cleaned = trim(path).replace(/\\/g, "/").replace(/^\.?\/+/, "");
  return cleaned === "podcast/episodes" || cleaned.startsWith("podcast/episodes/");
}

export function isWebsiteRepoPath(path) {
  const text = trim(path).replace(/\\/g, "/");
  if (!text || /^https?:\/\//i.test(text)) return false;
  if (text.includes("..")) return false;
  return !isR2PodcastEpisodePath(text);
}

export function normalisePathList(value) {
  return arr(value)
    .map((item) => trim(item).replace(/\\/g, "/").replace(/^\.?\/+/, ""))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}

export async function readJsonIfPresent(key) {
  try {
    return { ok: true, key, value: await readAuditJson({ key }) };
  } catch (error) {
    return { ok: false, key, error: error?.message || String(error), value: null };
  }
}

export async function readUrlIfPresent(url) {
  const key = auditKeyFromPublicUrl(url);
  if (!key) return { ok: false, key: "", error: "missing or unsupported URL", value: null };
  return readJsonIfPresent(key);
}

function artefactUrlFromLatest(latest, field, fallbackName) {
  if (trim(latest?.[field])) return trim(latest[field]);
  const artefacts = obj(latest?.artefacts);
  if (trim(artefacts[fallbackName])) return trim(artefacts[fallbackName]);
  return "";
}

export async function loadAuditBundle(label, latestKey) {
  const latestResult = await readJsonIfPresent(latestKey);
  const latest = obj(latestResult.value);
  const childRequests = [
    ["report", artefactUrlFromLatest(latest, "reportJsonUrl", "report.json")],
    ["summary", artefactUrlFromLatest(latest, "summaryUrl", "summary.json")],
    ["coverage", artefactUrlFromLatest(latest, "coverageUrl", "coverage.json")],
    ["evidence", artefactUrlFromLatest(latest, "evidenceUrl", "evidence.json")],
    ["repositoryIssueAppendix", artefactUrlFromLatest(latest, "repositoryIssueAppendixUrl", "repository-issue-appendix.json")],
    ["mandatoryMobileScorecard", artefactUrlFromLatest(latest, "mandatoryMobileScorecardUrl", "mandatory-mobile-scorecard.json")],
    ["responsiveFixAppendix", artefactUrlFromLatest(latest, "responsiveFixAppendixUrl", "responsive-fix-appendix.json")],
  ];
  const childResults = await Promise.all(
    childRequests.map(async ([childLabel, url]) => {
      if (!url) return [childLabel, { ok: false, key: "", error: `missing ${childLabel} URL`, value: null }];
      return [childLabel, await readUrlIfPresent(url)];
    })
  );
  const children = Object.fromEntries(childResults.map(([childLabel, result]) => [childLabel, obj(result.value)]));
  const loaded = Object.fromEntries(childResults.map(([childLabel, result]) => [childLabel, result.ok]));
  const errors = [latestResult, ...childResults.map(([, result]) => result)]
    .filter((item) => !item.ok)
    .map((item) => ({ key: item.key, error: item.error }));
  return {
    label,
    latestKey,
    latestLoaded: latestResult.ok,
    latest,
    ...children,
    loaded,
    errors,
  };
}

export function makeCouncilFinding({
  id,
  title,
  severity = "medium",
  pipeline,
  sourceType,
  sourceOwner = "manual_review",
  councilMember = "Automation Safety Lead",
  classification = "manual_review",
  status,
  automationReadiness = "manual_review_only",
  fixClass = "",
  allowedFixClass = "",
  affectedPaths = [],
  evidence = [],
  requiredOutcome = "Review this council finding and rerun the relevant audit after remediation.",
  verificationMethod = "Rerun the source audit and council report, then confirm this finding is resolved.",
  confidence = 0.86,
}) {
  const safeClassification = ["code_fix", "future_guidance", "manual_review", "skipped"].includes(trim(classification))
    ? trim(classification)
    : "manual_review";
  const paths = normalisePathList(affectedPaths);
  const deterministicWebsitePatch = safeClassification === "code_fix"
    && paths.length > 0
    && paths.every(isWebsiteRepoPath)
    && Boolean(trim(allowedFixClass || fixClass));
  return {
    issueId: id,
    findingId: id,
    title,
    issueType: title,
    severity: normaliseSeverity(severity),
    confidence: Number.isFinite(Number(confidence)) ? Math.max(0, Math.min(1, Number(confidence))) : 0.86,
    classification: deterministicWebsitePatch ? "code_fix" : safeClassification === "code_fix" ? "manual_review" : safeClassification,
    status: status || (deterministicWebsitePatch ? "pending" : safeClassification === "future_guidance" ? "future_guidance" : "manual_review"),
    sourceType,
    sourceOwner,
    councilMember,
    automationReadiness: deterministicWebsitePatch ? "auto_patch_ready" : automationReadiness,
    fixClass: fixClass || allowedFixClass || "",
    allowedFixClass: deterministicWebsitePatch ? (allowedFixClass || fixClass) : "",
    affectedPaths: paths,
    evidence: arr(evidence).map(String).filter(Boolean).slice(0, 12),
    exactEvidence: arr(evidence).map(String).filter(Boolean).join("; "),
    requiredOutcome,
    exactRemediation: requiredOutcome,
    verificationMethod,
    ramsPolicy: {
      patchAllowed: deterministicWebsitePatch,
      requiresDeterministicEvidence: true,
      reason: deterministicWebsitePatch
        ? "Council finding includes exact website-owned affectedPaths and an approved fix class."
        : "Council finding is manual review or future guidance unless deterministic website-owned file evidence is present.",
    },
  };
}

export function ramsCouncilPolicy({ councilType, defaultClassification = "manual_review", codePatchAllowed = "deterministic_website_repo_only" } = {}) {
  return {
    ramsReadable: true,
    shouldTriggerRams: false,
    codePatchAllowed,
    defaultClassification,
    requiresDeterministicEvidence: true,
    councilType,
    reason: "Council reports are RAMS master inputs. RAMS may only patch findings that include exact website-owned files, deterministic evidence, an approved fix class and validation requirements.",
  };
}

function severityBadge(severity) {
  const value = normaliseSeverity(severity);
  const cls = value === "critical" || value === "high" ? "bad" : value === "medium" ? "warn" : "ok";
  return `<span class="pill ${cls}">${escapeHtml(value)}</span>`;
}

export function renderFindingCards(findings = []) {
  if (!arr(findings).length) return "<p>No material council findings were generated.</p>";
  return arr(findings).map((finding) => `<article class="finding"><h3>${escapeHtml(finding.issueId)} · ${escapeHtml(finding.title)}</h3><p>${severityBadge(finding.severity)} <span class="pill">${escapeHtml(finding.councilMember)}</span> <span class="pill">${escapeHtml(finding.sourceOwner)}</span> <span class="pill">${escapeHtml(finding.classification)}</span> <span class="pill">${escapeHtml(finding.automationReadiness)}</span></p><p><strong>Evidence:</strong> ${escapeHtml(arr(finding.evidence).join(" | "))}</p><p><strong>Outcome:</strong> ${escapeHtml(finding.requiredOutcome)}</p><p><strong>Verification:</strong> ${escapeHtml(finding.verificationMethod)}</p></article>`).join("\n");
}

export function renderCouncilHtml({ title, generatedAt, verdict, badges = [], metrics = [], councilMembers = [], findings = [], coverage = {}, ramsPolicy = {} }) {
  const metricCards = metrics.map((metric) => `<div class="kpi"><span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(metric.value)}</strong></div>`).join("\n");
  const memberRows = councilMembers.map((member) => `<tr><td>${escapeHtml(member.role)}</td><td>${escapeHtml(member.remit)}</td></tr>`).join("\n");
  const badgeHtml = badges.map((badge) => `<span class="pill ${escapeHtml(badge.className || "")}">${escapeHtml(badge.label || badge)}</span>`).join(" ");
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;margin:0;background:#f4f7fb;color:#111827;line-height:1.55}header{background:#0d1420;color:#fff;padding:30px 24px}main{max-width:1180px;margin:0 auto;padding:32px 20px 64px}section,.finding{background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:22px;margin:18px 0;box-shadow:0 12px 30px rgba(13,20,32,.06)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px}.kpi{background:#0d1420;color:#fff;border-radius:16px;padding:16px}.kpi strong{font-size:24px;display:block}.kpi span{color:#cbd5e1}.pill{display:inline-block;border-radius:999px;padding:5px 10px;background:#eef2ff;color:#4338ca;font-weight:700;font-size:12px;margin:0 4px 4px 0}.ok{background:#dcfce7;color:#166534}.warn{background:#fef3c7;color:#92400e}.bad{background:#fee2e2;color:#991b1b}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid #e5e7eb;padding:9px 7px;text-align:left;vertical-align:top}th{background:#f8fafc}pre{white-space:pre-wrap;word-break:break-word;background:#f3f4f6;border-radius:12px;padding:14px;font-size:12px}@media print{section,.finding{break-inside:avoid;page-break-inside:avoid}}
</style>
</head>
<body>
<header><h1>${escapeHtml(title)}</h1><p>Generated ${escapeHtml(generatedAt)} · ${escapeHtml(verdict?.status || "Council review")}</p></header>
<main>
<section><h2>Executive verdict</h2><p>${escapeHtml(verdict?.summary || "Council report generated.")}</p><p>${badgeHtml}</p></section>
<section><h2>Score snapshot</h2><div class="grid">${metricCards}</div></section>
<section><h2>Council members</h2><table><thead><tr><th>Role</th><th>Remit</th></tr></thead><tbody>${memberRows}</tbody></table></section>
<section><h2>RAMS policy</h2><p>${escapeHtml(ramsPolicy.reason)}</p><pre>${escapeHtml(JSON.stringify(ramsPolicy, null, 2))}</pre></section>
<section><h2>RAMS-readable findings</h2>${renderFindingCards(findings)}</section>
<section><h2>Source coverage</h2><pre>${escapeHtml(JSON.stringify(coverage, null, 2))}</pre></section>
</main>
</body>
</html>`;
}

export function repositoryIssueAppendix({ auditType, pipeline, sessionId, generatedAt, ramsPolicy, findings }) {
  return {
    auditType,
    pipeline,
    sessionId,
    generatedAt,
    ramsPolicy,
    findings: arr(findings),
  };
}

export async function publishCouncilReport({ auditType, pipeline, sessionId, reportPrefix, report, html }) {
  const appendix = repositoryIssueAppendix({
    auditType,
    pipeline,
    sessionId,
    generatedAt: report.generatedAt,
    ramsPolicy: report.ramsPolicy,
    findings: report.findings,
  });
  const summary = {
    auditType,
    pipeline,
    sessionId,
    generatedAt: report.generatedAt,
    executiveVerdict: report.executiveVerdict,
    scores: report.scores,
    findingCount: arr(report.findings).length,
    codeFixCount: arr(report.findings).filter((finding) => finding.classification === "code_fix").length,
    manualReviewCount: arr(report.findings).filter((finding) => finding.classification === "manual_review").length,
    futureGuidanceCount: arr(report.findings).filter((finding) => finding.classification === "future_guidance").length,
    ramsPolicy: report.ramsPolicy,
    sourceReports: report.sourceReports,
  };
  const coverage = {
    auditType,
    pipeline,
    sessionId,
    generatedAt: report.generatedAt,
    sourceReports: report.sourceReports,
    coverage: report.coverage,
    councilMembers: arr(report.councilMembers).map((member) => member.role),
  };

  const [reportJson, summaryJson, coverageJson, appendixJson, reportHtml] = await Promise.all([
    publishAuditJson({ key: `${reportPrefix}/report.json`, payload: report }),
    publishAuditJson({ key: `${reportPrefix}/summary.json`, payload: summary }),
    publishAuditJson({ key: `${reportPrefix}/coverage.json`, payload: coverage }),
    publishAuditJson({ key: `${reportPrefix}/repository-issue-appendix.json`, payload: appendix }),
    publishAuditText({ key: `${reportPrefix}/report.html`, text: html, contentType: "text/html; charset=utf-8" }),
  ]);

  const latest = await publishAuditLatest({
    auditType,
    sessionId,
    payload: {
      reportPrefix,
      reportUrl: reportHtml.url,
      reportJsonUrl: reportJson.url,
      summaryUrl: summaryJson.url,
      coverageUrl: coverageJson.url,
      repositoryIssueAppendixUrl: appendixJson.url,
      sourceReports: report.sourceReports,
      executiveVerdict: report.executiveVerdict,
      findingCount: arr(report.findings).length,
      codeFixCount: summary.codeFixCount,
      manualReviewCount: summary.manualReviewCount,
      futureGuidanceCount: summary.futureGuidanceCount,
      ramsPolicy: report.ramsPolicy,
    },
  });

  return {
    ok: true,
    auditType,
    pipeline,
    sessionId,
    reportPrefix,
    reportUrl: reportHtml.url,
    reportJsonUrl: reportJson.url,
    summaryUrl: summaryJson.url,
    coverageUrl: coverageJson.url,
    repositoryIssueAppendixUrl: appendixJson.url,
    latestUrl: latest.url,
    findingCount: arr(report.findings).length,
    codeFixCount: summary.codeFixCount,
    manualReviewCount: summary.manualReviewCount,
    futureGuidanceCount: summary.futureGuidanceCount,
    ramsPolicy: report.ramsPolicy,
  };
}

export function newCouncilSessionId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function reportPrefixFor(auditType, sessionId) {
  return buildAuditPrefix(auditType, sessionId);
}
