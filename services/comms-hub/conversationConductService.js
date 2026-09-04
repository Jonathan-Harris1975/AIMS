import { normaliseUntrustedText } from "./domain/promptSecurity.js";

const PROFANITY_PATTERNS = Object.freeze([
  { key: "strong_profanity", severity: 2, regex: new RegExp("\\b(?:f+(?:u+)?c+k+(?:ing|ed|er|ers|off)?|m+o+t+h+e+r+f+(?:u+)?c+k+e+r+s?|c+u+n+t+s?|a+s+s+h+o+l+e+s?|\
a+r+s+e+h+o+l+e+s?|d+i+c+k+h+e+a+d+s?|w+a+n+k+e+r+s?)\\b", "i") },
  { key: "profanity", severity: 1, regex: /\b(?:s+h+(?:i+)?t+(?:ty|ting|ted)?|b+a+s+t+a+r+d+s?|b+o+l+l+o+c+k+s?|p+i+s+s+(?:ed|ing)?|c+r+a+p+|d+a+m+n+(?:ed)?|b+l+o+o+d+y+)\b/i },
  { key: "hate_slur", severity: 4, regex: /\b(?:n+i+g+g+(?:e+r|a)s?|f+a+g+g+o+t+s?|k+i+k+e+s?)\b/i },
]);

const OBFUSCATED_LANGUAGE_PATTERNS = Object.freeze([
  { key: "strong_profanity", replacement: "[PROFANITY]", severity: 2, regex: /\bf[\s._*~!@-]*(?:u|@|\*)?[\s._*~!@-]*c[\s._*~!@-]*k(?:er|ers|ing|ed|off)?\b/i },
  { key: "profanity", replacement: "[PROFANITY]", severity: 1, regex: /\bs[\s._*~!@-]*h[\s._*~!@-]*(?:i|1|!|\*)?[\s._*~!@-]*t\b/i },
]);

const TARGET_MARKER_RE = /\b(?:you|your|you're|youre|jonathan|cognipal|bot|assistant)\b/i;
const THREAT_RE = new RegExp("\\b(?:i(?:'ll| will| am going to|m going to)?\\s+(?:kill|hurt|attack|find|dox|destroy)\\s+(?:you|jonathan)|(?:kill|hurt|attack|dox)\\s+(?:you|\
jonathan)|i know where you live|watch your back)\\b", "i");
const REPORTING_CONTEXT_RE = /\b(?:said|wrote|posted|called me|called you|quote|quoting|reported|someone told me)\b/i;
const COMPLAINT_RE = /\b(?:complaint|not happy|unhappy|frustrat(?:ed|ing)|annoy(?:ed|ing)|disappoint(?:ed|ing)|terrible service|poor service|this is ridiculous|fed up)\b/i;
const CONFUSION_RE = /\b(?:i (?:do not|don't|dont) understand|confus(?:ed|ing)|what do you mean|that makes no sense|can you explain|i(?:'m| am) lost)\b/i;
const HUMAN_RE = /\b(?:talk|speak|chat)\s+(?:to|with)\s+(?:jonathan|a human|a person)|\bhuman\s+(?:please|help|support)\b/i;

const MONEY_REFUND_RE = /\b(?:refund|chargeback|charged|payment dispute|billing dispute|money back|reimburse|compensation|invoice dispute|unauthorised charge|unauthorized charge)\b/i;
const LEGAL_RE = /\b(?:solicitor|lawyer|legal action|lawsuit|sue|litigation|court|breach of contract|liability|cease and desist|formal notice|legal claim)\b/i;
const PRIVACY_RIGHTS_RE = /\b(?:subject access request|data subject request|right to erasure|right to be forgotten|delete my data|gdpr request|data protection complaint|privacy complaint)\b/i;
const COMMERCIAL_COMMITMENT_RE = /\b(?:guarantee|guaranteed outcome|binding commitment|contract price|final quote|authorise payment|authorize payment|agree to pay|settlement offer)\b/i;

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function inboundMessages(conversation) {
  return (conversation?.messages || []).filter((message) => message?.direction !== "outbound");
}

function rawMessageText(message) {
  return `${message?.subject || ""}\n${message?.body_text || message?.body || ""}`;
}

function canonicalConductText(value, maximum = 12_000) {
  return normaliseUntrustedText(value, maximum)
    .toLowerCase()
    .replace(/\b(?:[a-z]\s+){2,}[a-z]\b/g, (match) => match.replace(/\s+/g, ""))
    .replace(/[0]/g, "o")
    .replace(/[3]/g, "e")
    .replace(/[$5]/g, "s")
    .replace(/[1|]/g, "i")
    .replace(/[7]/g, "t")
    .replace(/[._*~@!-]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchedLanguageReasons(text, rawText = text) {
  const reasons = [];
  let severity = 0;
  for (const pattern of PROFANITY_PATTERNS) {
    if (!pattern.regex.test(text)) continue;
    reasons.push(pattern.key);
    severity = Math.max(severity, pattern.severity);
  }
  for (const pattern of OBFUSCATED_LANGUAGE_PATTERNS) {
    if (!pattern.regex.test(rawText)) continue;
    reasons.push(pattern.key);
    severity = Math.max(severity, pattern.severity);
  }
  return { reasons: unique(reasons), severity };
}

function messageAssessment(message) {
  const raw = rawMessageText(message);
  const normalisedRaw = normaliseUntrustedText(raw, 12_000).toLowerCase();
  const text = canonicalConductText(raw);
  const language = matchedLanguageReasons(text, normalisedRaw);
  const threat = THREAT_RE.test(text);
  const targeted = language.severity >= 2 && TARGET_MARKER_RE.test(text);
  const reportingContext = REPORTING_CONTEXT_RE.test(text);
  let score = language.severity;
  const reasons = [...language.reasons];
  if (targeted && !reportingContext) { score += 2; reasons.push("targeted_abuse"); }
  if (threat) { score += 5; reasons.push("threatening_language"); }
  if (reportingContext && score > 0) { score = Math.max(1, score - 2); reasons.push("reported_or_quoted_language"); }
  const level = score >= 5 ? "severe" : score >= 3 ? "abusive" : score > 0 ? "mild" : "none";
  return Object.freeze({
    messageId: String(message?.id || "").slice(0, 120),
    detected: score > 0,
    level,
    score,
    targeted: targeted && !reportingContext,
    threat,
    reasons: Object.freeze(unique(reasons)),
  });
}

export function assessConversationConduct(conversation, options = {}) {
  if (options.enabled === false) return Object.freeze({ enabled: false, level: "none", automationBlocked: false, requiresHumanReview: false, strikeCount: 0, reasons: Object.freeze([]) });
  const assessments = inboundMessages(conversation).slice(-20).map(messageAssessment);
  const flagged = assessments.filter((item) => item.detected);
  const abusive = assessments.filter((item) => ["abusive", "severe"].includes(item.level));
  const latest = assessments.at(-1) || { level: "none", score: 0, targeted: false, threat: false, reasons: [] };
  const reviewStrikeThreshold = Math.max(1, Number(options.reviewStrikeThreshold || 2));
  const automationBlockThreshold = Math.max(1, Number(options.automationBlockThreshold || 2));
  const maximumScore = assessments.reduce((max, item) => Math.max(max, item.score), 0);
  const threat = assessments.some((item) => item.threat);
  const targetedCount = assessments.filter((item) => item.targeted).length;
  const reasons = unique(assessments.flatMap((item) => item.reasons));
  const level = threat || maximumScore >= 5 ? "severe" : abusive.length >= reviewStrikeThreshold || maximumScore >= 3 ? "abusive" : flagged.length ? "mild" : "none";
  const requiresHumanReview = threat || targetedCount >= reviewStrikeThreshold || abusive.length >= reviewStrikeThreshold || latest.level === "severe";
  const automationBlocked = threat || targetedCount >= automationBlockThreshold || abusive.length >= automationBlockThreshold || latest.level === "severe";
  return Object.freeze({
    enabled: true,
    level,
    strikeCount: abusive.length,
    flaggedMessageCount: flagged.length,
    targetedCount,
    threat,
    latestLevel: latest.level,
    latestTargeted: Boolean(latest.targeted),
    requiresBoundary: Boolean(latest.targeted || targetedCount > 0),
    requiresHumanReview,
    automationBlocked,
    suggestedAbuseLabel: threat ? "violence" : targetedCount > 0 ? "harassment" : abusive.length ? "hostility" : "none",
    severityFloor: threat ? 0.95 : targetedCount > 0 ? 0.7 : abusive.length ? 0.58 : flagged.length ? 0.2 : 0,
    reasons: Object.freeze(reasons.slice(0, 20)),
    flaggedMessageIds: Object.freeze(flagged.map((item) => item.messageId).filter(Boolean).slice(0, 20)),
  });
}

function replaceEvery(text, regex, replacement) {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  return text.replace(new RegExp(regex.source, flags), replacement);
}

export function redactBadLanguageForAi(value, maximum = 12_000) {
  let text = normaliseUntrustedText(value, maximum);
  for (const pattern of OBFUSCATED_LANGUAGE_PATTERNS) text = replaceEvery(text, pattern.regex, pattern.replacement);
  for (const pattern of PROFANITY_PATTERNS) {
    const replacement = pattern.key === "hate_slur" ? "[ABUSIVE_LANGUAGE]" : "[PROFANITY]";
    text = replaceEvery(text, pattern.regex, replacement);
  }
  return text;
}

export function scanOutboundLanguagePolicy(value) {
  const raw = normaliseUntrustedText(value, 50_000).toLowerCase();
  const text = canonicalConductText(value, 50_000);
  const language = matchedLanguageReasons(text, raw);
  return Object.freeze({
    detected: language.severity > 0,
    level: language.severity >= 4 ? "severe" : language.severity >= 2 ? "strong" : language.severity > 0 ? "mild" : "none",
    reasons: Object.freeze(language.reasons),
  });
}

const ABUSE_LABEL_RANK = Object.freeze({ none: 0, spam: 1, scam: 2, personal_data: 2, malicious_link: 2, hostility: 3, sexual: 3, harassment: 4, hate: 5, violence: 5, self_harm: 5 });

export function mergeModerationWithConduct(moderation = {}, conduct = {}) {
  if (!conduct?.enabled || conduct.level === "none") return moderation;
  const deterministicLabel = conduct.suggestedAbuseLabel || "none";
  const currentLabel = String(moderation.abuseLabel || "none");
  const abuseLabel = (ABUSE_LABEL_RANK[deterministicLabel] || 0) > (ABUSE_LABEL_RANK[currentLabel] || 0) ? deterministicLabel : currentLabel;
  const severity = Math.max(Number(moderation.severity || 0), Number(conduct.severityFloor || 0));
  const riskLevel = severity >= 0.8 || ["hate", "violence", "self_harm"].includes(abuseLabel)
    ? "critical"
    : severity >= 0.55 || abuseLabel !== "none" ? "high"
      : severity >= 0.25 ? "medium" : "low";
  return Object.freeze({
    ...moderation,
    abuseLabel,
    severity,
    riskLevel,
    recommendedAction: conduct.requiresHumanReview ? "review" : moderation.recommendedAction,
  });
}

export function conductPromptGuidance(conduct = {}) {
  if (!conduct?.enabled) return "";
  const guidance = [
    "CONVERSATION CONDUCT RULES:",
    "- Never mirror, quote, imitate or generate profanity, slurs, insults or abusive language. Paraphrase neutrally if it is necessary to discuss what was said.",
    "- Mild frustration or an isolated swear word is not a reason to scold the visitor. Stay calm, concise and helpful.",
    "- If abuse is targeted at Jonathan or CogniPal, set one calm boundary and continue only with the substantive request.",
    "- Never retaliate, argue, shame the visitor or escalate the emotional temperature.",
  ];
  if (conduct.requiresBoundary) guidance.push("- This conversation contains targeted abusive language. Use a brief professional boundary; do not mirror the wording.");
  if (conduct.requiresHumanReview) guidance.push("- This conversation requires human review. Do not imply that an automated reply has final authority or promise enforcement action.");
  if (conduct.threat) guidance.push("- Threatening language was detected. Keep the reply minimal and non-confrontational; do not continue ordinary promotional or sales dialogue.");
  return guidance.join("\n");
}


export function assessConversationBusinessRisk(conversation) {
  const recent = inboundMessages(conversation).slice(-20).map((message) => canonicalConductText(rawMessageText(message), 5000));
  const combined = recent.join("\n");
  const categories = [];
  if (MONEY_REFUND_RE.test(combined)) categories.push("money_or_refund");
  if (LEGAL_RE.test(combined)) categories.push("legal_or_contractual");
  if (PRIVACY_RIGHTS_RE.test(combined)) categories.push("privacy_or_data_rights");
  if (COMMERCIAL_COMMITMENT_RE.test(combined)) categories.push("commercial_commitment");
  return Object.freeze({
    detected: categories.length > 0,
    requiresHumanReview: categories.length > 0,
    categories: Object.freeze(categories),
  });
}

export function conversationInteractionSignals(conversation) {
  const recent = inboundMessages(conversation).slice(-20).map((message) => canonicalConductText(rawMessageText(message), 5000));
  return Object.freeze({
    complaintCount: recent.filter((text) => COMPLAINT_RE.test(text)).length,
    confusionCount: recent.filter((text) => CONFUSION_RE.test(text)).length,
    humanRequestCount: recent.filter((text) => HUMAN_RE.test(text)).length,
  });
}

export default assessConversationConduct;
