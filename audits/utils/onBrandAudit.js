import { resilientRequest } from "../../services/shared/utils/ai-service.js";
import { sanitizeSessionId } from "../../services/shared/utils/sessionId.js";
import { buildAuditPrefix, buildLatestKey } from "./auditPaths.js";
import { collectOnBrandEvidence } from "./onBrandEvidence.js";
import { buildOnBrandAuditMessages, buildOnBrandRepairMessages } from "./onBrandPrompts.js";
import { renderOnBrandReportHtml } from "./onBrandReportHtml.js";
import { publishAuditJson, publishAuditText } from "./publishAuditArtifacts.js";
import { info, warn } from "../../logger.js";

const AUDIT_TYPE = "on-brand";
const DEFAULT_LOOKBACK_DAYS = 7;
const REPORT_MAX_TOKENS = Math.max(5000, Number(process.env.ON_BRAND_AUDIT_MAX_TOKENS || 8000));
const REPORT_TEMPERATURE = Number(process.env.ON_BRAND_AUDIT_TEMPERATURE || 0.2);

function nowIso() {
  return new Date().toISOString();
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function cleanString(value, fallback = "Not verified from supplied evidence") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function clampScore(value, fallback = 50) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function jsonCandidate(raw = "") {
  const text = String(raw || "").trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try {
    JSON.parse(text);
    return text;
  } catch {}
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) return text.slice(first, last + 1);
  return text;
}

function parseJsonObject(raw) {
  const parsed = JSON.parse(jsonCandidate(raw));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Model response was not a JSON object");
  }
  return parsed;
}

function sourceCoverageFromEvidence(evidence) {
  return [evidence?.oneUpBlogSocial, evidence?.podcastTranscripts, evidence?.rss]
    .filter(Boolean)
    .map((source) => ({
      sourceType: source.sourceType,
      status: source.status || "partial",
      itemsInspected: arr(source.items).length,
      evidenceMethod: source.evidenceMethod || "Not verified from supplied evidence",
      limitations: arr(source.limitations),
    }));
}

function normaliseSeverity(value) {
  const v = String(value || "").trim().toLowerCase();
  return ["critical", "high", "medium", "low"].includes(v) ? v : "medium";
}

function normaliseConfidence(value) {
  const v = String(value || "").trim().toLowerCase();
  if (["confirmed", "probable", "needs verification"].includes(v)) return v;
  return "needs verification";
}

function normaliseSourceType(value) {
  const v = String(value || "").trim();
  if (["oneup_blog_social", "podcast_transcript", "rss_feed", "pipeline"].includes(v)) return v;
  return "pipeline";
}

function normaliseRootCause(value) {
  const v = String(value || "").trim().toLowerCase();
  if (["content", "prompt", "validator", "source selection", "pipeline", "unknown"].includes(v)) return v;
  if (v.includes("prompt")) return "prompt";
  if (v.includes("validator")) return "validator";
  if (v.includes("source")) return "source selection";
  if (v.includes("pipeline")) return "pipeline";
  return "unknown";
}

function normaliseDefect(issue = {}, index = 0) {
  return {
    issueId: cleanString(issue.issueId, `OB-${String(index + 1).padStart(3, "0")}`),
    severity: normaliseSeverity(issue.severity),
    confidence: normaliseConfidence(issue.confidence),
    sourceType: normaliseSourceType(issue.sourceType),
    itemTitleOrId: cleanString(issue.itemTitleOrId),
    issueType: cleanString(issue.issueType, "On-brand defect"),
    exactEvidence: cleanString(issue.exactEvidence),
    whyItIsOffBrand: cleanString(issue.whyItIsOffBrand),
    violatedRule: cleanString(issue.violatedRule),
    rootCauseLevel: normaliseRootCause(issue.rootCauseLevel),
    exactRemediation: cleanString(issue.exactRemediation),
    improvedExample: String(issue.improvedExample || ""),
    verificationMethod: cleanString(issue.verificationMethod, "Rerun the on-brand audit and confirm the finding is gone."),
  };
}

function mergeDeterministicDefects(modelDefects, deterministicDefects) {
  const merged = [];
  const seen = new Set();
  for (const issue of [...arr(modelDefects), ...arr(deterministicDefects)]) {
    const normalised = normaliseDefect(issue, merged.length);
    const key = `${normalised.sourceType}|${normalised.itemTitleOrId}|${normalised.issueType}|${normalised.exactEvidence}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(normalised);
  }
  return merged;
}

function normaliseObjectArray(rows, keys) {
  return arr(rows).map((row) => {
    const out = {};
    for (const key of keys) out[key] = cleanString(row?.[key], "");
    return out;
  });
}

export function normaliseOnBrandReport(report, evidence, { rawModelError } = {}) {
  const metadata = evidence?.metadata || {};
  const sourceCoverage = sourceCoverageFromEvidence(evidence);
  const deterministicDefects = arr(evidence?.deterministicPreflight);
  const reportObj = report && typeof report === "object" ? report : {};
  const defects = mergeDeterministicDefects(reportObj.confirmedDefectsLedger, deterministicDefects);
  const blockedOrPartial = sourceCoverage.some((source) => source.status !== "complete");
  const completion = blockedOrPartial || rawModelError ? "Partial" : cleanString(reportObj.auditCompletionState, "Complete");

  const limitations = [
    ...arr(reportObj.limitations).map(String),
    ...arr(metadata.blockedSources).flatMap((source) => arr(source.limitations)),
    ...arr(metadata.partialSources).flatMap((source) => arr(source.limitations)),
  ];
  if (rawModelError) limitations.push(`Model audit failed or needed fallback: ${rawModelError}`);

  return {
    auditCompletionState: completion === "Complete" ? "Complete" : "Partial",
    sessionId: cleanString(reportObj.sessionId, metadata.sessionId || "unknown"),
    generatedAt: cleanString(reportObj.generatedAt, nowIso()),
    window: {
      start: cleanString(reportObj.window?.start, metadata.windowStart || ""),
      end: cleanString(reportObj.window?.end, metadata.windowEnd || ""),
      lookbackDays: Number(reportObj.window?.lookbackDays || metadata.lookbackDays || DEFAULT_LOOKBACK_DAYS),
    },
    executiveVerdict: {
      status: cleanString(
        reportObj.executiveVerdict?.status,
        defects.length ? "Partially on-brand with systemic drift" : "Mostly on-brand with minor drift"
      ),
      summary: cleanString(
        reportObj.executiveVerdict?.summary,
        defects.length
          ? "Deterministic checks found brand drift that needs editorial cleanup."
          : "No deterministic defects were found, but source coverage may still be partial."
      ),
      bluntAssessment: cleanString(
        reportObj.executiveVerdict?.bluntAssessment,
        defects.length
          ? "The pipeline is usable, but the flagged copy needs tightening before it sounds fully Jonathan Harris."
          : "The available evidence does not prove a major brand breach."
      ),
    },
    sourceCoverage,
    scorecard: {
      overallBrandFit: clampScore(reportObj.scorecard?.overallBrandFit, defects.length ? 68 : 82),
      rssBrandFit: clampScore(reportObj.scorecard?.rssBrandFit, 70),
      oneUpBlogSocialBrandFit: clampScore(reportObj.scorecard?.oneUpBlogSocialBrandFit, 70),
      podcastTranscriptBrandFit: clampScore(reportObj.scorecard?.podcastTranscriptBrandFit, 70),
      titleQuality: clampScore(reportObj.scorecard?.titleQuality, defects.some((d) => /title/i.test(d.issueType)) ? 60 : 78),
      spokenNaturalness: clampScore(reportObj.scorecard?.spokenNaturalness, defects.some((d) => d.sourceType === "podcast_transcript") ? 62 : 78),
      editorialAuthority: clampScore(reportObj.scorecard?.editorialAuthority, 72),
      antiHypeControl: clampScore(reportObj.scorecard?.antiHypeControl, defects.some((d) => /hype|filler/i.test(d.issueType)) ? 58 : 80),
      implementationReadiness: clampScore(reportObj.scorecard?.implementationReadiness, 82),
    },
    confirmedStrengths: normaliseObjectArray(reportObj.confirmedStrengths, ["sourceType", "evidence", "whyItWorks"]),
    confirmedDefectsLedger: defects,
    rssFindings: {
      verdict: cleanString(reportObj.rssFindings?.verdict, "RSS evidence was inspected where available."),
      titlePatternAnalysis: cleanString(reportObj.rssFindings?.titlePatternAnalysis, "See confirmed defects ledger for title pattern issues."),
      summaryToneAnalysis: cleanString(reportObj.rssFindings?.summaryToneAnalysis, "See confirmed defects ledger for summary tone issues."),
      defects: arr(reportObj.rssFindings?.defects).map(normaliseDefect),
    },
    oneUpBlogSocialFindings: {
      verdict: cleanString(reportObj.oneUpBlogSocialFindings?.verdict, "OneUp/blog/social evidence was inspected where available."),
      postPatternAnalysis: cleanString(reportObj.oneUpBlogSocialFindings?.postPatternAnalysis, "Historic published OneUp retrieval is not confirmed by the existing client."),
      defects: arr(reportObj.oneUpBlogSocialFindings?.defects).map(normaliseDefect),
    },
    podcastTranscriptFindings: {
      verdict: cleanString(reportObj.podcastTranscriptFindings?.verdict, "Podcast transcript evidence was inspected where available."),
      openingStrength: cleanString(reportObj.podcastTranscriptFindings?.openingStrength, "Not verified from supplied evidence"),
      flowAndTransitions: cleanString(reportObj.podcastTranscriptFindings?.flowAndTransitions, "Not verified from supplied evidence"),
      repetitionWatchlist: arr(reportObj.podcastTranscriptFindings?.repetitionWatchlist).map(String),
      spokenWordFixes: normaliseObjectArray(reportObj.podcastTranscriptFindings?.spokenWordFixes, ["originalLine", "improvedLine", "reason"]),
      defects: arr(reportObj.podcastTranscriptFindings?.defects).map(normaliseDefect),
    },
    patternLevelDiagnosis: {
      repeatedTitleProblems: arr(reportObj.patternLevelDiagnosis?.repeatedTitleProblems).map(String),
      repeatedToneProblems: arr(reportObj.patternLevelDiagnosis?.repeatedToneProblems).map(String),
      repeatedSpokenProblems: arr(reportObj.patternLevelDiagnosis?.repeatedSpokenProblems).map(String),
      crossChannelBrandDrift: arr(reportObj.patternLevelDiagnosis?.crossChannelBrandDrift).map(String),
    },
    promptLevelDiagnosis: normaliseObjectArray(reportObj.promptLevelDiagnosis, ["affectedArea", "diagnosis", "evidence", "recommendedPromptChange"]),
    pipelineLevelDiagnosis: normaliseObjectArray(reportObj.pipelineLevelDiagnosis, ["affectedFileOrService", "diagnosis", "evidence", "smallestSafeFix"]),
    rankedRemediationPlan: arr(reportObj.rankedRemediationPlan).map((row, index) => ({
      priority: Number(row?.priority || index + 1),
      severity: cleanString(row?.severity, defects[index]?.severity || "medium"),
      action: cleanString(row?.action, defects[index]?.exactRemediation || "Review confirmed defects and apply the smallest safe copy or validator fix."),
      affectedSource: cleanString(row?.affectedSource, defects[index]?.sourceType || "pipeline"),
      affectedFilesOrServices: arr(row?.affectedFilesOrServices).map(String),
      whyThisComesFirst: cleanString(row?.whyThisComesFirst, "It addresses confirmed evidence rather than speculative rewrite work."),
      implementationNotes: cleanString(row?.implementationNotes, "Use the exact remediation in the confirmed defects ledger."),
      verificationMethod: cleanString(row?.verificationMethod, "Rerun the on-brand audit."),
    })),
    doNotChange: normaliseObjectArray(reportObj.doNotChange, ["area", "reason", "evidence"]),
    limitations: Array.from(new Set(limitations.filter(Boolean))),
  };
}

function deterministicFallbackReport(evidence, errorMessage) {
  return normaliseOnBrandReport({}, evidence, { rawModelError: errorMessage });
}

async function runModelAudit({ sessionId, evidence, dryRun }) {
  if (dryRun) {
    return deterministicFallbackReport(evidence, "dryRun=true; LLM judgement skipped by request.");
  }

  const messages = buildOnBrandAuditMessages({ evidence });
  let raw = "";
  try {
    raw = await resilientRequest("onBrandAudit", {
      sessionId,
      messages,
      max_tokens: REPORT_MAX_TOKENS,
      temperature: REPORT_TEMPERATURE,
      timeoutMs: Number(process.env.ON_BRAND_AUDIT_TIMEOUT_MS || 90000),
    });
    return normaliseOnBrandReport(parseJsonObject(raw), evidence);
  } catch (firstError) {
    warn("audit.on-brand.model.invalid", {
      sessionId,
      message: firstError?.message,
    });
    try {
      const repairRaw = await resilientRequest("onBrandAudit", {
        sessionId: `${sessionId}-repair`,
        messages: buildOnBrandRepairMessages({ raw, evidence }),
        max_tokens: REPORT_MAX_TOKENS,
        temperature: 0.15,
        maxRetries: 0,
        timeoutMs: Number(process.env.ON_BRAND_AUDIT_TIMEOUT_MS || 90000),
      });
      return normaliseOnBrandReport(parseJsonObject(repairRaw), evidence);
    } catch (repairError) {
      return deterministicFallbackReport(
        evidence,
        `Initial model pass: ${firstError?.message || firstError}; repair pass: ${repairError?.message || repairError}`
      );
    }
  }
}

function requestDocument({ sessionId, options, reportPrefix }) {
  return {
    auditType: AUDIT_TYPE,
    sessionId,
    generatedAt: nowIso(),
    reportPrefix,
    options: {
      lookbackDays: options.lookbackDays,
      includeOneUp: options.includeOneUp,
      includePodcastTranscripts: options.includePodcastTranscripts,
      includeRss: options.includeRss,
      dryRun: options.dryRun,
    },
  };
}

export async function runOnBrandAudit(options = {}) {
  const sessionId = sanitizeSessionId(options.sessionId || `${AUDIT_TYPE}-${Date.now()}`, "AUD-ON-BRAND");
  const lookbackDays = Math.max(1, Math.min(31, Number(options.lookbackDays || DEFAULT_LOOKBACK_DAYS)));
  const runOptions = {
    lookbackDays,
    includeOneUp: options.includeOneUp !== false,
    includePodcastTranscripts: options.includePodcastTranscripts !== false,
    includeRss: options.includeRss !== false,
    dryRun: Boolean(options.dryRun),
  };
  const reportPrefix = buildAuditPrefix(AUDIT_TYPE, sessionId);
  const requestPayload = requestDocument({ sessionId, options: runOptions, reportPrefix });

  await publishAuditJson({ key: `${reportPrefix}/request.json`, payload: requestPayload });

  const evidence = await collectOnBrandEvidence({ sessionId, ...runOptions });
  const evidencePublish = await publishAuditJson({ key: `${reportPrefix}/evidence.json`, payload: evidence });
  const report = await runModelAudit({ sessionId, evidence, dryRun: runOptions.dryRun });
  const html = renderOnBrandReportHtml(report);

  const reportJsonPublish = await publishAuditJson({ key: `${reportPrefix}/report.json`, payload: report });
  const reportHtmlPublish = await publishAuditText({ key: `${reportPrefix}/report.html`, text: html, contentType: "text/html; charset=utf-8" });
  const latestPayload = {
    auditType: AUDIT_TYPE,
    sessionId,
    updatedAt: nowIso(),
    reportPrefix,
    reportJsonUrl: reportJsonPublish.url,
    reportHtmlUrl: reportHtmlPublish.url,
    evidenceUrl: evidencePublish.url,
    sourceCoverage: report.sourceCoverage,
    executiveVerdict: report.executiveVerdict,
    partial: report.auditCompletionState !== "Complete",
  };
  const latestPublish = await publishAuditJson({ key: buildLatestKey(AUDIT_TYPE), payload: latestPayload });

  info("audit.on-brand.complete", {
    sessionId,
    partial: latestPayload.partial,
    reportPrefix,
    defects: report.confirmedDefectsLedger.length,
  });

  return {
    ok: true,
    auditType: AUDIT_TYPE,
    sessionId,
    partial: latestPayload.partial || undefined,
    reportJsonUrl: reportJsonPublish.url,
    reportHtmlUrl: reportHtmlPublish.url,
    evidenceUrl: evidencePublish.url,
    latestUrl: latestPublish.url,
    sourceCoverage: report.sourceCoverage,
    executiveVerdict: report.executiveVerdict,
  };
}

export const __testing = {
  jsonCandidate,
  parseJsonObject,
  normaliseOnBrandReport,
  sourceCoverageFromEvidence,
};

export default runOnBrandAudit;
