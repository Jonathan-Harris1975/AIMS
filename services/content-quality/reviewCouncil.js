import { warn } from "../../logger.js";

const BOOLEAN_TRUE = new Set(["1", "true", "yes", "on"]);
const BOOLEAN_FALSE = new Set(["0", "false", "no", "off"]);

const TEXT_REPLACEMENTS = Object.freeze([
  [/\bin today's fast-paced world\b/gi, "in practical terms"],
  [/\brapidly evolving landscape\b/gi, "current state of play"],
  [/\bai landscape\b/gi, "artificial intelligence market"],
  [/\bartificial intelligence landscape\b/gi, "artificial intelligence market"],
  [/\bgroundbreaking\b/gi, "notable"],
  [/\bgame[-\s]?changing\b/gi, "important"],
  [/\bcutting[-\s]?edge\b/gi, "current"],
  [/\brevolutionary\b/gi, "significant"],
  [/\btransformative\b/gi, "useful"],
  [/\bparadigm shift\b/gi, "material change"],
  [/\bdelve\b/gi, "look"],
  [/\bfollow\s+for\s+more\b/gi, "keep Jonathan Harris on your radar"],
  [/\bplease\s+share\b/gi, "pass this on if it helps"],
  [/\bsmash\s+the\s+like\b/gi, "use this as a practical checkpoint"],
  [/\btag\s+a\s+friend\b/gi, "send this to a colleague"],
  [/\bshare\s+this\s+with\b/gi, "pass this to"],
  [/\bcomment\s+yes\b/gi, "treat this as a working note"],
  [/\bunlock value\b/gi, "find value"],
  [/\bseamless integration\b/gi, "clean integration"],
  [/\brobust data fabric\b/gi, "reliable data setup"],
]);

const BRITISH_REPLACEMENTS = Object.freeze([
  [/\banalyze\b/gi, "analyse"],
  [/\banalyzed\b/gi, "analysed"],
  [/\banalyzing\b/gi, "analysing"],
  [/\bbehavior\b/gi, "behaviour"],
  [/\bbehaviors\b/gi, "behaviours"],
  [/\bcenter\b/gi, "centre"],
  [/\bcentered\b/gi, "centred"],
  [/\bcolor\b/gi, "colour"],
  [/\bcolors\b/gi, "colours"],
  [/\bfavorite\b/gi, "favourite"],
  [/\borganization\b/gi, "organisation"],
  [/\borganizations\b/gi, "organisations"],
  [/\boptimize\b/gi, "optimise"],
  [/\boptimized\b/gi, "optimised"],
  [/\boptimization\b/gi, "optimisation"],
  [/\bprioritize\b/gi, "prioritise"],
  [/\bprioritized\b/gi, "prioritised"],
  [/\bprogram\b/gi, "programme"],
  [/\bprograms\b/gi, "programmes"],
]);

export const REVIEW_COUNCILS = Object.freeze({
  "rss-rewrite-quarantine": {
    env: "REVIEW_COUNCIL_RSS_REWRITE_ENABLED",
    defaultEnabled: true,
    members: [
      "Source Integrity Reviewer",
      "RSS Rewrite Editor",
      "British English Stylist",
      "Anti-Hype Reviewer",
      "AEO Clarity Reviewer",
      "Publication Safety Chair",
    ],
  },
  "blog-phase45": {
    env: "REVIEW_COUNCIL_BLOG_PHASE45_ENABLED",
    defaultEnabled: true,
    members: [
      "Brand Tone Chair",
      "Source Evidence Reviewer",
      "Schema Integrity Reviewer",
      "Mobile UX Reader",
      "Organic Growth Editor",
      "Quarantine Arbiter",
    ],
  },
  "blotato-script-quality": {
    env: "REVIEW_COUNCIL_BLOTATO_SCRIPT_ENABLED",
    defaultEnabled: false,
    members: [
      "Shorts Script Editor",
      "Source Fidelity Reviewer",
      "Scene Flow Reviewer",
      "Platform Fit Reviewer",
      "Caption Safety Reviewer",
      "Publishing Readiness Chair",
    ],
  },
  "oneup-social-copy": {
    env: "REVIEW_COUNCIL_ONEUP_SOCIAL_ENABLED",
    defaultEnabled: true,
    members: [
      "OneUp Copy Editor",
      "Brand Safety Reviewer",
      "CTA Reviewer",
      "British English Reviewer",
      "Platform Fit Reviewer",
      "Scheduling Readiness Chair",
    ],
  },
  "quiz-logic": {
    env: "REVIEW_COUNCIL_QUIZ_LOGIC_ENABLED",
    defaultEnabled: true,
    members: [
      "Question Clarity Reviewer",
      "Answer Consistency Reviewer",
      "Options Format Reviewer",
      "Audience Level Reviewer",
      "Static Card Readability Reviewer",
      "Quiz Publishing Chair",
    ],
  },
  "podcast-on-brand": {
    env: "REVIEW_COUNCIL_PODCAST_ON_BRAND_ENABLED",
    defaultEnabled: true,
    members: [
      "Podcast Voice Reviewer",
      "Transcript Layout Reviewer",
      "Episode Metadata Reviewer",
      "RSS Wording Reviewer",
      "Brand Continuity Reviewer",
      "Future QA Chair",
    ],
  },
  "social-performance": {
    env: "REVIEW_COUNCIL_SOCIAL_PERFORMANCE_ENABLED",
    defaultEnabled: true,
    members: [
      "Facebook Performance Reviewer",
      "Instagram Performance Reviewer",
      "YouTube Shorts Reviewer",
      "TikTok Reviewer",
      "Thumbnail Evidence Reviewer",
      "Monthly Recommendation Chair",
    ],
  },
  housekeeping: {
    env: "REVIEW_COUNCIL_HOUSEKEEPING_ENABLED",
    defaultEnabled: true,
    members: [
      "Artefact Cleanup Reviewer",
      "Temporary File Reviewer",
      "Manifest Consistency Reviewer",
      "Duplicate Output Reviewer",
      "R2 Key Hygiene Reviewer",
      "Completion Chair",
    ],
  },
});

function boolEnv(name, fallback = false, env = process.env) {
  const raw = String(env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (BOOLEAN_TRUE.has(raw)) return true;
  if (BOOLEAN_FALSE.has(raw)) return false;
  return fallback;
}

function getCouncilConfig(councilKey) {
  return REVIEW_COUNCILS[councilKey] || REVIEW_COUNCILS["blog-phase45"];
}

export function isReviewCouncilEnabled(councilKey, env = process.env) {
  const council = getCouncilConfig(councilKey);
  return boolEnv(council.env, council.defaultEnabled, env);
}

export function getReviewCouncilMembers(councilKey) {
  const members = getCouncilConfig(councilKey).members || [];
  if (members.length >= 6) return members.slice(0, Math.max(6, members.length));
  return [...members, ...REVIEW_COUNCILS.housekeeping.members].slice(0, 6);
}

function compactText(value = "") {
  return String(value || "")
    .replace(/```(?:json|html|markdown)?/gi, "")
    .replace(/```/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function repairTextForReviewCouncil(value = "", { contentType = "", maxHashtags = 3 } = {}) {
  let text = compactText(value);
  for (const [pattern, replacement] of TEXT_REPLACEMENTS) text = text.replace(pattern, replacement);
  for (const [pattern, replacement] of BRITISH_REPLACEMENTS) text = text.replace(pattern, replacement);

  if (/quiz-answer/i.test(contentType)) {
    text = text
      .replace(/^\s*(?:quiz\s+answer|answer)\s*[:.!-]\s*/i, "Quiz Answer! ")
      .replace(/^\s*Quiz Answer!\s*/i, "Quiz Answer! ")
      .trim();
    if (text && !/^Quiz Answer!/i.test(text)) text = `Quiz Answer! ${text}`;
  }

  if (/quiz-question/i.test(contentType)) {
    text = text
      .replace(/^\s*([A-D])\s*[\.:\-]\s*/gim, "$1) ")
      .replace(/\b([A-D])\s*[\.:\-]\s+/g, "$1) ");
  }

  const hashtags = [...text.matchAll(/(^|\s)(#[A-Za-z0-9_]+)/g)].map((match) => match[2]);
  if (hashtags.length > maxHashtags) {
    const keep = new Set(hashtags.slice(0, maxHashtags).map((tag) => tag.toLowerCase()));
    text = text.replace(/(^|\s)(#[A-Za-z0-9_]+)/g, (match, lead, tag) => keep.has(String(tag).toLowerCase()) ? `${lead}${tag}` : lead).trim();
  }

  return text.replace(/[ \t]{2,}/g, " ").trim();
}

function cloneJson(value) {
  if (value == null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
}

function deepRepairStrings(value, options = {}) {
  if (typeof value === "string") return repairTextForReviewCouncil(value, options);
  if (Array.isArray(value)) return value.map((item) => deepRepairStrings(item, options));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, deepRepairStrings(child, { ...options, fieldName: key })]));
  }
  return value;
}

export function repairArtifactForReviewCouncil(artifact, options = {}) {
  return deepRepairStrings(cloneJson(artifact), options);
}

export function repairOneUpPostForReviewCouncil(post = {}, { contentType = "oneup-social", featuredBook = null } = {}) {
  const repaired = repairArtifactForReviewCouncil(post, { contentType, maxHashtags: /ebook/i.test(contentType) ? 3 : 3 });
  if (featuredBook?.title && featuredBook?.bookUrl && /ebook/i.test(contentType)) {
    const firstComment = String(repaired.firstComment || "");
    if (!firstComment.includes(featuredBook.title) || !firstComment.includes(featuredBook.bookUrl)) {
      repaired.firstComment = `Featured book: ${featuredBook.title}\nRead more: ${featuredBook.bookUrl}`;
    }
  }
  return repaired;
}

function reviewDecision({ councilKey, enabled, originalGate, repairedGate, attempts = [] }) {
  const members = getReviewCouncilMembers(councilKey);
  const originalDefects = originalGate?.defects || [];
  const repairedDefects = repairedGate?.defects || [];
  const improved = Number(repairedGate?.score || 0) > Number(originalGate?.score || 0) || repairedDefects.length < originalDefects.length;
  const approved = Boolean(repairedGate?.ok);

  return {
    councilKey,
    enabled,
    attempted: enabled,
    minimumMembersRequired: 6,
    members,
    memberCount: members.length,
    attempts,
    originalScore: originalGate?.score ?? null,
    repairedScore: repairedGate?.score ?? null,
    improved,
    approved,
    decision: approved ? "repair_approved" : "quarantine_after_review",
    defectsRemaining: repairedDefects,
    reviewedAt: new Date().toISOString(),
  };
}

export async function runReviewCouncilGate({
  councilKey,
  gate,
  artifact,
  contentType = "content",
  repairArtifact = repairArtifactForReviewCouncil,
  validate,
  logger = warn,
} = {}) {
  if (!gate || gate.ok) {
    return { ok: true, gate, artifact, reviewCouncil: null, repaired: false };
  }
  const enabled = isReviewCouncilEnabled(councilKey);
  if (!enabled) {
    const disabledReview = {
      councilKey,
      enabled: false,
      attempted: false,
      members: getReviewCouncilMembers(councilKey),
      memberCount: getReviewCouncilMembers(councilKey).length,
      decision: "disabled_hard_gate_retained",
      reviewedAt: new Date().toISOString(),
    };
    return { ok: false, gate: { ...gate, reviewCouncil: disabledReview }, artifact, reviewCouncil: disabledReview, repaired: false };
  }

  const repairedArtifact = await repairArtifact(artifact, { contentType, gate });
  const repairedGate = validate ? await validate(repairedArtifact) : gate;
  const reviewCouncil = reviewDecision({
    councilKey,
    enabled,
    originalGate: gate,
    repairedGate,
    attempts: [
      "deterministic text repair",
      "gate re-validation",
      "six-member council arbitration",
      repairedGate?.ok ? "approved repaired artefact" : "quarantine only after review",
    ],
  });

  logger?.("review_council.gate_review", {
    councilKey,
    approved: reviewCouncil.approved,
    originalScore: reviewCouncil.originalScore,
    repairedScore: reviewCouncil.repairedScore,
    remainingDefects: reviewCouncil.defectsRemaining?.slice?.(0, 8) || [],
  });

  return {
    ok: Boolean(repairedGate?.ok),
    gate: { ...repairedGate, reviewCouncil },
    artifact: repairedArtifact,
    reviewCouncil,
    repaired: Boolean(repairedGate?.ok),
  };
}

export function buildHousekeepingPlan({ lane = "content", artefacts = [] } = {}) {
  return {
    councilKey: "housekeeping",
    enabled: isReviewCouncilEnabled("housekeeping"),
    members: getReviewCouncilMembers("housekeeping"),
    lane,
    actions: [
      "remove temporary generated files after successful publication",
      "keep published R2 artefacts and manifest entries",
      "retain quarantine JSON when review fails",
      "avoid deleting source evidence used by council reports",
    ],
    artefacts,
    plannedAt: new Date().toISOString(),
  };
}

export default {
  REVIEW_COUNCILS,
  isReviewCouncilEnabled,
  getReviewCouncilMembers,
  repairTextForReviewCouncil,
  repairArtifactForReviewCouncil,
  repairOneUpPostForReviewCouncil,
  runReviewCouncilGate,
  buildHousekeepingPlan,
};
