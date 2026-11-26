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
const EXPLICIT_REFUSAL_RE = /\b(?:we|our|this (?:site|publication)|the site)\s+(?:do not|don't|does not|doesn't|no longer|are not|aren't)\s+(?:accept|take|consider)\b[\s\S]{0,120}\b(?:guest|contribut|external|article|pitch|submission|opinion)\b|\b(?:guest posts?|contributions?|submissions?|pitches?|contributed articles?)\s+(?:are|is)\s+(?:currently\s+)?(?:closed|not accepted|not being accepted)\b|\bnot accepting\b[\s\S]{0,80}\b(?:guest|contribut|article|pitch|submission)\b/i;
const EXPLICIT_ACCEPTANCE_RE = new RegExp(
  "\\b(?:write for us|contributor guidelines|guest contributors?|submit (?:an )?(?:article|pitch)|"
  + "editorial submissions?|opinion submissions?|expert commentary|practitioner perspectives|"
  + "contributed articles?|external authors?)\\b",
  "i"
);
const EXTERNAL_AUTHOR_RE = /\b(?:guest authors?|contributors?|external authors?|opinion writer|expert commentary|practitioner perspective|contributed articles?)\b/i;
const EDITORIAL_ROUTE_RE = /\b(?:editor(?:ial)?|submissions?|contribute|pitch|author|writer|contact)\b/i;
const RECENT_ACTIVITY_RE = /\b(?:202[4-9]|202[0-9]|updated|recent|latest|this month|this year)\b/i;
const TOPIC_SIGNAL_RE = /\b(?:ai|artificial intelligence|automation|machine learning|mlops|technology|digital|data|cybersecurity|business|enterprise|publishing|media|education|healthcare|fintech|predictive|decision|systems|model|monitoring|production|workflow|agent|agents|operations|governance|risk|compliance|security|software|cloud|robotics|strategy|leadership|marketing|content|creator|author)\b/i;
const TOPIC_STOP_WORDS = new Set(["the", "and", "for", "with", "from", "into", "about", "this", "that", "your", "our", "how", "why", "what"]);

function cleanText(value, limit = 6000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function meaningfulTokens(value) {
  return new Set(
    String(value || "").toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 2 && !TOPIC_STOP_WORDS.has(token)) || []
  );
}

export function classifyEditorialEvidence({ sourceUrl = "", sourceTitle = "", sourceSnippet = "", pageText = "", retrievedAt = new Date().toISOString() } = {}) {
  const text = cleanText(`${sourceTitle} ${sourceSnippet} ${pageText}`).toLowerCase();
  const explicitRefusal = EXPLICIT_REFUSAL_RE.test(text);
  const paidOnly = PAID_ONLY_RE.test(text);
  const explicitAcceptance = !explicitRefusal && EXPLICIT_ACCEPTANCE_RE.test(text);
  const externalAuthors = EXTERNAL_AUTHOR_RE.test(text);
  const editorialRoute = EDITORIAL_ROUTE_RE.test(text) || /\/(?:write|contribut|submit|pitch|editorial|author)/i.test(String(sourceUrl));
  const recentActivity = RECENT_ACTIVITY_RE.test(text);
  let classification = "unconfirmed";
  if (explicitRefusal) classification = "unsuitable";
  else if (paidOnly && !explicitAcceptance) classification = "unsuitable";
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
    submissionOpen: !explicitRefusal && (explicitAcceptance || (externalAuthors && editorialRoute)),
    externalAuthors,
    editorialRoute,
    recentActivity,
    paidOnly,
  };
}

export function relevanceScore(keyword = "", evidence = {}) {
  const topic = cleanText(keyword).toLowerCase();
  const evidenceText = cleanText(`${evidence.supportingExcerpt || ""} ${evidence.evidenceUrl || ""}`).toLowerCase();
  if (!TOPIC_SIGNAL_RE.test(topic)) return 0;
  const overlap = [...meaningfulTokens(topic)].filter((token) => meaningfulTokens(evidenceText).has(token));
  if (overlap.length) return 25;
  return 15;
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

