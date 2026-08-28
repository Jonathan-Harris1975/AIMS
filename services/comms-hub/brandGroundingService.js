import { sanitiseUntrustedText } from "./domain/promptSecurity.js";
import { isSocialChannel, isSocialCommentChannel } from "./domain/channels.js";

const OFFICIAL_HOSTS = new Set(["jonathan-harris.online", "www.jonathan-harris.online"]);

function latestInbound(conversation) {
  return (conversation?.messages || []).filter((message) => message?.direction !== "outbound").at(-1) || null;
}

export function isOfficialWebsiteReference(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" && OFFICIAL_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function classifyBrandGrounding(conversation, { conversationalIntelligence = {} } = {}) {
  const message = latestInbound(conversation);
  const latest = sanitiseUntrustedText(`${message?.subject || ""}\n${message?.body_text || message?.body || ""}`, 8000).trim();
  const value = latest.toLowerCase();
  const sourcePostDiscussion = Boolean(conversationalIntelligence?.sourcePostDiscussion);
  const intelligenceAvailable = conversationalIntelligence?.enabled === true;
  const legacyPersonalBrandQuestion = Boolean(
    /\b(?:jonathan(?: harris)?|you|your|yours)\b/.test(value)
    && /\b(?:do|does|did|are|is|have|has|host|run|offer|provide|publish|write|wrote|work|worked|speak|spoken|podcast|newsletter|book|books|ebook|ebooks|service|services|consult|consulting|website|social|linkedin|youtube|instagram|facebook|career|background|experience|qualification|award|client|company|business|project|projects|available|where|when|who|what)\b/.test(value)
  ) || /\b(?:who is jonathan harris|what does jonathan harris do|tell me about jonathan harris)\b/.test(value);
  const personalBrandQuestion = !sourcePostDiscussion && (intelligenceAvailable
    ? Boolean(conversationalIntelligence?.personalBrandLikely)
    : legacyPersonalBrandQuestion);

  return Object.freeze({
    required: personalBrandQuestion,
    sourceOfTruth: "official_website",
    latestQuery: conversationalIntelligence?.resolvedQuery || latest,
    family: conversationalIntelligence?.family || "general",
  });
}

export function officialWebsiteEvidence(evidence = []) {
  return (Array.isArray(evidence) ? evidence : []).filter((item) => [
    item?.sourceReference,
    item?.metadata?.url,
    item?.metadata?.source,
    item?.metadata?.canonical,
    item?.metadata?.canonicalUrl,
  ].some(isOfficialWebsiteReference));
}

export function brandGroundingPromptGuidance(grounding = {}, evidence = []) {
  if (!grounding?.required) return "";
  const official = officialWebsiteEvidence(evidence);
  return [
    "PERSONAL-BRAND SOURCE-OF-TRUTH RULES:",
    "- Jonathan Harris's official website is the primary source of truth for factual claims about Jonathan, his work, books, podcast, services, projects, experience, availability and public activities.",
    "- For those facts, use only supplied evidence whose sourceReference is on https://jonathan-harris.online/. Do not fill gaps from model memory, assumptions, common patterns or third-party knowledge.",
    "- Never invent a title, role, service, platform, URL, schedule, biography detail, credential, client, project, product or media property.",
    official.length
      ? "- Official website evidence is available. Answer only what that evidence supports and cite only the exact supplied sourceReference values used."
      : "- No official website evidence was retrieved. State briefly that you cannot verify the answer from Jonathan's website and do not guess.",
  ].join("\n");
}

export function normaliseCogniPalBrandIdentity(value, grounding = {}) {
  let text = String(value || "").trim();
  if (!grounding?.required || !text) return text;
  const replacements = [
    [/\bI\s+host\b/gi, "Jonathan hosts"],
    [/\bI\s+run\b/gi, "Jonathan runs"],
    [/\bI\s+offer\b/gi, "Jonathan offers"],
    [/\bI\s+provide\b/gi, "Jonathan provides"],
    [/\bI\s+publish\b/gi, "Jonathan publishes"],
    [/\bI\s+write\b/gi, "Jonathan writes"],
    [/\bI\s+wrote\b/gi, "Jonathan wrote"],
    [/\bI\s+work\b/gi, "Jonathan works"],
    [/\bI\s+worked\b/gi, "Jonathan worked"],
    [/\bI\s+speak\b/gi, "Jonathan speaks"],
    [/\bI\s+spoke\b/gi, "Jonathan spoke"],
    [/\bI\s+consult\b/gi, "Jonathan consults"],
    [/\bI\s+created\b/gi, "Jonathan created"],
    [/\bI\s+founded\b/gi, "Jonathan founded"],
    [/\bI\s+launched\b/gi, "Jonathan launched"],
    [/\bI\s+have\s+(?=(?:a|an|the|written|published|worked|spoken|created|founded|launched)\b)/gi, "Jonathan has "],
    [/\bI\s+am\s+(?=(?:available|an?\s+(?:author|speaker|consultant|advisor|adviser)|the\s+(?:author|host|founder))\b)/gi, "Jonathan is "],
    [/\bmy\s+(?=(?:book|books|podcast|podcasts|service|services|website|site|career|background|experience|project|projects|client|clients|newsletter|social|linkedin|instagram|facebook|youtube)\b)/gi, "Jonathan's "],
    [/\bour\s+(?=(?:book|books|podcast|podcasts|service|services|website|site|newsletter)\b)/gi, "Jonathan's "],
  ];
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
  return text
    .replace(/(?:\n|^)\s*[—-]\s*Jonathan Harris\s*$/i, "")
    .trim();
}

export function unverifiedBrandFallback({ channel = "chat" } = {}) {
  if (isSocialCommentChannel(channel)) return "I can’t verify that from Jonathan’s website, so I don’t want to guess.";
  if (isSocialChannel(channel)) return "I can’t verify that from Jonathan’s website, so I don’t want to guess. Tell me what you’re looking for and I’ll stick to what’s verified there.";
  return "I can’t verify that from Jonathan’s website, so I don’t want to guess. If you tell me what you’re looking for, I can help using the information published there.";
}
