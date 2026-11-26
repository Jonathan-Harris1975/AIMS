export const OUTREACH_QUALIFICATION_POLICY_VERSION = "outreach-qualification-v1";
export const OUTREACH_QUALIFICATION_THRESHOLD = 75;

export const CONTRIBUTOR_INTENT_PHRASES = Object.freeze([
  "write for us",
  "contributor guidelines",
  "guest contributors",
  "submit an article",
  "submit a pitch",
  "editorial submissions",
  "opinion submissions",
  "expert commentary",
  "practitioner perspectives",
  "contributed articles",
  "external authors",
]);

const PAID_ONLY_RE = /\b(?:paid placement|sponsored post(?:s)? only|advertorial(?:s)? only|pay(?:ment)? to publish|link insertion fee|guest post fee)\b/i;
const EXPLICIT_REFUSAL_RE = new RegExp(
  "\\b(?:(?:do not|don't|does not|doesn't)\\s+(?:currently\\s+)?(?:accept|take|welcome|consider|allow)|"
  + "(?:not|no longer)\\s+(?:currently\\s+)?accept(?:ing|ed)?|closed\\s+to|not\\s+open\\s+to)\\b"
  + "[^.!?]{0,160}\\b(?:contribut(?:e|ed|or|ors|ion)|guest(?: post| author| article| contribution)?s?|"
  + "external author(?:s)?|article submissions?|pitches?|opinion submissions?|outside authors?)\\b",
  "i"
);
const EXPLICIT_ACCEPTANCE_RE = new RegExp(
  "\\b(?:write for us|contributor guidelines|guest contributors?|submit (?:an )?(?:article|pitch)|"
  + "editorial submissions?|opinion submissions?|expert commentary|practitioner perspectives|"
  + "contributed articles?|external authors?)\\b",
  "i"
);
const EXTERNAL_AUTHOR_RE = /\b(?:guest authors?|contributors?|external authors?|opinion writer|expert commentary|practitioner perspective|contributed articles?)\b/i;
const EDITORIAL_ROUTE_RE = /\b(?:editor(?:ial)?|submissions?|contribute|pitch|author|writer|contact)\b/i;
const RECENT_ACTIVITY_RE = /\b(?:202[4-9]|202[0-9]|updated|recent|latest|this month|this year)\b/i;

function cleanText(value, limit = 6000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

export function classifyEditorialEvidence({ sourceUrl = "", sourceTitle = "", sourceSnippet = "", pageText = "", retrievedAt = new Date().toISOString() } = {}) {
  const text = cleanText(`${sourceTitle} ${sourceSnippet} ${pageText}`).toLowerCase();
  const paidOnly = PAID_ONLY_RE.test(text);
  const explicitAcceptance = EXPLICIT_ACCEPTANCE_RE.test(text);
  const explicitRefusal = EXPLICIT_REFUSAL_RE.test(text);
  const externalAuthors = EXTERNAL_AUTHOR_RE.test(text);
  const editorialRoute = EDITORIAL_ROUTE_RE.test(text) || /\/(?:write|contribut|submit|pitch|editorial|author)/i.test(String(sourceUrl));
  const recentActivity = RECENT_ACTIVITY_RE.test(text);
  let classification = "unconfirmed";
  if (explicitRefusal || (paidOnly && !explicitAcceptance)) classification = "unsuitable";
  else if (explicitAcceptance) classification = "confirmed";
  else if (externalAuthors && editorialRoute) classification = "strong_probable";

  return {
    policyVersion: OUTREACH_QUALIFICATION_POLICY_VERSION,
    classification,
    evidenceUrl: String(sourceUrl || "").slice(0, 1000),
    supportingExcerpt: cleanText(pageText || sourceSnippet || sourceTitle, 320),
    retrievedAt,
    explicitAcceptance,
    explicitRefusal,
    externalAuthors,
    editorialRoute,
    recentActivity,
    paidOnly,
  };
}

export function relevanceScore(keyword = "", evidence = {}) {
  const topic = cleanText(keyword).toLowerCase();
  const evidenceText = cleanText(`${evidence.supportingExcerpt || ""} ${evidence.evidenceUrl || ""}`).toLowerCase();
  const topicSignal = /\b(?:ai|artificial intelligence|automation|machine learning|mlops|technology|digital|data|cybersecurity|business|enterprise|publishing|media|education|healthcare|fintech)\b/i;
  const topicTerms = topic.match(/[a-z0-9]+/g)?.filter((term) => term.length > 2 || ["ai", "ml"].includes(term)) || [];
  const evidenceTerms = new Set(evidenceText.match(/[a-z0-9]+/g) || []);
  const matchingTerms = topicTerms.filter((term) => evidenceTerms.has(term));
  const escapedTopic = topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const directTopicMatch = topic.length >= 2 && new RegExp(`\\b${escapedTopic}\\b`, "i").test(evidenceText);
  const meaningfulTopicMatch = matchingTerms.length > 0
    && matchingTerms.length >= Math.max(1, Math.ceil(topicTerms.length / 2));
  if (directTopicMatch || meaningfulTopicMatch) return 25;
  if (directTopicMatch || meaningfulTopicMatch || (topicSignal.test(topic) && topicSignal.test(evidenceText))) return 15;
  if (topicSignal.test(topic)) return 15;
  return 0;
}

export function scoreOpportunity({ keyword = "", evidence = {}, contact = {}, validation = {}, authority = {}, historicalEngagement = null } = {}) {
  const evidencePoints = evidence.classification === "confirmed" ? 30 : evidence.classification === "strong_probable" ? 25 : 0;
  const relevancePoints = relevanceScore(keyword, evidence);
  const contactPoints = contact.editorialContact ? 20 : contact.role ? 15 : contact.named ? 10 : 0;
  const recentPoints = evidence.recentActivity ? 10 : 5;
  const credibilityPoints = Number(authority.openPageRank || 0) >= 3 ? 10 : authority.blocked ? 0 : 5;
  const historicalPoints = historicalEngagement === true ? 5 : 0;
  const total = evidencePoints + relevancePoints + contactPoints + recentPoints + credibilityPoints + historicalPoints;
  const mandatoryGates = {
    editorialEvidence: ["confirmed", "strong_probable"].includes(evidence.classification),
    recipientEligible: Boolean(contact.eligible),
    validated: String(validation.status || "").toLowerCase() === "valid",
    notPaidOnly: evidence.paidOnly !== true,
  };
  const mandatoryGatesPassed = Object.values(mandatoryGates).every(Boolean);
  return {
    policyVersion: OUTREACH_QUALIFICATION_POLICY_VERSION,
    components: {
      evidence: evidencePoints,
      relevance: relevancePoints,
      contact: contactPoints,
      recentActivity: recentPoints,
      credibility: credibilityPoints,
      historicalEngagement: historicalPoints,
    },
    total,
    band: total >= 85 ? "exceptional" : total >= 75 ? "strong" : total >= 65 ? "further_verification" : "reject",
    mandatoryGates,
    qualified: mandatoryGatesPassed && total >= OUTREACH_QUALIFICATION_THRESHOLD,
    decisionReason: !mandatoryGatesPassed ? "mandatory_gate_failed" : total >= OUTREACH_QUALIFICATION_THRESHOLD ? "qualified" : "below_threshold",
  };
}

