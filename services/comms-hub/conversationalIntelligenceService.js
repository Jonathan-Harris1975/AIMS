import { sanitiseUntrustedText } from "./domain/promptSecurity.js";
import { isSocialCommentChannel } from "./domain/channels.js";

const ACKNOWLEDGEMENT = /^(?:ok(?:ay)?|right|great|good|thanks|thank you|cheers|got it|understood|perfect|nice|brilliant|yes|no|yep|yeah|nope|fine)[.!\s]*$/i;
const GREETING = /^(?:hi|hello|hey|good morning|good afternoon|good evening|morning|afternoon|evening)[!.\s]*$/i;
const VAGUE_HELP = /^(?:(?:can|could|would) you )?(?:help|help me|assist me|give me a hand)(?: please)?[?.!\s]*$/i;
const VAGUE_INFO = /^(?:details|information|info|tell me|explain|describe|what about|how about|what do you mean|can you tell me|could you tell me|can you explain|could you explain)[?.!\s]*$/i;
const VAGUE_MORE = /^(?:tell me more|more|go on|what else|anything else|can you expand|could you expand|expand on that|explain more)[?.!\s]*$/i;
const VAGUE_REFERENCE = /^(?:what|how|why|when|where|which|who)?\s*(?:about\s+)?(?:that|this|it|them|those|these|the one|the other one)(?:\s+then)?[?.!\s]*$/i;
const REFERENTIAL_START = /^(?:what about|how about|and|also|so|then|why|how|when|where|which|is it|are they|does it|do they|can it|can they|tell me more about)\b/i;
const CHOICE_ONLY = /^(?:which one|which|what one|the first one|the second one|the third one|first|second|third)[?.!\s]*$/i;
const PRICE_ONLY = /^(?:how much|price|cost|what does it cost|what's the price|what is the price)[?.!\s]*$/i;
const AVAILABILITY_ONLY = /^(?:is it available|are they available|available|when is it available|where can i get it)[?.!\s]*$/i;
const UNRESOLVED_REFERENCE = /\b(?:that|this|it|them|those|these|the one|the other one|another one)\b/i;
const EXPLICIT_REFERENCE_ANCHOR = /\b(?:book|ebook|service|podcast|project|course|workshop|article|post|comment|video|newsletter|event|talk|keynote|consulting|consultancy|website|page|link|form|topic|question|answer|option|model|tool|technology|artificial intelligence|machine learning|ai)\b/i;

const BRAND_FAMILIES = Object.freeze([
  ["books", /\b(?:book|books|ebook|ebooks|read|reading|publication|publications|author|written|wrote)\b/i],
  ["podcast_media", /\b(?:podcast|podcasts|interview|interviews|media|press|radio|television|tv|youtube|spotify|apple podcasts?|video|videos)\b/i],
  ["services", /\b(?:service|services|consult|consulting|consultancy|advisory|advice|workshop|workshops|training|train|course|courses|sector|sectors|industry|industries|specialise|specialises|specialism|specialisms|expertise|professional services?)\b/i],
  ["speaking", /\b(?:speak|speaking|speaker|keynote|keynotes|conference|event|events|talk|talks|presentation|presentations)\b/i],
  ["projects_work", /\b(?:project|projects|work|worked|client|clients|case study|case studies|portfolio|programme|programmes)\b/i],
  ["background", /\b(?:about|background|bio|biography|career|experience|qualification|qualifications|credential|credentials|award|awards|who is jonathan|what does jonathan)\b/i],
  ["contact_collaboration", /\b(?:contact|email|reach|collaborate|collaboration|partner|partnership|work with|hire|book jonathan|speak to jonathan|talk to jonathan)\b/i],
  ["availability", /\b(?:available|availability|booking|bookable|calendar|schedule)\b/i],
  ["pricing", /\b(?:price|pricing|cost|costs|fee|fees|rate|rates|budget)\b/i],
  ["social", /\b(?:linkedin|instagram|facebook|social media|socials|follow)\b/i],
  ["newsletter", /\b(?:newsletter|mailing list|subscribe|subscription)\b/i],
  ["content", /\b(?:blog|blogs|article|articles|writing|content|post|posts|essay|essays|publication|publications)\b/i],
  ["website", /\b(?:website|site|page|pages|where can i find|link|links)\b/i],
  ["ai_expertise", /\b(?:artificial intelligence|\bai\b|machine learning|automation|agent|agents|llm|llms|technology|tech)\b/i],
]);

function textOf(message) {
  return sanitiseUntrustedText(`${message?.subject || ""}\n${message?.body_text || message?.body || ""}`, 8000).trim();
}

function usefulMessages(conversation) {
  return (conversation?.messages || [])
    .map((message) => ({ ...message, _text: textOf(message) }))
    .filter((message) => message._text);
}

function latestInboundIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.direction !== "outbound") return index;
  }
  return -1;
}

function priorContext(messages, latestIndex) {
  const recent = messages.slice(Math.max(0, latestIndex - 6), latestIndex).reverse();
  const outbound = recent.find((message) => message.direction === "outbound" && message._text.length >= 8);
  const inbound = recent.find((message) => message.direction !== "outbound" && message._text.length >= 8);
  return Object.freeze({
    outbound: outbound?._text || "",
    inbound: inbound?._text || "",
    available: Boolean(outbound || inbound),
  });
}

function resolvedWithPrior(prior, latest) {
  return [prior.inbound, prior.outbound, latest].filter(Boolean).join("\n");
}

function detectBrandFamily(text) {
  const value = String(text || "");
  if (/\b(?:who are you|are you jonathan|is this jonathan|am i speaking (?:to|with) jonathan|are you (?:a )?(?:bot|ai|assistant)|what is cognipal|who is cognipal)\b/i.test(value)) return "assistant_identity";
  if (/\b(?:what can you do|what can cognipal do|how can you help(?: me)?|what do you help with|what can i ask you)\b/i.test(value)) return "assistant_capabilities";
  const matches = BRAND_FAMILIES.filter(([, pattern]) => pattern.test(value)).map(([name]) => name);
  if (matches.includes("pricing") && matches.includes("services")) return "services";
  return matches[0] || "general";
}

function likelyPersonalBrand(text, family) {
  const value = String(text || "").trim();
  if (["assistant_identity", "assistant_capabilities"].includes(family)) return false;
  if (/\bjonathan(?: harris)?\b/i.test(value)) return true;

  const brandFamily = ["books", "podcast_media", "services", "speaking", "projects_work", "background", "contact_collaboration", "availability", "pricing", "social", "newsletter", "content", "website"].includes(family);
  if (brandFamily && !/^\s*(?:what is|what are|define|explain)\b/i.test(value)) return true;

  if (/\b(?:your|yours)\s+(?:background|career|experience|work|project|projects|book|books|podcast|newsletter|service|services|sectors?|industr(?:y|ies)|specialisms?|expertise|blog|articles?|content|website|site|linkedin|instagram|facebook|youtube|views?|opinion|approach|availability|fees?|rates?|clients?)\b/i.test(value)) return true;
  if (/\b(?:do|did|have|has|are|were|will)\s+you\b/i.test(value)) return true;
  if (/\bwhat\s+do\s+you\s+(?:do|offer|provide|write|publish|cover|specialise in|specialize in|think|believe)\b/i.test(value)) return true;
  if (/\bwhere\s+(?:do|can)\s+(?:i|we)\s+(?:find|follow|contact|book|hire)\s+you\b/i.test(value)) return true;

  // Requests for CogniPal to explain or help with a general topic are assistant
  // capability requests, not claims about Jonathan's personal brand.
  if (/^\s*(?:can|could|would)\s+you\s+(?:explain|help|summarise|summarize|tell|show|compare|define|describe|give)\b/i.test(value)) return false;
  return false;
}

function containsSpecificObject(text) {
  const words = String(text || "").toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) || [];
  const noise = new Set(["can","could","would","you","please","help","me","with","this","that","it","the","a","an","my","your","about","more","tell","what","how","why","when","where","which","who","do","does","is","are","i"]);
  return words.some((word) => word.length >= 3 && !noise.has(word));
}

function hasQuestion(text) {
  return /\?|\b(?:what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|have|has)\b/i.test(text || "");
}

function socialPostContextAvailable(conversation, liveContent = {}) {
  if (liveContent?.exactPost?.text || liveContent?.exactPost?.title) return true;
  const latest = (conversation?.messages || []).at(-1);
  try {
    const metadata = typeof latest?.metadata_json === "string" ? JSON.parse(latest.metadata_json || "{}") : (latest?.metadata_json || {});
    return Boolean(metadata?.postContext?.text || metadata?.postContext?.title);
  } catch {
    return false;
  }
}

function clarificationQuestion({ kind, family, channel }) {
  const publicComment = isSocialCommentChannel(channel);
  if (kind === "missing_reference") return publicComment ? "What are you referring to here?" : "What are you referring to when you say that?";
  if (kind === "missing_choice") return "Which options are you choosing between?";
  if (kind === "missing_price_subject") return "What would you like the price or cost for?";
  if (kind === "missing_availability_subject") return "What would you like me to check the availability of?";
  if (kind === "vague_more") return publicComment ? "What would you like me to expand on?" : "What would you like me to tell you more about?";
  if (kind === "vague_help") {
    if (family === "books") return "Of course — are you looking for a book on a particular AI topic or industry?";
    return publicComment ? "What would you like help with?" : "Of course — what would you like help with?";
  }
  if (family === "books") return "What AI topic or industry would you like a book on?";
  if (family === "services") return "Which area of Jonathan's work or services would you like to know about?";
  if (family === "podcast_media") return "What would you like to know about Jonathan's podcast or media work?";
  if (family === "contact_collaboration") return "Are you looking to contact Jonathan, collaborate with him, or enquire about working together?";
  return "What would you like to know?";
}

export function buildConversationalIntelligence(conversation, { liveContent = {} } = {}) {
  const messages = usefulMessages(conversation);
  const latestIndex = latestInboundIndex(messages);
  const latest = latestIndex >= 0 ? messages[latestIndex]._text : "";
  const prior = priorContext(messages, latestIndex);
  const family = detectBrandFamily(latest);
  const postContext = socialPostContextAvailable(conversation, liveContent);
  const sourcePostDiscussion = Boolean(postContext && isSocialCommentChannel(conversation?.channel) && /\b(?:this|that|post|comment|mean|point|claim|evidence|agree|disagree)\b/i.test(latest));
  const personalBrandLikely = sourcePostDiscussion ? false : likelyPersonalBrand(latest, family);

  let ambiguityKind = "none";
  let clarificationRequired = false;
  let contextResolved = false;
  let resolvedQuery = latest;

  if (!latest || ACKNOWLEDGEMENT.test(latest) || GREETING.test(latest)) {
    // Natural conversational turns are not treated as ambiguous questions.
  } else if (["assistant_identity", "assistant_capabilities"].includes(family)) {
    // CogniPal identity/capability questions have deterministic answers and do
    // not need an extra clarification round-trip.
  } else if (VAGUE_HELP.test(latest) && !containsSpecificObject(latest)) {
    clarificationRequired = true;
    ambiguityKind = "vague_help";
  } else if (VAGUE_INFO.test(latest) && !prior.available && !postContext) {
    clarificationRequired = true;
    ambiguityKind = "underspecified_question";
  } else if (VAGUE_INFO.test(latest) && (prior.available || postContext)) {
    contextResolved = true;
    resolvedQuery = resolvedWithPrior(prior, latest);
  } else if (CHOICE_ONLY.test(latest)) {
    if (prior.available) {
      contextResolved = true;
      resolvedQuery = resolvedWithPrior(prior, latest);
    } else {
      clarificationRequired = true;
      ambiguityKind = "missing_choice";
    }
  } else if (PRICE_ONLY.test(latest)) {
    if (prior.available) {
      contextResolved = true;
      resolvedQuery = resolvedWithPrior(prior, latest);
    } else {
      clarificationRequired = true;
      ambiguityKind = "missing_price_subject";
    }
  } else if (AVAILABILITY_ONLY.test(latest)) {
    if (prior.available) {
      contextResolved = true;
      resolvedQuery = resolvedWithPrior(prior, latest);
    } else {
      clarificationRequired = true;
      ambiguityKind = "missing_availability_subject";
    }
  } else if (UNRESOLVED_REFERENCE.test(latest) && !EXPLICIT_REFERENCE_ANCHOR.test(latest) && !prior.available && !postContext) {
    clarificationRequired = true;
    ambiguityKind = "missing_reference";
  } else if (VAGUE_MORE.test(latest)) {
    if (prior.available || postContext) {
      contextResolved = true;
      resolvedQuery = resolvedWithPrior(prior, latest);
    } else {
      clarificationRequired = true;
      ambiguityKind = "vague_more";
    }
  } else if (VAGUE_REFERENCE.test(latest) || (REFERENTIAL_START.test(latest) && !containsSpecificObject(latest))) {
    if (prior.available || postContext) {
      contextResolved = true;
      resolvedQuery = resolvedWithPrior(prior, latest);
    } else {
      clarificationRequired = true;
      ambiguityKind = "missing_reference";
    }
  } else if (hasQuestion(latest) && latest.length < 18 && !containsSpecificObject(latest)) {
    clarificationRequired = true;
    ambiguityKind = "underspecified_question";
  }

  if (sourcePostDiscussion) contextResolved = true;

  // A social comment such as “what do you mean by this?” is sufficiently grounded
  // when the exact source post is available, even though the words are referential.
  if (clarificationRequired && postContext && isSocialCommentChannel(conversation?.channel) && /\b(?:this|that|it|mean)\b/i.test(latest)) {
    clarificationRequired = false;
    ambiguityKind = "none";
    contextResolved = true;
  }

  const question = clarificationRequired
    ? clarificationQuestion({ kind: ambiguityKind, family, channel: conversation?.channel })
    : "";

  return Object.freeze({
    enabled: true,
    version: "conversational-intelligence/v1",
    latestText: latest,
    resolvedQuery: sanitiseUntrustedText(resolvedQuery, 12_000),
    family,
    personalBrandLikely,
    ambiguityKind,
    clarificationRequired,
    clarificationQuestion: question,
    contextResolved,
    priorContextAvailable: prior.available,
    sourcePostContextAvailable: postContext,
    sourcePostDiscussion,
    conversationalTurn: ACKNOWLEDGEMENT.test(latest) || GREETING.test(latest),
    deterministicResponseKind: family === "assistant_identity" || family === "assistant_capabilities" ? family : clarificationRequired ? "clarification" : "",
  });
}

export function conversationalIntelligencePromptGuidance(intelligence = {}) {
  if (!intelligence?.enabled) return "";
  return [
    "CONVERSATIONAL INTELLIGENCE RULES:",
    "- Identity: you are CogniPal, Jonathan Harris's AI assistant. You are not Jonathan Harris and must never impersonate him.",
    "- When stating a fact about Jonathan, use Jonathan/ he/ his rather than I/ me/ my. Do not sign a reply as Jonathan or imply Jonathan personally typed an automated response.",
    `- Current topic family: ${intelligence.family}.`,
    `- Personal-brand question likely: ${intelligence.personalBrandLikely ? "yes" : "no"}.`,
    `- Ambiguity detected: ${intelligence.clarificationRequired ? "yes" : "no"}.`,
    intelligence.contextResolved ? "- A short or referential message was resolved using the existing conversation/source-post context. Continue that topic naturally without asking the user to repeat it." : "",
    intelligence.clarificationRequired ? `- Do not guess the missing meaning. Ask exactly this one clarification question: ${intelligence.clarificationQuestion}` : "",
    "- Resolve pronouns and follow-up phrases from the supplied conversation history when the referent is clear. Do not invent a referent when it is not clear.",
    "- Answer the user's actual question first. Do not force a promotion, book, form, hand-off or call to action into an unrelated conversation.",
    "- In public comments, keep the reply proportionate and public-safe: do not expose private conversation details, contact data or internal handling. In DMs/webchat, be concise but allow enough detail to be genuinely useful.",
    "- Maintain continuity across turns: do not reintroduce yourself, repeat established facts or ask again for information already supplied in the conversation.",
  ].filter(Boolean).join("\n");
}

export function deterministicClarificationDraft(intelligence = {}) {
  if (!intelligence?.clarificationRequired || !intelligence?.clarificationQuestion) return null;
  return Object.freeze({
    bodyText: intelligence.clarificationQuestion,
    evidenceSourceReferences: [],
  });
}

export function deterministicConversationalDraft(intelligence = {}, { channel = "chat" } = {}) {
  const clarification = deterministicClarificationDraft(intelligence);
  if (clarification) return clarification;
  if (intelligence?.family === "assistant_identity") {
    return Object.freeze({
      bodyText: isSocialCommentChannel(channel)
        ? "I’m CogniPal, Jonathan Harris’s AI assistant — not Jonathan himself."
        : "I’m CogniPal, Jonathan Harris’s AI assistant — not Jonathan himself. I use verified information from his website and the conversation context, and I won’t invent details that aren’t supported.",
      evidenceSourceReferences: [],
    });
  }
  if (intelligence?.family === "assistant_capabilities") {
    return Object.freeze({
      bodyText: isSocialCommentChannel(channel)
        ? "I can help with questions about Jonathan’s published work or this post, using verified information."
        : "I can help with questions about Jonathan’s work, books and public content using his website as the main source of truth, continue the conversation in context, and route a request to Jonathan when appropriate.",
      evidenceSourceReferences: [],
    });
  }
  return null;
}

export default buildConversationalIntelligence;
