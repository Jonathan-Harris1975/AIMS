import crypto from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { buildAuditPrefix, buildLatestKey } from "./auditPaths.js";
import { publishAuditJson, publishAuditText } from "./publishAuditArtifacts.js";
import { collectPodcastTranscriptEvidence } from "./onBrandEvidence.js";
import {
  AIMS_AUDIT_SKILL_LENSES,
  buildEpisodeSkillLensFindings,
  buildSkillLensSummary,
  buildTranscriptSkillLensFindings,
} from "./seoGeoSkillLenses.js";
import * as r2Client from "../../services/shared/utils/r2-client.js";
import { info } from "../../logger.js";
import { fetchWithTimeout } from "../../services/shared/http-client.js";

const EPISODE_AUDIT_TYPE = "podcast-episode";
const TRANSCRIPT_AUDIT_TYPE = "podcast-transcript";
const PIPELINE = "on-brand";
const DEFAULT_LOOKBACK_DAYS = 31;
const DEFAULT_MAX_ITEMS = 12;

function nowIso() {
  return new Date().toISOString();
}

function trim(value) {
  return String(value ?? "").trim();
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function obj(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cleanText(value = "") {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function words(value = "") {
  return cleanText(value).split(/\s+/).filter(Boolean);
}

function clampScore(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function scoreFromFindingCount({ critical = 0, high = 0, medium = 0, low = 0 } = {}) {
  return clampScore(100 - critical * 30 - high * 16 - medium * 8 - low * 3, 60);
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(trim(value));
}

function joinUrl(base, path) {
  return `${trim(base).replace(/\/+$/, "")}/${trim(path).replace(/^\/+/, "")}`;
}

function firstText(...values) {
  for (const value of values) {
    const text = trim(value);
    if (text) return text;
  }
  return "";
}

function toDate(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? null : date;
}

function inLookback(value, lookbackDays) {
  const date = toDate(value);
  if (!date) return true;
  return Date.now() - date.getTime() <= Number(lookbackDays || DEFAULT_LOOKBACK_DAYS) * 86400000;
}

function envUrl(...keys) {
  for (const key of keys) {
    const value = trim(process.env[key]);
    if (isHttpUrl(value)) return value;
  }
  return "";
}

function sourceOwnerPolicy(sourceOwner) {
  return {
    ramsReadable: true,
    pipeline: PIPELINE,
    sourceOwner,
    codePatchAllowed: false,
    defaultClassification: "manual_review",
    requiresGeneratorEvidence: true,
    reason: "Podcast episode and transcript pages are AIMS/R2-owned generated content. RAMS may read these findings for planning, but must not patch website static files from this report.",
  };
}

function makeFinding({
  id,
  title,
  severity = "medium",
  sourceOwner,
  evidence = [],
  requiredOutcome,
  verificationMethod,
  sourceType,
  itemTitleOrId = "",
  classification = "manual_review",
  automationReadiness = "generator_review",
}) {
  const safeClassification = classification === "future_guidance" ? "future_guidance" : "manual_review";
  return {
    issueId: id,
    findingId: id,
    title,
    issueType: title,
    severity: ["critical", "high", "medium", "low"].includes(String(severity).toLowerCase()) ? String(severity).toLowerCase() : "medium",
    confidence: 0.88,
    classification: safeClassification,
    status: safeClassification,
    sourceAudit: sourceType,
    sourceType,
    sourceOwner,
    itemTitleOrId,
    councilMember: sourceOwner === "podcast_transcript_pipeline" ? "Podcast Transcript Report" : "Podcast Episode Report",
    automationReadiness,
    fixClass: "future_guidance",
    allowedFixClass: "",
    affectedPaths: [],
    evidence: arr(evidence).map(String).filter(Boolean).slice(0, 12),
    exactEvidence: arr(evidence).map(String).filter(Boolean).join("; "),
    requiredOutcome: requiredOutcome || "Review the AIMS/R2 generator evidence and apply the smallest safe future-output improvement.",
    exactRemediation: requiredOutcome || "Use this finding as future AIMS/R2 generator QA guidance.",
    verificationMethod: verificationMethod || "Generate fresh podcast output and rerun this report.",
    ramsPolicy: sourceOwnerPolicy(sourceOwner),
  };
}

function descriptionToText(value) {
  if (typeof value === "string") return cleanText(value);
  return cleanText(value?.__cdata || value?.["#text"] || value || "");
}

function normaliseGuid(value) {
  if (typeof value === "object" && value) return cleanText(value["#text"] || value._ || "");
  return cleanText(value || "");
}

function normaliseTranscriptNode(value) {
  if (!value) return { url: "", type: "" };
  const node = Array.isArray(value) ? value[0] : value;
  if (typeof node === "string") return { url: node, type: "" };
  return {
    url: trim(node?.["@_url"] || node?.url || node?.["#text"] || ""),
    type: trim(node?.["@_type"] || node?.type || ""),
  };
}

function normaliseEpisodeItem(item = {}, index = 0) {
  const title = cleanText(item.title || item["itunes:title"] || `Podcast episode ${index + 1}`);
  const description = descriptionToText(item.description || item.summary || item["itunes:summary"] || "");
  const link = cleanText(item.link || item.guid?.["#text"] || "");
  const transcript = normaliseTranscriptNode(item["podcast:transcript"] || item.transcript);
  const enclosure = obj(item.enclosure);
  const enclosureUrl = trim(enclosure["@_url"] || enclosure.url || "");
  return {
    title,
    description,
    link,
    guid: normaliseGuid(item.guid),
    pubDate: cleanText(item.pubDate || item.published || ""),
    enclosureUrl,
    transcriptUrl: transcript.url,
    transcriptType: transcript.type,
    duration: cleanText(item["itunes:duration"] || item.duration || ""),
    raw: item,
  };
}

async function readPodcastRssXml() {
  const attempts = [];
  try {
    const xml = await r2Client.getObjectAsText("podcastRss", "feed.xml");
    return { xml, method: "R2 podcastRss/feed.xml", feedUrl: r2Client.buildPublicUrl("podcastRss", "feed.xml"), attempts };
  } catch (error) {
    attempts.push(`R2 podcastRss/feed.xml failed: ${error?.message || error}`);
  }

  const configured = envUrl("PODCAST_RSS_FEED_URL", "R2_PUBLIC_BASE_URL_PODCAST_RSS");
  const feedUrl = configured && /\.xml($|[?#])/i.test(configured) ? configured : configured ? joinUrl(configured, "feed.xml") : "";
  if (!feedUrl) throw new Error(`No podcast RSS feed URL configured. ${attempts.join(" | ")}`);
  const response = await fetchWithTimeout(feedUrl);
  if (!response.ok) throw new Error(`Podcast RSS public fetch failed with ${response.status}. ${attempts.join(" | ")}`);
  return { xml: await response.text(), method: "public podcast RSS fetch", feedUrl, attempts };
}

async function collectPodcastEpisodeEvidence({ lookbackDays = DEFAULT_LOOKBACK_DAYS, maxItems = DEFAULT_MAX_ITEMS } = {}) {
  try {
    const loaded = await readPodcastRssXml();
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(loaded.xml);
    const rawItems = parsed?.rss?.channel?.item || [];
    const items = (Array.isArray(rawItems) ? rawItems : [rawItems])
      .map(normaliseEpisodeItem)
      .filter((item) => inLookback(item.pubDate, lookbackDays))
      .slice(0, maxItems);
    return {
      sourceType: "podcast_episode",
      status: items.length ? "complete" : "partial",
      feedUrl: loaded.feedUrl,
      items,
      evidenceMethod: loaded.method,
      limitations: items.length ? loaded.attempts : ["Podcast RSS was readable, but no episode items fell inside the requested lookback window.", ...loaded.attempts],
    };
  } catch (error) {
    return {
      sourceType: "podcast_episode",
      status: "blocked",
      feedUrl: "",
      items: [],
      evidenceMethod: "Podcast RSS discovery failed",
      limitations: [error?.message || "Podcast RSS discovery failed."],
    };
  }
}

function buildEpisodeFindings(evidence) {
  const findings = [];
  if (evidence.status !== "complete") {
    findings.push(makeFinding({
      id: "PODCAST-EPISODE-001",
      title: "Podcast episode report could not verify current episode RSS evidence",
      severity: "high",
      sourceOwner: "aims_r2_podcast",
      sourceType: "podcast_episode",
      evidence: [evidence.evidenceMethod, ...arr(evidence.limitations)],
      requiredOutcome: "Restore podcast RSS evidence access before using the main website audit to judge podcast episode route quality.",
      verificationMethod: "Rerun /audits/podcast-website/run and confirm the podcastEpisode report status is complete.",
    }));
    return findings;
  }

  const seenLinks = new Map();
  for (const [index, item] of evidence.items.entries()) {
    const label = item.title || item.guid || `Episode ${index + 1}`;
    if (!isHttpUrl(item.link)) {
      findings.push(makeFinding({
        id: `PODCAST-EPISODE-LINK-${String(index + 1).padStart(3, "0")}`,
        title: "Podcast RSS item has no canonical episode page link",
        severity: "high",
        sourceOwner: "aims_r2_podcast",
        sourceType: "podcast_episode",
        itemTitleOrId: label,
        evidence: [`title: ${label}`, `guid: ${item.guid || "missing"}`, `link: ${item.link || "missing"}`],
        requiredOutcome: "For future podcast RSS output, ensure every item has a stable canonical episode page URL generated by AIMS/R2.",
        verificationMethod: "Regenerate the podcast RSS feed and rerun the podcast episode report; every item should expose a valid episode link.",
      }));
    } else {
      const key = item.link.toLowerCase();
      if (seenLinks.has(key)) {
        findings.push(makeFinding({
          id: `PODCAST-EPISODE-DUPLINK-${String(index + 1).padStart(3, "0")}`,
          title: "Podcast episode canonical link is duplicated",
          severity: "high",
          sourceOwner: "aims_r2_podcast",
          sourceType: "podcast_episode",
          itemTitleOrId: label,
          evidence: [`duplicateLink: ${item.link}`, `firstSeen: ${seenLinks.get(key)}`],
          requiredOutcome: "Make AIMS podcast episode slugs unique before publishing RSS and R2 episode pages.",
          verificationMethod: "Regenerate podcast metadata and confirm every RSS item link is unique.",
        }));
      }
      seenLinks.set(key, label);
    }

    if (!isHttpUrl(item.enclosureUrl)) {
      findings.push(makeFinding({
        id: `PODCAST-EPISODE-AUDIO-${String(index + 1).padStart(3, "0")}`,
        title: "Podcast RSS item has no audio enclosure URL",
        severity: "critical",
        sourceOwner: "aims_r2_podcast",
        sourceType: "podcast_episode",
        itemTitleOrId: label,
        evidence: [`title: ${label}`, `enclosureUrl: ${item.enclosureUrl || "missing"}`],
        requiredOutcome: "Block or repair future podcast RSS publication when the audio enclosure is missing.",
        verificationMethod: "Regenerate the feed and confirm each episode has a valid audio enclosure URL.",
      }));
    }

    if (!isHttpUrl(item.transcriptUrl)) {
      findings.push(makeFinding({
        id: `PODCAST-EPISODE-TRANSCRIPT-${String(index + 1).padStart(3, "0")}`,
        title: "Podcast RSS item has no transcript URL",
        severity: "medium",
        sourceOwner: "aims_r2_podcast",
        sourceType: "podcast_episode",
        itemTitleOrId: label,
        classification: "future_guidance",
        evidence: [`title: ${label}`, `transcriptUrl: ${item.transcriptUrl || "missing"}`],
        requiredOutcome: "For future podcast RSS output, include a transcript URL so transcript quality can be audited outside the static website report.",
        verificationMethod: "Regenerate the podcast RSS feed and confirm podcast:transcript is present where transcript HTML exists.",
      }));
    }

    if (words(item.description).length < 35) {
      findings.push(makeFinding({
        id: `PODCAST-EPISODE-DESC-${String(index + 1).padStart(3, "0")}`,
        title: "Podcast episode description is too thin for answer-engine context",
        severity: "medium",
        sourceOwner: "aims_r2_podcast",
        sourceType: "podcast_episode",
        itemTitleOrId: label,
        classification: "future_guidance",
        evidence: [`title: ${label}`, `descriptionWords: ${words(item.description).length}`],
        requiredOutcome: "For future episode metadata, publish a concise answer-first description with the episode's main topic, consequence and discussed entities.",
        verificationMethod: "Rerun the podcast episode report and confirm recent item descriptions clear the minimum context threshold.",
      }));
    }
  }
  return findings;
}

function buildTranscriptFindings(evidence) {
  const findings = [];
  if (evidence.status !== "complete") {
    findings.push(makeFinding({
      id: "PODCAST-TRANSCRIPT-001",
      title: "Podcast transcript report could not verify current R2 transcript evidence",
      severity: "high",
      sourceOwner: "podcast_transcript_pipeline",
      sourceType: "podcast_transcript_report",
      evidence: [evidence.evidenceMethod, ...arr(evidence.limitations)],
      requiredOutcome: "Restore R2 transcript discovery before judging transcript quality inside main static website audits.",
      verificationMethod: "Rerun /audits/podcast-website/run and confirm the podcastTranscript report status is complete.",
    }));
    return findings;
  }

  for (const [index, item] of arr(evidence.items).entries()) {
    const label = item.title || item.sessionId || item.r2Key || `Transcript ${index + 1}`;
    if (Number(item.textCharCount || 0) < 1800) {
      findings.push(makeFinding({
        id: `PODCAST-TRANSCRIPT-THIN-${String(index + 1).padStart(3, "0")}`,
        title: "Podcast transcript is thin or incomplete",
        severity: "high",
        sourceOwner: "podcast_transcript_pipeline",
        sourceType: "podcast_transcript_report",
        itemTitleOrId: label,
        evidence: [`title: ${label}`, `textCharCount: ${item.textCharCount || 0}`, `r2Key: ${item.r2Key || "unknown"}`],
        requiredOutcome: "For future transcript output, block publication if the generated transcript body is unexpectedly short or missing.",
        verificationMethod: "Generate a fresh transcript and rerun this report; the transcript body should clear the minimum completeness threshold.",
      }));
    }

    const flags = obj(item.htmlFeatureFlags);
    if (item.sourceFormat === "html" && flags.hasAeoSummaryBlock === false) {
      findings.push(makeFinding({
        id: `PODCAST-TRANSCRIPT-AEO-${String(index + 1).padStart(3, "0")}`,
        title: "Transcript HTML lacks the AEO summary block",
        severity: "medium",
        sourceOwner: "podcast_transcript_pipeline",
        sourceType: "podcast_transcript_report",
        itemTitleOrId: label,
        classification: "future_guidance",
        evidence: [`title: ${label}`, `htmlUrl: ${item.htmlUrl || "unknown"}`, "hasAeoSummaryBlock: false"],
        requiredOutcome: "For future transcript HTML, render the episode summary, key takeaways, entities/topics and transcript index before the full transcript body.",
        verificationMethod: "Generate fresh transcript HTML and confirm the AEO summary block is present before rerunning SEO/AEO/GEO.",
      }));
    }

    if (item.sourceFormat === "html" && flags.hasFaqJsonLd === false) {
      findings.push(makeFinding({
        id: `PODCAST-TRANSCRIPT-SCHEMA-${String(index + 1).padStart(3, "0")}`,
        title: "Transcript HTML lacks FAQPage JSON-LD support",
        severity: "low",
        sourceOwner: "podcast_transcript_pipeline",
        sourceType: "podcast_transcript_report",
        itemTitleOrId: label,
        classification: "future_guidance",
        evidence: [`title: ${label}`, "hasFaqJsonLd: false"],
        requiredOutcome: "For future transcript HTML, keep FAQPage JSON-LD aligned with visible summary/takeaway content.",
        verificationMethod: "Generate fresh transcript HTML and confirm schema is present and visible-content aligned.",
      }));
    }
  }
  return findings;
}

function severityCounts(findings = []) {
  return arr(findings).reduce((acc, finding) => {
    const key = finding.severity || "medium";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, { critical: 0, high: 0, medium: 0, low: 0 });
}

function reportSummary({ auditType, sessionId, generatedAt, evidence, findings, score, skillLensSummary }) {
  return {
    auditType,
    pipeline: PIPELINE,
    sessionId,
    generatedAt,
    status: evidence.status,
    score,
    findingCount: findings.length,
    severityCounts: severityCounts(findings),
    sourceCoverage: {
      sourceType: evidence.sourceType,
      status: evidence.status,
      itemsInspected: arr(evidence.items).length,
      evidenceMethod: evidence.evidenceMethod,
      limitations: arr(evidence.limitations),
    },
    skillLensSummary,
  };
}

function reportCoverage({ auditType, sessionId, generatedAt, evidence, skillLensSummary }) {
  return {
    auditType,
    pipeline: PIPELINE,
    sessionId,
    generatedAt,
    sourceCoverage: {
      sourceType: evidence.sourceType,
      status: evidence.status,
      itemsInspected: arr(evidence.items).length,
      feedUrl: evidence.feedUrl || null,
      evidenceMethod: evidence.evidenceMethod,
      limitations: arr(evidence.limitations),
    },
    skillLensSummary,
    items: arr(evidence.items).map((item) => ({
      title: item.title || null,
      sessionId: item.sessionId || null,
      guid: item.guid || null,
      link: item.link || null,
      publicUrl: item.publicUrl || null,
      htmlUrl: item.htmlUrl || null,
      r2Key: item.r2Key || null,
      pubDate: item.pubDate || item.date || null,
      sourceFormat: item.sourceFormat || null,
      textCharCount: item.textCharCount || null,
      htmlFeatureFlags: item.htmlFeatureFlags || null,
    })),
  };
}

function repositoryIssueAppendix({ auditType, sessionId, generatedAt, findings, sourceOwner }) {
  return {
    auditType,
    pipeline: PIPELINE,
    sessionId,
    generatedAt,
    ramsPolicy: sourceOwnerPolicy(sourceOwner),
    findings,
  };
}

function renderReportHtml({ title, report }) {
  const findings = arr(report.findings);
  const lensRows = arr(report.appliedSkillLenses).map((lens) => `<tr><td>${escapeHtml(lens.name)}</td><td>${escapeHtml(lens.adoption)}</td><td>${escapeHtml(
    lens.mode)}</td><td>${escapeHtml(arr(lens.checks).join("; "))}</td></tr>`).join("\n");
  const skillLensHtml = `<section><h2>Applied SEO/GEO skill lenses</h2><p>These are deterministic AIMS adaptations of the attached skills repo. They enrich the report without \
enabling blind static-site patching.</p><table><thead><tr><th>Skill</th><th>Adoption</th><th>Mode</th><th>Checks used</th></tr></thead><tbody>${lensRows}</tbody></table><h3>\
Measured signals</h3><pre>${escapeHtml(JSON.stringify(report.skillLensSummary?.measuredSignals || {}, null, 2))}</pre></section>`;
  const findingHtml = findings.length
    ? findings.map((finding) => `<article class="finding"><h3>${escapeHtml(finding.issueId)} · ${escapeHtml(
      finding.title)}</h3><p><span class="pill ${finding.severity === "critical" || finding.severity === "high" ? "bad" : finding.severity === "medium" ? "warn" :
         "ok"}">${escapeHtml(finding.severity)}</span> <span class="pill">${escapeHtml(finding.sourceOwner)}</span> <span class="pill">${escapeHtml(
           finding.classification)}</span></p><p><strong>Evidence:</strong> ${escapeHtml(arr(finding.evidence).join(" | "))}</p><p><strong>Outcome:</strong> ${escapeHtml(
             finding.requiredOutcome)}</p><p><strong>Verification:</strong> ${escapeHtml(finding.verificationMethod)}</p></article>`).join("\n")
    : "<p>No material findings were generated.</p>";
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;margin:0;background:#f4f7fb;color:#111827;line-height:1.55}header{background:#0d1420;color:#fff;padding:30px 24px}main{max-\
width:1180px;margin:0 auto;padding:32px 20px 64px}section,.finding{background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:22px;margin:18px 0;box-shadow:0 12px \
30px rgba(13,20,32,.06)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px}.kpi{background:#0d1420;color:#fff;border-radius:16px;padding:16px}\
.kpi strong{font-size:24px;display:block}.pill{display:inline-block;border-radius:999px;padding:5px 10px;background:#eef2ff;color:#4338ca;font-weight:700;font-size:12px;margin:\
0 4px 4px 0}.ok{background:#dcfce7;color:#166534}.warn{background:#fef3c7;color:#92400e}.bad{background:#fee2e2;color:#991b1b}table{width:100%;border-collapse:collapse;font-\
size:13px}th,td{border-bottom:1px solid #e5e7eb;padding:9px 7px;text-align:left;vertical-align:top}th{background:#f8fafc}pre{white-space:pre-wrap;word-break:break-word;\
background:#f3f4f6;border-radius:12px;padding:14px;font-size:12px}@media print{section,.finding{break-inside:avoid;page-break-inside:avoid}}</style>
</head>
<body>
<header><h1>${escapeHtml(title)}</h1><p>Generated ${escapeHtml(report.generatedAt)} · ${escapeHtml(report.executiveVerdict.status)}</p></header>
<main>
<section><h2>Executive verdict</h2><p>${escapeHtml(report.executiveVerdict.summary)}</p><p><span class="pill ok">AIMS/R2-owned</span><span class="pill">RAMS-readable</span>\
<span class="pill warn">no direct static website patching</span></p></section>
<section><h2>Score snapshot</h2><div class="grid"><div class="kpi"><span>Score</span><strong>${escapeHtml(
  report.score)}</strong></div><div class="kpi"><span>Items inspected</span><strong>${escapeHtml(
    report.sourceCoverage.itemsInspected)}</strong></div><div class="kpi"><span>Findings</span><strong>${escapeHtml(
      findings.length)}</strong></div><div class="kpi"><span>Status</span><strong>${escapeHtml(report.sourceCoverage.status)}</strong></div></div></section>
${skillLensHtml}
<section><h2>RAMS-readable findings</h2>${findingHtml}</section>
<section><h2>Source coverage</h2><pre>${escapeHtml(JSON.stringify(report.sourceCoverage, null, 2))}</pre></section>
</main>
</body>
</html>`;
}

async function publishPodcastReport({ auditType, sourceOwner, sessionId, evidence, findings, title }) {
  const generatedAt = nowIso();
  const reportPrefix = buildAuditPrefix(auditType, sessionId);
  const counts = severityCounts(findings);
  const score = scoreFromFindingCount(counts);
  const sourceCoverage = {
    sourceType: evidence.sourceType,
    status: evidence.status,
    itemsInspected: arr(evidence.items).length,
    feedUrl: evidence.feedUrl || null,
    evidenceMethod: evidence.evidenceMethod,
    limitations: arr(evidence.limitations),
  };
  const skillLensSummary = buildSkillLensSummary({ evidence, reportKind: auditType });
  const report = {
    auditType,
    pipeline: PIPELINE,
    sessionId,
    generatedAt,
    reportPrefix,
    cadence: "monthly_or_after_on_brand_run",
    sourceOwner,
    appliedSkillLenses: AIMS_AUDIT_SKILL_LENSES,
    skillLensSummary,
    executiveVerdict: {
      status: counts.critical || counts.high ? "Action required in AIMS/R2 generator lane" : findings.length ? "Monitor future-output guardrails" : "No material AIMS/R2 findings",
      summary: findings.length
        ? `${title} produced ${findings.length} RAMS-readable finding(s). These are AIMS/R2 source-owner items, not static website repo patches.`
        : `${title} found no material AIMS/R2 source-owner issues in the inspected window.`,
    },
    ramsPolicy: sourceOwnerPolicy(sourceOwner),
    score,
    sourceCoverage,
    findings,
  };
  const html = renderReportHtml({ title, report });
  const summary = reportSummary({ auditType, sessionId, generatedAt, evidence, findings, score, skillLensSummary });
  const coverage = reportCoverage({ auditType, sessionId, generatedAt, evidence, skillLensSummary });
  const appendix = repositoryIssueAppendix({ auditType, sessionId, generatedAt, findings, sourceOwner });
  const [reportJson, summaryJson, coverageJson, appendixJson, reportHtml] = await Promise.all([
    publishAuditJson({ key: `${reportPrefix}/report.json`, payload: report }),
    publishAuditJson({ key: `${reportPrefix}/summary.json`, payload: summary }),
    publishAuditJson({ key: `${reportPrefix}/coverage.json`, payload: coverage }),
    publishAuditJson({ key: `${reportPrefix}/repository-issue-appendix.json`, payload: appendix }),
    publishAuditText({ key: `${reportPrefix}/report.html`, text: html, contentType: "text/html; charset=utf-8" }),
  ]);
  const latestPayload = {
    auditType,
    pipeline: PIPELINE,
    sessionId,
    updatedAt: nowIso(),
    reportPrefix,
    sourceOwner,
    reportUrl: reportHtml.url,
    reportHtmlUrl: reportHtml.url,
    reportJsonUrl: reportJson.url,
    summaryUrl: summaryJson.url,
    coverageUrl: coverageJson.url,
    repositoryIssueAppendixUrl: appendixJson.url,
    sourceCoverage,
    appliedSkillLenses: AIMS_AUDIT_SKILL_LENSES,
    skillLensSummary,
    executiveVerdict: report.executiveVerdict,
    findingCount: findings.length,
    ramsPolicy: report.ramsPolicy,
  };
  const latestJson = await publishAuditJson({ key: buildLatestKey(auditType), payload: latestPayload });
  return {
    ok: true,
    auditType,
    pipeline: PIPELINE,
    sessionId,
    reportPrefix,
    reportUrl: reportHtml.url,
    reportJsonUrl: reportJson.url,
    summaryUrl: summaryJson.url,
    coverageUrl: coverageJson.url,
    repositoryIssueAppendixUrl: appendixJson.url,
    latestUrl: latestJson.url,
    sourceCoverage,
    appliedSkillLenses: AIMS_AUDIT_SKILL_LENSES,
    skillLensSummary,
    executiveVerdict: report.executiveVerdict,
    findingCount: findings.length,
    ramsPolicy: report.ramsPolicy,
  };
}

export async function runPodcastEpisodeWebsiteReport(options = {}) {
  const sessionId = trim(options.sessionId) || `${EPISODE_AUDIT_TYPE}-${crypto.randomUUID()}`;
  const evidence = await collectPodcastEpisodeEvidence({
    lookbackDays: options.lookbackDays || DEFAULT_LOOKBACK_DAYS,
    maxItems: options.maxItems || DEFAULT_MAX_ITEMS,
  });
  const findings = [
    ...buildEpisodeFindings(evidence),
    ...buildEpisodeSkillLensFindings(evidence, makeFinding),
  ];
  const result = await publishPodcastReport({
    auditType: EPISODE_AUDIT_TYPE,
    sourceOwner: "aims_r2_podcast",
    sessionId,
    evidence,
    findings,
    title: "Podcast Episode Website Report",
  });
  info("audit.podcast-episode.complete", { sessionId, findings: findings.length, status: evidence.status });
  return result;
}

export async function runPodcastTranscriptWebsiteReport(options = {}) {
  const sessionId = trim(options.sessionId) || `${TRANSCRIPT_AUDIT_TYPE}-${crypto.randomUUID()}`;
  const lookbackDays = Math.max(1, Math.min(365, Number(options.lookbackDays || DEFAULT_LOOKBACK_DAYS)));
  const windowEnd = options.windowEnd ? new Date(options.windowEnd) : new Date();
  const windowStart = options.windowStart ? new Date(options.windowStart) : new Date(windowEnd.getTime() - lookbackDays * 86400000);
  const evidence = await collectPodcastTranscriptEvidence({
    include: true,
    windowStart,
    windowEnd,
    maxTranscripts: options.maxItems || DEFAULT_MAX_ITEMS,
  });
  const findings = [
    ...buildTranscriptFindings(evidence),
    ...buildTranscriptSkillLensFindings(evidence, makeFinding),
  ];
  const result = await publishPodcastReport({
    auditType: TRANSCRIPT_AUDIT_TYPE,
    sourceOwner: "podcast_transcript_pipeline",
    sessionId,
    evidence,
    findings,
    title: "Podcast Transcript Website Report",
  });
  info("audit.podcast-transcript.complete", { sessionId, findings: findings.length, status: evidence.status });
  return result;
}

export async function runPodcastWebsiteReports(options = {}) {
  const baseSessionId = trim(options.sessionId) || `podcast-website-${crypto.randomUUID()}`;
  const [podcastEpisode, podcastTranscript] = await Promise.all([
    runPodcastEpisodeWebsiteReport({ ...options, sessionId: `${baseSessionId}-episode` }),
    runPodcastTranscriptWebsiteReport({ ...options, sessionId: `${baseSessionId}-transcript` }),
  ]);
  return {
    ok: podcastEpisode.ok && podcastTranscript.ok,
    auditType: "podcast-website",
    pipeline: PIPELINE,
    sessionId: baseSessionId,
    podcastEpisode,
    podcastTranscript,
  };
}

export function getPodcastWebsiteReportStatus() {
  return {
    ok: true,
    auditType: "podcast-website",
    pipeline: PIPELINE,
    outputAuditTypes: [EPISODE_AUDIT_TYPE, TRANSCRIPT_AUDIT_TYPE],
    latestKeys: [buildLatestKey(EPISODE_AUDIT_TYPE), buildLatestKey(TRANSCRIPT_AUDIT_TYPE)],
    routes: ["GET /audits/podcast-website/health", "POST /audits/podcast-website/run"],
    appliedSkillLenses: AIMS_AUDIT_SKILL_LENSES,
    ramsPolicy: sourceOwnerPolicy("aims_r2_podcast"),
  };
}

export const __podcastWebsiteReportsTestHooks = {
  buildEpisodeFindings,
  buildTranscriptFindings,
  buildEpisodeSkillLensFindings,
  buildSkillLensSummary,
  buildTranscriptSkillLensFindings,
  collectPodcastEpisodeEvidence,
  makeFinding,
  normaliseEpisodeItem,
};

export default runPodcastWebsiteReports;
