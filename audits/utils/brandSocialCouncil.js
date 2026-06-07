import crypto from "node:crypto";
import { buildAuditPrefix } from "./auditPaths.js";
import {
  auditKeyFromPublicUrl,
  publishAuditJson,
  publishAuditLatest,
  publishAuditText,
  readAuditJson,
} from "./publishAuditArtifacts.js";

const AUDIT_TYPE = "brand-social-council";
const SOURCE_LATEST_KEYS = {
  onBrand: "audits/on-brand/latest.json",
  socialPerformance: "audits/social-performance/latest.json",
  podcastEpisode: "audits/podcast-episode/latest.json",
  podcastTranscript: "audits/podcast-transcript/latest.json",
};

function trim(value) {
  return String(value ?? "").trim();
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clampScore(value, fallback = 50) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function obj(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstText(...values) {
  for (const value of values) {
    const text = trim(value);
    if (text) return text;
  }
  return "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-GB").format(toNumber(value));
}

function normaliseSeverity(value, fallback = "medium") {
  const text = trim(value).toLowerCase();
  return ["critical", "high", "medium", "low"].includes(text) ? text : fallback;
}

function severityRank(value) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[normaliseSeverity(value)] ?? 4;
}

function percentage(value) {
  return `${toNumber(value).toFixed(2)}%`;
}

function councilMembers() {
  return [
    { role: "Brand Editor", remit: "Tone, hype control, duplicate phrasing and Jonathan Harris voice." },
    { role: "Social Performance Analyst", remit: "Zernio metrics, platform winners, weak posts and lane-level performance." },
    { role: "Hook Analyst", remit: "Opening lines, scroll-stopping clarity and weak hooks." },
    { role: "Thumbnail & Visual Packaging Expert", remit: "Shorts/Reels thumbnail and first-frame evidence, visual promise, recognisable packaging and clutter." },
    { role: "Repurposing Lead", remit: "Podcast, blog and RSS material that deserves carousels, shorts, quizzes or ebook posts." },
    { role: "Comments & Replies Auditor", remit: "Audience questions, objections, repeated comments and save/share clues." },
    { role: "Cross-Platform Coherence Lead", remit: "Consistent framing across Facebook, Instagram, YouTube, TikTok, RSS and podcast output." },
    { role: "Podcast & Transcript Lead", remit: "Spoken-copy, transcript usefulness and AEO-ready episode material." },
    { role: "Commercial Lead", remit: "Ebook clicks, newsletter CTA, book relevance and platform ROI." },
    { role: "Automation Safety Lead", remit: "RAMS classification, source ownership and patch safety." },
  ];
}

function ramsPolicy() {
  return {
    ramsReadable: true,
    shouldTriggerRams: false,
    codePatchAllowed: false,
    defaultClassification: "future_guidance",
    reason: "This council report is a master decision layer for RAMS planning. It is not allowed to request code patches unless a later finding includes exact repo-owned files and deterministic acceptance criteria.",
  };
}

async function readJsonIfPresent(key) {
  try {
    return { ok: true, key, value: await readAuditJson({ key }) };
  } catch (error) {
    return { ok: false, key, error: error?.message || String(error), value: null };
  }
}

async function readUrlIfPresent(url) {
  const key = auditKeyFromPublicUrl(url);
  if (!key) return { ok: false, key: "", error: "missing or unsupported URL", value: null };
  return readJsonIfPresent(key);
}

async function loadSourceBundle(label, latestKey) {
  const latestResult = await readJsonIfPresent(latestKey);
  const latest = obj(latestResult.value);
  const reportResult = latest.reportJsonUrl ? await readUrlIfPresent(latest.reportJsonUrl) : { ok: false, key: "", error: "missing reportJsonUrl", value: null };
  const summaryResult = latest.summaryUrl ? await readUrlIfPresent(latest.summaryUrl) : { ok: false, key: "", error: "missing summaryUrl", value: null };
  const coverageResult = latest.coverageUrl ? await readUrlIfPresent(latest.coverageUrl) : { ok: false, key: "", error: "missing coverageUrl", value: null, optional: true };
  return {
    label,
    latestKey,
    latestLoaded: latestResult.ok,
    reportLoaded: reportResult.ok,
    summaryLoaded: summaryResult.ok,
    coverageLoaded: coverageResult.ok,
    latest,
    report: obj(reportResult.value),
    summary: obj(summaryResult.value),
    coverage: obj(coverageResult.value),
    errors: [latestResult, reportResult, summaryResult, coverageResult]
      .filter((item) => !item.ok && !item.optional)
      .map((item) => ({ key: item.key, error: item.error })),
    warnings: [coverageResult]
      .filter((item) => !item.ok && item.optional)
      .map((item) => ({ key: item.key, warning: item.error })),
  };
}

function makeFinding({
  id,
  title,
  severity = "medium",
  councilMember = "Automation Safety Lead",
  sourceOwner = "aims_content_pipeline",
  automationReadiness = "future_guidance",
  evidence = [],
  requiredOutcome,
  verificationMethod,
  classification = "future_guidance",
}) {
  const safeClassification = classification === "manual_review" ? "manual_review" : "future_guidance";
  return {
    issueId: id,
    findingId: id,
    title,
    issueType: title,
    severity: normaliseSeverity(severity),
    confidence: 0.86,
    classification: safeClassification,
    status: safeClassification,
    sourceType: "brand_social_council",
    sourceOwner,
    councilMember,
    automationReadiness,
    fixClass: "future_guidance",
    allowedFixClass: "",
    affectedPaths: [],
    evidence: arr(evidence).map(String).filter(Boolean).slice(0, 10),
    exactEvidence: arr(evidence).map(String).filter(Boolean).join("; "),
    requiredOutcome: requiredOutcome || "Use this council finding to tighten future output and rerun the relevant audit next month.",
    exactRemediation: requiredOutcome || "Use this council finding as future QA guidance.",
    verificationMethod: verificationMethod || "Rerun the on-brand and social-performance reports, then regenerate the council report.",
    ramsPolicy: {
      patchAllowed: false,
      reason: "Council findings are future guidance or manual review unless a deterministic file-level issue is published separately.",
    },
  };
}

function onBrandScore(report) {
  return clampScore(report?.scorecard?.overallBrandFit ?? report?.scorecard?.overall ?? report?.overallBrandFit, 0);
}

function buildOnBrandFindings(report, findings) {
  const defects = arr(report.confirmedDefectsLedger).sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const score = onBrandScore(report);
  if (score && score < 80) {
    findings.push(makeFinding({
      id: "BSC-OB-001",
      title: "Brand fit needs future-output tightening",
      severity: score < 70 ? "high" : "medium",
      councilMember: "Brand Editor",
      sourceOwner: "aims_content_pipeline",
      evidence: [`overallBrandFit: ${score}`, `defectCount: ${defects.length}`],
      requiredOutcome: "Tighten future RSS, OneUp, social and podcast prompt guardrails before the next monthly run; do not rewrite historic posts unless deliberately republishing.",
      verificationMethod: "Rerun the on-brand audit and confirm overall brand fit is at least 80 with fewer repeated future-QA findings.",
    }));
  }

  const grouped = [];
  const seenGroups = new Map();
  for (const defect of defects.slice(0, 18)) {
    const key = [
      trim(defect.sourceType || "pipeline"),
      trim(defect.issueType || defect.violatedRule || "On-brand future QA finding").toLowerCase(),
      trim(defect.violatedRule || "").toLowerCase(),
      trim(defect.exactRemediation || "").toLowerCase().slice(0, 180),
    ].join("|");
    if (!seenGroups.has(key)) {
      const group = { defect, count: 0, examples: [] };
      seenGroups.set(key, group);
      grouped.push(group);
    }
    const group = seenGroups.get(key);
    group.count += 1;
    const evidence = firstText(defect.exactEvidence, defect.itemTitleOrId);
    if (evidence && group.examples.length < 3) group.examples.push(evidence);
  }

  for (const [index, group] of grouped.slice(0, 6).entries()) {
    const defect = group.defect;
    const sourceType = trim(defect.sourceType || "pipeline");
    const owner = sourceType === "oneup_blog_social"
      ? "oneup_scheduler"
      : sourceType === "rss_feed"
        ? "rss_social_pipeline"
        : sourceType === "podcast_transcript"
          ? "podcast_transcript_pipeline"
          : "aims_content_pipeline";
    findings.push(makeFinding({
      id: `BSC-OB-${String(index + 2).padStart(3, "0")}`,
      title: firstText(defect.issueType, defect.violatedRule, "On-brand future QA finding"),
      severity: defect.severity || "medium",
      councilMember: "Brand Editor",
      sourceOwner: owner,
      automationReadiness: "future_prompt_guardrail",
      evidence: [
        `sourceType: ${sourceType}`,
        group.count > 1 ? `occurrences: ${group.count}` : "",
        `evidence: ${group.examples.join(" || ") || firstText(defect.exactEvidence, defect.itemTitleOrId)}`,
        `rule: ${trim(defect.violatedRule)}`,
      ].filter(Boolean),
      requiredOutcome: firstText(defect.exactRemediation, "Use this evidence to tighten future generated output."),
      verificationMethod: firstText(defect.verificationMethod, "Generate fresh output and rerun the on-brand audit."),
    }));
  }
}


function buildPodcastWebsiteFindings(bundle, findings, { sourceOwner, councilMember, prefix }) {
  const sourceFindings = [
    ...arr(bundle.report?.findings),
    ...arr(bundle.summary?.findings),
    ...arr(bundle.coverage?.findings),
  ].filter((item) => item && typeof item === "object" && !Array.isArray(item));

  for (const [index, finding] of sourceFindings.slice(0, 8).entries()) {
    findings.push(makeFinding({
      id: `${prefix}-${String(index + 1).padStart(3, "0")}`,
      title: firstText(finding.title, finding.issueType, "Podcast website report finding"),
      severity: finding.severity || "medium",
      councilMember,
      sourceOwner: finding.sourceOwner || sourceOwner,
      automationReadiness: finding.automationReadiness || "generator_review",
      evidence: [
        `sourceReport: ${bundle.label}`,
        ...arr(finding.evidence),
        firstText(finding.exactEvidence),
      ].filter(Boolean),
      requiredOutcome: firstText(finding.requiredOutcome, finding.exactRemediation, "Use the separate podcast website report as the source-owner evidence for future AIMS/R2 generator work."),
      verificationMethod: firstText(finding.verificationMethod, "Rerun the podcast website report and confirm the finding has cleared."),
      classification: finding.classification === "manual_review" ? "manual_review" : "future_guidance",
    }));
  }
}

function findAggregate(rows, key) {
  return arr(rows).find((row) => row?.key === key) || null;
}

function maxReachViews(post = {}) {
  const metrics = obj(post.metrics);
  return Math.max(toNumber(metrics.reach), toNumber(metrics.views), toNumber(metrics.impressions));
}

function buildSocialFindings(report, findings) {
  const totals = obj(report.totals);
  const totalPosts = toNumber(totals.posts);
  const byLane = arr(report.byLane);
  const byPlatform = arr(report.byPlatform);
  const unclassified = findAggregate(byLane, "unclassified");
  const unclassifiedPosts = toNumber(unclassified?.posts);
  if (totalPosts && unclassifiedPosts / totalPosts >= 0.25) {
    findings.push(makeFinding({
      id: "BSC-SOC-001",
      title: "Social report needs stronger content-lane attribution",
      severity: unclassifiedPosts / totalPosts >= 0.5 ? "high" : "medium",
      councilMember: "Social Performance Analyst",
      sourceOwner: "zernio_analysis",
      automationReadiness: "analysis_hygiene",
      evidence: [`postsAnalysed: ${totalPosts}`, `unclassifiedPosts: ${unclassifiedPosts}`, `unclassifiedShare: ${percentage((unclassifiedPosts / totalPosts) * 100)}`],
      requiredOutcome: "Add durable content-lane/source-pipeline markers in AIMS scheduling logs and/or generated captions so future Zernio reports can separate OneUp, Blotato, quiz, ebook and manual posts cleanly.",
      verificationMethod: "Rerun the social-performance report and confirm unclassified posts fall below 25% of the monthly total.",
    }));
  }

  const platforms = byPlatform.filter((row) => toNumber(row.posts) > 0);
  if (platforms.length > 1) {
    const ranked = [...platforms].sort((a, b) => toNumber(b.metrics?.engagementRateAvg) - toNumber(a.metrics?.engagementRateAvg));
    const best = ranked[0];
    const weakest = ranked[ranked.length - 1];
    if (best && weakest && best.key !== weakest.key) {
      findings.push(makeFinding({
        id: "BSC-SOC-002",
        title: "Platform packaging gap needs monthly testing",
        severity: "medium",
        councilMember: "Social Performance Analyst",
        sourceOwner: "aims_content_pipeline",
        automationReadiness: "platform_tuning",
        evidence: [
          `bestPlatform: ${best.key} (${percentage(best.metrics?.engagementRateAvg)})`,
          `weakestPlatform: ${weakest.key} (${percentage(weakest.metrics?.engagementRateAvg)})`,
        ],
        requiredOutcome: `Use ${best.key} as the reference for hook and CTA testing, then compare ${weakest.key} format, first line, caption length and visual packaging before the next monthly report.`,
        verificationMethod: "Rerun Zernio and the council report after one month of platform-specific hook/packaging tests.",
      }));
    }
  }

  const tinyTopPosts = arr(report.topPosts).filter((post) => toNumber(post?.metrics?.engagementRate) >= 50 && maxReachViews(post) <= 5);
  if (tinyTopPosts.length) {
    findings.push(makeFinding({
      id: "BSC-SOC-003",
      title: "Do not over-trust tiny-sample top-post engagement",
      severity: "medium",
      councilMember: "Automation Safety Lead",
      sourceOwner: "zernio_analysis",
      automationReadiness: "manual_review",
      classification: "manual_review",
      evidence: [`tinyHighEngagementPosts: ${tinyTopPosts.length}`, `sample: ${tinyTopPosts[0].platform} ${tinyTopPosts[0].contentLane} ${maxReachViews(tinyTopPosts[0])} reach/views`],
      requiredOutcome: "Use top-post engagement as a hint only when reach/views are tiny; prioritise repeated patterns across platforms and months before changing automation weights.",
      verificationMethod: "Check next month whether the same hook/lane performs above baseline with meaningful reach or views.",
    }));
  }

  for (const [index, rec] of arr(report.recommendations).slice(0, 5).entries()) {
    const priority = trim(rec.priority) || "social_tuning";
    findings.push(makeFinding({
      id: `BSC-SOC-${String(index + 4).padStart(3, "0")}`,
      title: firstText(rec.title, "Social performance recommendation"),
      severity: "medium",
      councilMember: "Social Performance Analyst",
      sourceOwner: "aims_content_pipeline",
      automationReadiness: priority,
      evidence: [firstText(rec.detail, rec.priority)],
      requiredOutcome: socialRecommendationOutcome(rec, priority),
      verificationMethod: "Rerun the social-performance report and compare platform/lane metrics against the prior month.",
    }));
  }
}

function socialRecommendationOutcome(rec = {}, priority = "") {
  const title = firstText(rec.title).toLowerCase();
  const detail = firstText(rec.detail, "Use this recommendation to tune future post generation and scheduling.");
  if (priority === "platform_tuning" || title.includes("youtube") || title.includes("creative packaging")) {
    return "Run a one-month platform packaging test: compare opening line, caption length, title/thumbnail promise and first-frame clarity against the strongest platform pattern. Do not change automation weights until the next report confirms the signal.";
  }
  if (priority === "content_lane_weighting" || title.includes("ebook")) {
    return "Give the detected winning lane a small extra test allocation next month, then confirm whether the improvement holds with meaningful reach/views before adjusting long-term scheduling.";
  }
  if (priority === "tracking_hygiene" || title.includes("content-lane")) {
    return "Add durable lane/source attribution to AIMS logs and captions where appropriate so OneUp, RSS social blog, podcast, Blotato and quiz posts are separated cleanly in future reports.";
  }
  if (priority === "observe_and_amplify") {
    return "Use the strongest platform as a reference pattern for next-month hook and CTA tests, but treat tiny reach/view samples as directional only.";
  }
  return detail;
}

function buildThumbnailFindings(report, findings) {
  const thumbnailAudit = obj(report.thumbnailAudit);
  if (!thumbnailAudit.enabled) {
    findings.push(makeFinding({
      id: "BSC-THUMB-001",
      title: "Thumbnail audit is not enabled for shorts packaging evidence",
      severity: "low",
      councilMember: "Thumbnail & Visual Packaging Expert",
      sourceOwner: "blotato_video_pipeline",
      automationReadiness: "thumbnail_evidence_gap",
      evidence: [thumbnailAudit.reason || "Thumbnail evidence collection disabled or unavailable."],
      requiredOutcome: "Enable thumbnail auditing for a bounded sample of Facebook, Instagram, YouTube and TikTok shorts when Playwright or metadata fetch is stable, so packaging recommendations are based on visual evidence rather than captions alone.",
      verificationMethod: "Run the social-performance report with thumbnail auditing enabled and confirm thumbnail-audit.json is published.",
    }));
    return;
  }

  const summary = obj(thumbnailAudit.summary);
  const missing = toNumber(summary.missing || summary.failed || summary.notFound);
  const checked = toNumber(summary.checked || summary.total || arr(thumbnailAudit.results).length);
  if (checked && missing / checked >= 0.3) {
    findings.push(makeFinding({
      id: "BSC-THUMB-001",
      title: "Shorts thumbnail evidence is incomplete",
      severity: "medium",
      councilMember: "Thumbnail & Visual Packaging Expert",
      sourceOwner: "blotato_video_pipeline",
      automationReadiness: "thumbnail_packaging_review",
      evidence: [`checked: ${checked}`, `missing: ${missing}`],
      requiredOutcome: "Improve thumbnail/first-frame evidence collection and review Blotato visual packaging for posts where thumbnail extraction fails or visual promise is unclear.",
      verificationMethod: "Rerun the social-performance report and confirm thumbnail evidence is collected for at least 80% of sampled shorts.",
    }));
  }
}

function buildCouncilReport({ sessionId, reportPrefix, onBrandBundle, socialBundle, podcastEpisodeBundle = {}, podcastTranscriptBundle = {} }) {
  const onBrandReport = obj(onBrandBundle.report);
  const socialReport = obj(socialBundle.report);
  const generatedAt = new Date().toISOString();
  const findings = [];
  buildOnBrandFindings(onBrandReport, findings);
  buildSocialFindings(socialReport, findings);
  buildThumbnailFindings(socialReport, findings);
  buildPodcastWebsiteFindings(podcastEpisodeBundle, findings, {
    sourceOwner: "aims_r2_podcast",
    councilMember: "Podcast & Transcript Lead",
    prefix: "BSC-PODCAST-EPISODE",
  });
  buildPodcastWebsiteFindings(podcastTranscriptBundle, findings, {
    sourceOwner: "podcast_transcript_pipeline",
    councilMember: "Podcast & Transcript Lead",
    prefix: "BSC-PODCAST-TRANSCRIPT",
  });

  const sourceReports = {
    onBrand: {
      latestKey: onBrandBundle.latestKey,
      loaded: onBrandBundle.latestLoaded && onBrandBundle.reportLoaded,
      sessionId: onBrandBundle.latest.sessionId || onBrandReport.sessionId || null,
      reportUrl: onBrandBundle.latest.reportHtmlUrl || onBrandBundle.latest.reportUrl || null,
      reportJsonUrl: onBrandBundle.latest.reportJsonUrl || null,
      summaryUrl: onBrandBundle.latest.summaryUrl || null,
      errors: onBrandBundle.errors,
      warnings: onBrandBundle.warnings || [],
    },
    socialPerformance: {
      latestKey: socialBundle.latestKey,
      loaded: socialBundle.latestLoaded && socialBundle.reportLoaded,
      sessionId: socialBundle.latest.sessionId || socialReport.sessionId || null,
      reportUrl: socialBundle.latest.reportUrl || null,
      reportJsonUrl: socialBundle.latest.reportJsonUrl || null,
      summaryUrl: socialBundle.latest.summaryUrl || null,
      errors: socialBundle.errors,
      warnings: socialBundle.warnings || [],
    },
    podcastEpisode: {
      latestKey: podcastEpisodeBundle.latestKey || SOURCE_LATEST_KEYS.podcastEpisode,
      loaded: Boolean(podcastEpisodeBundle.latestLoaded && podcastEpisodeBundle.reportLoaded),
      sessionId: podcastEpisodeBundle.latest?.sessionId || podcastEpisodeBundle.report?.sessionId || null,
      reportUrl: podcastEpisodeBundle.latest?.reportHtmlUrl || podcastEpisodeBundle.latest?.reportUrl || null,
      reportJsonUrl: podcastEpisodeBundle.latest?.reportJsonUrl || null,
      summaryUrl: podcastEpisodeBundle.latest?.summaryUrl || null,
      errors: podcastEpisodeBundle.errors || [],
      warnings: podcastEpisodeBundle.warnings || [],
    },
    podcastTranscript: {
      latestKey: podcastTranscriptBundle.latestKey || SOURCE_LATEST_KEYS.podcastTranscript,
      loaded: Boolean(podcastTranscriptBundle.latestLoaded && podcastTranscriptBundle.reportLoaded),
      sessionId: podcastTranscriptBundle.latest?.sessionId || podcastTranscriptBundle.report?.sessionId || null,
      reportUrl: podcastTranscriptBundle.latest?.reportHtmlUrl || podcastTranscriptBundle.latest?.reportUrl || null,
      reportJsonUrl: podcastTranscriptBundle.latest?.reportJsonUrl || null,
      summaryUrl: podcastTranscriptBundle.latest?.summaryUrl || null,
      errors: podcastTranscriptBundle.errors || [],
      warnings: podcastTranscriptBundle.warnings || [],
    },
  };

  const scores = {
    brandFit: onBrandScore(onBrandReport),
    socialPosts: toNumber(socialReport?.totals?.posts),
    socialViews: toNumber(socialReport?.totals?.metrics?.views),
    socialClicks: toNumber(socialReport?.totals?.metrics?.clicks),
    socialEngagementRateAvg: toNumber(socialReport?.totals?.metrics?.engagementRateAvg),
    podcastEpisodeScore: toNumber(podcastEpisodeBundle.report?.score || podcastEpisodeBundle.summary?.score),
    podcastTranscriptScore: toNumber(podcastTranscriptBundle.report?.score || podcastTranscriptBundle.summary?.score),
  };

  const highFindings = findings.filter((finding) => ["critical", "high"].includes(finding.severity)).length;
  const manualReview = findings.filter((finding) => finding.classification === "manual_review").length;
  const status = highFindings ? "Action required before next monthly cycle" : findings.length ? "Monitor and tune" : "No material council findings";

  return {
    auditType: AUDIT_TYPE,
    sessionId,
    generatedAt,
    reportPrefix,
    cadence: "monthly",
    purpose: "Master council report combining on-brand QA and Zernio social-performance evidence for future AIMS/RAMS planning.",
    executiveVerdict: {
      status,
      summary: findings.length
        ? `The council produced ${findings.length} RAMS-readable finding(s), including ${manualReview} manual-review item(s). No direct code patching is authorised from this report.`
        : "On-brand and social-performance evidence produced no material action items for this cycle.",
    },
    ramsPolicy: ramsPolicy(),
    councilMembers: councilMembers(),
    sourceReports,
    scores,
    findings,
    decisions: {
      oneup: findings.filter((item) => ["oneup_scheduler", "rss_social_pipeline"].includes(item.sourceOwner)).map((item) => item.title),
      blotato: findings.filter((item) => item.sourceOwner === "blotato_video_pipeline").map((item) => item.title),
      aims: findings.filter((item) => item.sourceOwner === "aims_content_pipeline").map((item) => item.title),
      podcast: findings.filter((item) => ["aims_r2_podcast", "podcast_transcript_pipeline"].includes(item.sourceOwner)).map((item) => item.title),
      rams: ["Consume this master report as on-brand future_guidance/manual_review only. Do not create repo patches from council findings without deterministic file-level evidence."],
    },
    coverage: {
      sourcesLoaded: {
        onBrand: sourceReports.onBrand.loaded,
        socialPerformance: sourceReports.socialPerformance.loaded,
        podcastEpisode: sourceReports.podcastEpisode.loaded,
        podcastTranscript: sourceReports.podcastTranscript.loaded,
      },
      sourceErrors: [
        ...onBrandBundle.errors.map((error) => ({ source: "on-brand", ...error })),
        ...socialBundle.errors.map((error) => ({ source: "social-performance", ...error })),
        ...arr(podcastEpisodeBundle.errors).map((error) => ({ source: "podcast-episode", ...error })),
        ...arr(podcastTranscriptBundle.errors).map((error) => ({ source: "podcast-transcript", ...error })),
      ],
      sourceWarnings: [
        ...arr(onBrandBundle.warnings).map((warning) => ({ source: "on-brand", ...warning })),
        ...arr(socialBundle.warnings).map((warning) => ({ source: "social-performance", ...warning })),
        ...arr(podcastEpisodeBundle.warnings).map((warning) => ({ source: "podcast-episode", ...warning })),
        ...arr(podcastTranscriptBundle.warnings).map((warning) => ({ source: "podcast-transcript", ...warning })),
      ],
      partial: !sourceReports.onBrand.loaded || !sourceReports.socialPerformance.loaded,
    },
  };
}

function severityBadge(severity) {
  const cls = severity === "critical" || severity === "high" ? "bad" : severity === "medium" ? "warn" : "ok";
  return `<span class="pill ${cls}">${escapeHtml(severity)}</span>`;
}

function renderFindings(findings = []) {
  if (!findings.length) return "<p>No material council findings were generated.</p>";
  return findings.map((finding) => `<article class="finding"><h3>${escapeHtml(finding.issueId)} · ${escapeHtml(finding.title)}</h3><p>${severityBadge(finding.severity)} <span class="pill">${escapeHtml(finding.councilMember)}</span> <span class="pill">${escapeHtml(finding.sourceOwner)}</span> <span class="pill">${escapeHtml(finding.classification)}</span></p><p><strong>Evidence:</strong> ${escapeHtml(arr(finding.evidence).join(" | "))}</p><p><strong>Outcome:</strong> ${escapeHtml(finding.requiredOutcome)}</p><p><strong>Verification:</strong> ${escapeHtml(finding.verificationMethod)}</p></article>`).join("\n");
}

export function renderBrandSocialCouncilHtml(report) {
  const scores = obj(report.scores);
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Brand & Social Media Performance Council</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;margin:0;background:#f4f7fb;color:#111827;line-height:1.55}header{background:#0d1420;color:#fff;padding:30px 24px}main{max-width:1180px;margin:0 auto;padding:32px 20px 64px}section,.finding{background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:22px;margin:18px 0;box-shadow:0 12px 30px rgba(13,20,32,.06)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px}.kpi{background:#0d1420;color:#fff;border-radius:16px;padding:16px}.kpi strong{font-size:24px;display:block}.pill{display:inline-block;border-radius:999px;padding:5px 10px;background:#eef2ff;color:#4338ca;font-weight:700;font-size:12px;margin:0 4px 4px 0}.ok{background:#dcfce7;color:#166534}.warn{background:#fef3c7;color:#92400e}.bad{background:#fee2e2;color:#991b1b}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid #e5e7eb;padding:9px 7px;text-align:left;vertical-align:top}th{background:#f8fafc}@media print{section,.finding{break-inside:avoid;page-break-inside:avoid}}
</style>
</head>
<body>
<header><h1>Brand & Social Media Performance Council</h1><p>Generated ${escapeHtml(report.generatedAt)} · ${escapeHtml(report.executiveVerdict.status)}</p></header>
<main>
<section><h2>Executive verdict</h2><p>${escapeHtml(report.executiveVerdict.summary)}</p><p><span class="pill ok">R2 audits bucket</span><span class="pill">RAMS-readable</span><span class="pill warn">no direct code patching</span></p></section>
<section><h2>Score snapshot</h2><div class="grid"><div class="kpi"><span>Brand fit</span><strong>${formatNumber(scores.brandFit)}</strong></div><div class="kpi"><span>Social posts</span><strong>${formatNumber(scores.socialPosts)}</strong></div><div class="kpi"><span>Views</span><strong>${formatNumber(scores.socialViews)}</strong></div><div class="kpi"><span>Clicks</span><strong>${formatNumber(scores.socialClicks)}</strong></div><div class="kpi"><span>Avg engagement</span><strong>${percentage(scores.socialEngagementRateAvg)}</strong></div><div class="kpi"><span>Podcast episodes</span><strong>${formatNumber(scores.podcastEpisodeScore)}</strong></div><div class="kpi"><span>Transcripts</span><strong>${formatNumber(scores.podcastTranscriptScore)}</strong></div></div></section>
<section><h2>Council members</h2><table><thead><tr><th>Role</th><th>Remit</th></tr></thead><tbody>${report.councilMembers.map((member) => `<tr><td>${escapeHtml(member.role)}</td><td>${escapeHtml(member.remit)}</td></tr>`).join("\n")}</tbody></table></section>
<section><h2>RAMS policy</h2><p>${escapeHtml(report.ramsPolicy.reason)}</p></section>
<section><h2>RAMS-readable findings</h2>${renderFindings(report.findings)}</section>
<section><h2>Source coverage</h2><pre>${escapeHtml(JSON.stringify(report.coverage, null, 2))}</pre></section>
</main>
</body>
</html>`;
}

function repositoryIssueAppendix(report) {
  return {
    auditType: AUDIT_TYPE,
    pipeline: "on-brand",
    sessionId: report.sessionId,
    generatedAt: report.generatedAt,
    ramsPolicy: report.ramsPolicy,
    findings: report.findings,
  };
}

export async function runBrandSocialCouncilReport(options = {}) {
  const sessionId = trim(options.sessionId) || `brand-social-council-${crypto.randomUUID()}`;
  const reportPrefix = buildAuditPrefix(AUDIT_TYPE, sessionId);
  const [onBrandBundle, socialBundle, podcastEpisodeBundle, podcastTranscriptBundle] = await Promise.all([
    loadSourceBundle("on-brand", SOURCE_LATEST_KEYS.onBrand),
    loadSourceBundle("social-performance", SOURCE_LATEST_KEYS.socialPerformance),
    loadSourceBundle("podcast-episode", SOURCE_LATEST_KEYS.podcastEpisode),
    loadSourceBundle("podcast-transcript", SOURCE_LATEST_KEYS.podcastTranscript),
  ]);
  const report = buildCouncilReport({ sessionId, reportPrefix, onBrandBundle, socialBundle, podcastEpisodeBundle, podcastTranscriptBundle });
  const html = renderBrandSocialCouncilHtml(report);
  const appendix = repositoryIssueAppendix(report);
  const summary = {
    auditType: AUDIT_TYPE,
    sessionId,
    generatedAt: report.generatedAt,
    executiveVerdict: report.executiveVerdict,
    scores: report.scores,
    findingCount: report.findings.length,
    manualReviewCount: report.findings.filter((finding) => finding.classification === "manual_review").length,
    ramsPolicy: report.ramsPolicy,
    sourceReports: report.sourceReports,
  };
  const coverage = {
    auditType: AUDIT_TYPE,
    sessionId,
    generatedAt: report.generatedAt,
    sourceReports: report.sourceReports,
    coverage: report.coverage,
    councilMembers: report.councilMembers.map((member) => member.role),
  };

  const [reportJson, summaryJson, coverageJson, appendixJson, reportHtml] = await Promise.all([
    publishAuditJson({ key: `${reportPrefix}/report.json`, payload: report }),
    publishAuditJson({ key: `${reportPrefix}/summary.json`, payload: summary }),
    publishAuditJson({ key: `${reportPrefix}/coverage.json`, payload: coverage }),
    publishAuditJson({ key: `${reportPrefix}/repository-issue-appendix.json`, payload: appendix }),
    publishAuditText({ key: `${reportPrefix}/report.html`, text: html, contentType: "text/html; charset=utf-8" }),
  ]);

  const latest = await publishAuditLatest({
    auditType: AUDIT_TYPE,
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
      findingCount: report.findings.length,
      ramsPolicy: report.ramsPolicy,
    },
  });

  return {
    ok: true,
    auditType: AUDIT_TYPE,
    sessionId,
    reportPrefix,
    reportUrl: reportHtml.url,
    reportJsonUrl: reportJson.url,
    summaryUrl: summaryJson.url,
    coverageUrl: coverageJson.url,
    repositoryIssueAppendixUrl: appendixJson.url,
    latestUrl: latest.url,
    findingCount: report.findings.length,
    ramsPolicy: report.ramsPolicy,
  };
}

export function getBrandSocialCouncilStatus() {
  return {
    ok: true,
    auditType: AUDIT_TYPE,
    sourceLatestKeys: SOURCE_LATEST_KEYS,
    output: ["report.html", "report.json", "summary.json", "coverage.json", "repository-issue-appendix.json", "latest.json"],
    ramsPolicy: ramsPolicy(),
  };
}

export const __brandSocialCouncilTestHooks = {
  buildCouncilReport,
  renderBrandSocialCouncilHtml,
};

export default runBrandSocialCouncilReport;
