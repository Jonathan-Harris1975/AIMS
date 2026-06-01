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

function futureVerb(sourceType) {
  if (sourceType === "podcast_transcript") return "future podcast transcript output";
  if (sourceType === "rss_feed") return "future RSS feed output";
  if (sourceType === "oneup_blog_social") return "future OneUp/blog/social output";
  return "future pipeline output";
}

function futureRemediation(text = "", sourceType = "pipeline") {
  const cleaned = String(text || "").trim();
  const fallback = `Use this evidence to tune ${futureVerb(sourceType)} and rerun the audit.`;
  if (!cleaned) return fallback;
  if (/\b(future|next generated|future-generated|going forward)\b/i.test(cleaned)) return cleaned;
  return `For ${futureVerb(sourceType)}, ${cleaned.charAt(0).toLowerCase()}${cleaned.slice(1)}`;
}

function futureVerification(text = "", sourceType = "pipeline") {
  const cleaned = String(text || "").trim();
  const fallback = `Generate fresh ${futureVerb(sourceType)} and rerun the on-brand audit to confirm the pattern has not recurred.`;
  if (!cleaned) return fallback;
  if (/\b(future|fresh|newly generated|next generated)\b/i.test(cleaned)) return cleaned;
  return `${cleaned} Treat historic examples as calibration evidence; verify against newly generated output.`;
}

function futureFrameText(value = "", fallback = "") {
  let text = String(value ?? "").trim();
  if (!text) text = String(fallback ?? "").trim();
  if (!text) return "";

  const replacements = [
    [/\bConfirmed defects ledger\b/gi, "Future QA findings ledger"],
    [/\bconfirmed defects?\b/gi, "future QA findings"],
    [/\bExact fix\b/gi, "Future guardrail"],
    [/\bexact remediation\b/gi, "future guardrail"],
    [/\bRanked remediation plan\b/gi, "Ranked future QA refinement plan"],
    [/\bremediation plan\b/gi, "future QA refinement plan"],
    [/\bremediation\b/gi, "future QA refinement"],
    [/\bneeds? editorial cleanup\b/gi, "should inform future editorial QA tightening"],
    [/\bneeds? cleanup\b/gi, "should inform future QA tightening"],
    [/\bcopy needs tightening before it sounds fully Jonathan Harris\b/gi, "examples provide calibration for improving future Jonathan Harris output"],
    [/\bflagged copy needs tightening\b/gi, "flagged examples should tighten future QA guardrails"],
    [/\bfix(?:ed|es)? the old\b/gi, "use the historic"],
    [/\brewrite old posts?\b/gi, "calibrate future posts"],
    [/\brewrite old transcripts?\b/gi, "calibrate future transcripts"],
    [/\bconfirm(?:ed)?(?: that)? the exact phrase no longer appears\b/gi, "confirm fresh output avoids the pattern"],
    [/\bno longer appears\b/gi, "does not recur in fresh output"],
    [/\bremove the phrase from the existing copy\b/gi, "prevent the phrase recurring in future output"],
    [/\bclean up\b/gi, "tighten future QA for"],
  ];
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

function extractPhraseTokens(value = "") {
  return String(value || "")
    .split(/[,;\n]+/)
    .map((token) => token.trim().replace(/^['"`]+|['"`]+$/g, ""))
    .filter(Boolean);
}

function phraseEvidenceList(issues = []) {
  const seen = new Set();
  const phrases = [];
  for (const issue of issues) {
    for (const token of extractPhraseTokens(issue.exactEvidence)) {
      const key = token.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      phrases.push(token);
    }
  }
  return phrases;
}

function groupPhraseGuardrailDefects(defects = []) {
  const grouped = new Map();
  const passthrough = [];

  for (const issue of arr(defects)) {
    const isPhraseIssue = /anti-hype phrase guardrail|anti-hype hedging|hedging phrase|corporate filler|hype leakage/i.test(`${issue.issueType} ${issue.violatedRule}`);
    if (!isPhraseIssue) {
      passthrough.push(issue);
      continue;
    }
    const key = `${issue.sourceType}|${issue.itemTitleOrId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(issue);
  }

  const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };
  const groupedIssues = Array.from(grouped.values()).map((issues) => {
    const first = issues[0] || {};
    const phrases = phraseEvidenceList(issues);
    const phraseList = phrases.map((phrase) => `'${phrase}'`).join(", ") || first.exactEvidence || "generic hype/filler wording";
    const worst = [...issues].sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9))[0] || first;
    return {
      ...first,
      issueType: "future anti-hype phrase guardrail",
      severity: worst.severity || "medium",
      confidence: "confirmed",
      exactEvidence: phraseList,
      whyItIsOffBrand: `Historic evidence contains ${phrases.length || issues.length} AI/newsroom filler pattern(s). Treat this as calibration for future output, not a retroactive copy-edit ticket.`,
      violatedRule: "No hype, no corporate wallpaper, no generic AI summary tone.",
      rootCauseLevel: "validator",
      exactRemediation: `For ${futureVerb(first.sourceType)}, add or tighten a grouped anti-hype guardrail covering ${phraseList}; require the generator to replace those patterns with concrete facts, risks, or consequences.`,
      improvedExample: "",
      verificationMethod: `Generate fresh ${futureVerb(first.sourceType)} and rerun the audit; the grouped anti-hype pattern should not recur.`,
    };
  });

  return [...passthrough, ...groupedIssues].map((issue, index) => ({
    ...issue,
    issueId: `OB-${String(index + 1).padStart(3, "0")}`,
  }));
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
    whyItIsOffBrand: futureFrameText(cleanString(issue.whyItIsOffBrand)),
    violatedRule: futureFrameText(cleanString(issue.violatedRule)),
    rootCauseLevel: normaliseRootCause(issue.rootCauseLevel),
    exactRemediation: futureRemediation(issue.exactRemediation, normaliseSourceType(issue.sourceType)),
    improvedExample: futureFrameText(String(issue.improvedExample || "")),
    verificationMethod: futureVerification(issue.verificationMethod, normaliseSourceType(issue.sourceType)),
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
  return groupPhraseGuardrailDefects(merged);
}

function normaliseObjectArray(rows, keys, { futureFrame = false } = {}) {
  return arr(rows).map((row) => {
    const out = {};
    for (const key of keys) {
      const value = cleanString(row?.[key], "");
      out[key] = futureFrame ? futureFrameText(value) : value;
    }
    return out;
  });
}

function normaliseExistingDefects(rows = []) {
  return groupPhraseGuardrailDefects(arr(rows).map((issue, index) => normaliseDefect(issue, index)));
}

function defectsForSource(defects = [], sourceType) {
  return arr(defects).filter((issue) => issue.sourceType === sourceType);
}

function hasMethod(sourceCoverage = [], sourceType, fragment) {
  const source = arr(sourceCoverage).find((row) => row.sourceType === sourceType);
  return source?.status === "complete" && String(source.evidenceMethod || "").toLowerCase().includes(fragment.toLowerCase());
}

function deriveConfirmedStrengths(sourceCoverage = []) {
  const strengths = [];
  if (hasMethod(sourceCoverage, "oneup_blog_social", "getpublishedposts")) {
    strengths.push({
      sourceType: "oneup_blog_social",
      evidence: "Historic published-post retrieval completed through OneUp getpublishedposts.",
      whyItWorks: "The audit is checking real published social/blog output rather than scheduled drafts only.",
    });
  }
  if (hasMethod(sourceCoverage, "podcast_transcript", "transcript-body extraction")) {
    strengths.push({
      sourceType: "podcast_transcript",
      evidence: "Transcript discovery reads the latest .html or .txt object and reduces HTML pages to the transcript body.",
      whyItWorks: "Navigation chrome and website boilerplate are kept out of the brand judgement.",
    });
  }
  if (arr(sourceCoverage).some((row) => row.sourceType === "rss_feed" && row.status === "complete")) {
    strengths.push({
      sourceType: "rss_feed",
      evidence: "RSS evidence was loaded successfully for the lookback window.",
      whyItWorks: "The audit can compare public feed output against the existing RSS brand rules.",
    });
  }
  return strengths;
}

function defaultRssFindings(defects, sourceCoverage) {
  const rssDefects = defectsForSource(defects, "rss_feed");
  return {
    verdict: rssDefects.length
      ? "RSS evidence was inspected; the confirmed patterns should inform future feed wording and generation guardrails."
      : "RSS evidence was inspected and no deterministic future-output risks were found.",
    titlePatternAnalysis: rssDefects.some((issue) => /title/i.test(issue.issueType))
      ? "At least one RSS title pattern issue was confirmed in the ledger."
      : "No deterministic RSS title pattern issues were found.",
    summaryToneAnalysis: rssDefects.some((issue) => /summary|filler|hype|metadata|wrapper|validator/i.test(`${issue.issueType} ${issue.whyItIsOffBrand}`))
      ? "At least one RSS summary or validator issue was confirmed in the ledger."
      : "No deterministic RSS summary tone issues were found.",
    defects: rssDefects,
  };
}

function defaultOneUpFindings(defects, sourceCoverage) {
  const oneUpDefects = defectsForSource(defects, "oneup_blog_social");
  const historyConfirmed = hasMethod(sourceCoverage, "oneup_blog_social", "getpublishedposts");
  return {
    verdict: oneUpDefects.length
      ? "OneUp/blog/social published evidence was inspected; the confirmed patterns should inform future post generation and scheduling QA."
      : "OneUp/blog/social published evidence was inspected and no deterministic future-output risks were found.",
    postPatternAnalysis: historyConfirmed
      ? "Historic published OneUp retrieval is confirmed via getpublishedposts; the audit is no longer limited to scheduled posts."
      : "Historic published OneUp retrieval was not confirmed in this run; check source coverage limitations.",
    defects: oneUpDefects,
  };
}

function defaultPodcastFindings(defects, sourceCoverage) {
  const podcastDefects = defectsForSource(defects, "podcast_transcript");
  return {
    verdict: podcastDefects.length
      ? "Podcast transcript evidence was inspected; the confirmed patterns should inform future transcript layout, spoken-copy shaping, and TTS QA."
      : "Podcast transcript evidence was inspected and no deterministic future transcript risks were found.",
    openingStrength: podcastDefects.some((issue) => /opening|overlong|hype|filler/i.test(issue.issueType))
      ? "Future opening/body copy should avoid the patterns listed in the ledger."
      : "No deterministic future opening risk was confirmed from the supplied excerpts.",
    flowAndTransitions: podcastDefects.some((issue) => /transition|sequencing|overlong/i.test(issue.issueType))
      ? "Future scripts should tighten long sentence shapes and repeated transitions where listed in the ledger."
      : "No deterministic future transition or sequencing risk was confirmed from the supplied excerpts.",
    repetitionWatchlist: podcastDefects
      .filter((issue) => /repeated transition/i.test(issue.issueType))
      .map((issue) => issue.exactEvidence),
    spokenWordFixes: podcastDefects
      .filter((issue) => /overlong podcast sentence/i.test(issue.issueType))
      .slice(0, 5)
      .map((issue) => ({
        originalLine: issue.exactEvidence,
        improvedLine: "For future transcript output, split this into two shorter spoken lines and cut any abstract padding.",
        reason: issue.whyItIsOffBrand,
      })),
    defects: podcastDefects,
  };
}

function derivePatternDiagnosis(defects = []) {
  return {
    repeatedTitleProblems: Array.from(new Set(defects.filter((issue) => /title|headline/i.test(issue.issueType)).map((issue) => issue.issueType))),
    repeatedToneProblems: Array.from(new Set(defects.filter((issue) => /hype|filler|corporate|american/i.test(issue.issueType)).map((issue) => issue.exactEvidence))),
    repeatedSpokenProblems: Array.from(new Set(defects.filter((issue) => issue.sourceType === "podcast_transcript").map((issue) => issue.issueType))),
    crossChannelBrandDrift: Array.from(new Set(defects.map((issue) => issue.violatedRule).filter(Boolean))).slice(0, 6),
  };
}

function derivePipelineDiagnosis(defects = []) {
  const rows = [];
  if (defects.some((issue) => issue.sourceType === "rss_feed" && /validator/i.test(issue.rootCauseLevel))) {
    rows.push({
      affectedFileOrService: "services/rss-feed-creator/utils/rss-prompts.js",
      diagnosis: "The RSS validator is catching banned filler; use this evidence to keep future feed wording tighter.",
      evidence: "RSS validator finding appears in the future QA findings ledger.",
      smallestSafeFix: "Keep the validator blocking and tighten the future rewrite retry prompt only if the same phrase recurs in fresh output.",
    });
  }
  if (defects.some((issue) => issue.sourceType === "podcast_transcript" && /hype|filler|overlong|transition/i.test(issue.issueType))) {
    rows.push({
      affectedFileOrService: "services/script/utils/editAndFormat.js",
      diagnosis: "Podcast transcript evidence contains phrases or sentence shapes that future scripts should avoid for spoken delivery.",
      evidence: "Podcast transcript issues appear in the future QA findings ledger.",
      smallestSafeFix: "Tighten the future transcript QA/editorial pass; do not alter the wider podcast route structure.",
    });
  }
  return rows;
}

function deriveRemediationPlan(defects = []) {
  const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...arr(defects)]
    .sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9))
    .slice(0, 8)
    .map((issue, index) => ({
      priority: index + 1,
      severity: issue.severity,
      action: futureRemediation(issue.exactRemediation, issue.sourceType),
      affectedSource: issue.sourceType,
      affectedFilesOrServices: issue.sourceType === "rss_feed"
        ? ["services/rss-feed-creator/utils/rss-prompts.js", "services/rss-feed-creator/utils/feedGenerator.js"]
        : issue.sourceType === "podcast_transcript"
          ? ["services/script/utils/editAndFormat.js", "services/script/utils/promptTemplates.js"]
          : ["services/oneup/utils/prompts.js", "services/oneup/utils/socialScheduler.js"],
      whyThisComesFirst: "It is backed by confirmed evidence in the QA ledger and improves future generated output rather than rewriting history.",
      implementationNotes: `Use ${issue.issueId} as a future-output guardrail: ${issue.issueType}.`,
      verificationMethod: futureVerification(issue.verificationMethod, issue.sourceType),
    }));
}

export function normaliseOnBrandReport(report, evidence, { rawModelError } = {}) {
  const metadata = evidence?.metadata || {};
  const sourceCoverage = sourceCoverageFromEvidence(evidence);
  const deterministicDefects = arr(evidence?.deterministicPreflight);
  const reportObj = report && typeof report === "object" ? report : {};
  const defects = mergeDeterministicDefects(reportObj.confirmedDefectsLedger, deterministicDefects);
  const rssDefaults = defaultRssFindings(defects, sourceCoverage);
  const oneUpDefaults = defaultOneUpFindings(defects, sourceCoverage);
  const podcastDefaults = defaultPodcastFindings(defects, sourceCoverage);
  const derivedPatterns = derivePatternDiagnosis(defects);
  const derivedPipeline = derivePipelineDiagnosis(defects);
  const derivedPlan = deriveRemediationPlan(defects);
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
        futureFrameText(reportObj.executiveVerdict?.summary),
        defects.length
          ? "Deterministic checks found patterns to tighten in future generated output."
          : "No deterministic future-output risks were found, but source coverage may still be partial."
      ),
      bluntAssessment: cleanString(
        futureFrameText(reportObj.executiveVerdict?.bluntAssessment),
        defects.length
          ? "The QA loop is working: use these historic examples to improve future social posts, podcast transcripts, and RSS wording."
          : "The available evidence does not prove a major future-output brand risk."
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
    confirmedStrengths: (() => {
      const rows = normaliseObjectArray(reportObj.confirmedStrengths, ["sourceType", "evidence", "whyItWorks"]);
      return rows.length ? rows : deriveConfirmedStrengths(sourceCoverage);
    })(),
    confirmedDefectsLedger: defects,
    rssFindings: {
      verdict: cleanString(futureFrameText(reportObj.rssFindings?.verdict), rssDefaults.verdict),
      titlePatternAnalysis: cleanString(futureFrameText(reportObj.rssFindings?.titlePatternAnalysis), rssDefaults.titlePatternAnalysis),
      summaryToneAnalysis: cleanString(futureFrameText(reportObj.rssFindings?.summaryToneAnalysis), rssDefaults.summaryToneAnalysis),
      defects: arr(reportObj.rssFindings?.defects).length ? normaliseExistingDefects(reportObj.rssFindings.defects) : rssDefaults.defects,
    },
    oneUpBlogSocialFindings: {
      verdict: cleanString(futureFrameText(reportObj.oneUpBlogSocialFindings?.verdict), oneUpDefaults.verdict),
      postPatternAnalysis: cleanString(futureFrameText(reportObj.oneUpBlogSocialFindings?.postPatternAnalysis), oneUpDefaults.postPatternAnalysis),
      defects: arr(reportObj.oneUpBlogSocialFindings?.defects).length ? normaliseExistingDefects(reportObj.oneUpBlogSocialFindings.defects) : oneUpDefaults.defects,
    },
    podcastTranscriptFindings: {
      verdict: cleanString(futureFrameText(reportObj.podcastTranscriptFindings?.verdict), podcastDefaults.verdict),
      openingStrength: cleanString(futureFrameText(reportObj.podcastTranscriptFindings?.openingStrength), podcastDefaults.openingStrength),
      flowAndTransitions: cleanString(futureFrameText(reportObj.podcastTranscriptFindings?.flowAndTransitions), podcastDefaults.flowAndTransitions),
      repetitionWatchlist: arr(reportObj.podcastTranscriptFindings?.repetitionWatchlist).length
        ? arr(reportObj.podcastTranscriptFindings.repetitionWatchlist).map(String)
        : podcastDefaults.repetitionWatchlist,
      spokenWordFixes: arr(reportObj.podcastTranscriptFindings?.spokenWordFixes).length
        ? normaliseObjectArray(reportObj.podcastTranscriptFindings.spokenWordFixes, ["originalLine", "improvedLine", "reason"])
        : podcastDefaults.spokenWordFixes,
      defects: arr(reportObj.podcastTranscriptFindings?.defects).length ? normaliseExistingDefects(reportObj.podcastTranscriptFindings.defects) : podcastDefaults.defects,
    },
    patternLevelDiagnosis: {
      repeatedTitleProblems: arr(reportObj.patternLevelDiagnosis?.repeatedTitleProblems).length ? arr(reportObj.patternLevelDiagnosis.repeatedTitleProblems).map(String) : derivedPatterns.repeatedTitleProblems,
      repeatedToneProblems: arr(reportObj.patternLevelDiagnosis?.repeatedToneProblems).length ? arr(reportObj.patternLevelDiagnosis.repeatedToneProblems).map(String) : derivedPatterns.repeatedToneProblems,
      repeatedSpokenProblems: arr(reportObj.patternLevelDiagnosis?.repeatedSpokenProblems).length ? arr(reportObj.patternLevelDiagnosis.repeatedSpokenProblems).map(String) : derivedPatterns.repeatedSpokenProblems,
      crossChannelBrandDrift: arr(reportObj.patternLevelDiagnosis?.crossChannelBrandDrift).length ? arr(reportObj.patternLevelDiagnosis.crossChannelBrandDrift).map(String) : derivedPatterns.crossChannelBrandDrift,
    },
    promptLevelDiagnosis: normaliseObjectArray(reportObj.promptLevelDiagnosis, ["affectedArea", "diagnosis", "evidence", "recommendedPromptChange"], { futureFrame: true }),
    pipelineLevelDiagnosis: (() => {
      const rows = normaliseObjectArray(reportObj.pipelineLevelDiagnosis, ["affectedFileOrService", "diagnosis", "evidence", "smallestSafeFix"], { futureFrame: true });
      return rows.length ? rows : derivedPipeline;
    })(),
    rankedRemediationPlan: arr(reportObj.rankedRemediationPlan).length ? arr(reportObj.rankedRemediationPlan).map((row, index) => ({
      priority: Number(row?.priority || index + 1),
      severity: cleanString(row?.severity, defects[index]?.severity || "medium"),
      action: futureFrameText(cleanString(row?.action, defects[index]?.exactRemediation || "Use the future QA findings as guardrails for the next generated output.")),
      affectedSource: cleanString(row?.affectedSource, defects[index]?.sourceType || "pipeline"),
      affectedFilesOrServices: arr(row?.affectedFilesOrServices).map(String),
      whyThisComesFirst: futureFrameText(cleanString(row?.whyThisComesFirst, "It addresses future-output evidence rather than speculative rewrite work.")),
      implementationNotes: futureFrameText(cleanString(row?.implementationNotes, "Use the future QA finding as a future-output guardrail.")),
      verificationMethod: futureVerification(futureFrameText(cleanString(row?.verificationMethod, "Generate fresh output and rerun the on-brand audit.")), cleanString(row?.affectedSource, defects[index]?.sourceType || "pipeline")),
    })) : derivedPlan,
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

  // summary.json and coverage.json are required by the RAMS audit_reader
  // _PIPELINE_ARTEFACT_PRIORITIES["on-brand"] list. Omitting them causes
  // silent artefactErrors gaps in RAMS finding dereferencing.
  const summaryPayload = {
    auditType: AUDIT_TYPE,
    sessionId,
    generatedAt: nowIso(),
    reportPrefix,
    auditCompletionState: report.auditCompletionState,
    executiveVerdict: report.executiveVerdict,
    scorecard: report.scorecard,
    defectCount: report.confirmedDefectsLedger.length,
    partial: report.auditCompletionState !== "Complete",
  };
  const coveragePayload = {
    auditType: AUDIT_TYPE,
    sessionId,
    generatedAt: nowIso(),
    reportPrefix,
    sourceCoverage: report.sourceCoverage,
    limitations: report.limitations,
    partial: report.auditCompletionState !== "Complete",
  };
  const [summaryPublish, coveragePublish] = await Promise.all([
    publishAuditJson({ key: `${reportPrefix}/summary.json`, payload: summaryPayload }),
    publishAuditJson({ key: `${reportPrefix}/coverage.json`, payload: coveragePayload }),
  ]);

  const latestPayload = {
    auditType: AUDIT_TYPE,
    sessionId,
    updatedAt: nowIso(),
    reportPrefix,
    reportJsonUrl: reportJsonPublish.url,
    reportHtmlUrl: reportHtmlPublish.url,
    evidenceUrl: evidencePublish.url,
    summaryUrl: summaryPublish.url,
    coverageUrl: coveragePublish.url,
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
    summaryUrl: summaryPublish.url,
    coverageUrl: coveragePublish.url,
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
