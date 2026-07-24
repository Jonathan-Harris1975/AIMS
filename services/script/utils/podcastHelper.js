// services/script/utils/podcastHelper.js
// Production-grade podcast metadata generation:
// title, description, SEO keywords, artwork prompt

import { resilientRequest } from "../../shared/utils/ai-service.js";
import * as sessionCache from "./sessionCache.js";
import { info, error, debug, warn } from "../../../logger.js";
import { extractMainContent } from "./textHelpers.js";
import { calculateDuration } from "./durationCalculator.js";
import { buildPodcastDiscoveryMetadata } from "../../rss-feed-podcast/discoveryMetadata.js";
import { buildPodcastMetadataPersona, buildPodcastArtworkPersona } from "./toneSetter.js";
import { applyArtworkPromptPolicy, getSeasonalPaletteDirection, STRICT_TEXT_FREE_RULE } from "../../artwork/utils/artworkPromptPolicy.js";

const PODCAST_TITLE = "Turing’s Torch: Artificial Intelligence Weekly";
const HOST_NAME = "Jonathan Harris";

const TOPIC_RULES = [
  {
    label: "Agentic AI",
    pattern: /\b(agentic|autonomous agents?|operate largely on their own|constant human direction)\b/i,
    keywords: ["agentic AI", "AI agents", "autonomous agents"],
  },
  {
    label: "Model Hype",
    pattern: /\b(openai|anthropic|claude|gpt|opus|model releases?|benchmarks?|point releases?)\b/i,
    keywords: ["AI models", "OpenAI", "Anthropic", "AI benchmarks"],
  },
  {
    label: "MCP and Agent Skills",
    pattern: /\b(mcp|agent skills|chatbots?|modular conversational)\b/i,
    keywords: ["MCP", "AI agent skills", "AI chatbots"],
  },
  {
    label: "Retail Edge AI",
    pattern: /\b(retail|lstm|edge deployment|inventory|demand forecasts?|compressing.*models?)\b/i,
    keywords: ["edge AI", "retail AI", "AI demand forecasting"],
  },
  {
    label: "Dirty Data",
    pattern: /\b(data infrastructure|data governance|siloed databases|data management|database|data reform)\b/i,
    keywords: ["AI data governance", "data infrastructure", "AI deployment"],
  },
  {
    label: "Workflow Automation",
    pattern: /\b(workflows?|automation|job displacement|productivity|surveillance|keystroke|workers?)\b/i,
    keywords: ["AI automation", "workflow automation", "AI at work"],
  },
  {
    label: "AI Governance",
    pattern: /\b(regulation|transparency|bias|accountability|control|security|ethical use|values)\b/i,
    keywords: ["AI governance", "AI regulation", "AI accountability", "AI ethics"],
  },
  {
    label: "AI Costs",
    pattern: /\b(cost|expensive|investment|environmental impact|resources|required|cloud computing)\b/i,
    keywords: ["AI costs", "AI infrastructure", "AI investment"],
  },
];

const EVERGREEN_PODCAST_SEO_TERMS = [
  "artificial intelligence",
  "AI podcast",
  "AI news",
  "AI analysis",
];

function normaliseWhitespace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getMetadataDescriptionBounds(targetMins = 45) {
  const mins = Number(targetMins) || 45;
  if (mins <= 30) return { min: 300, max: 560 };
  if (mins >= 60) return { min: 460, max: 900 };
  return { min: 380, max: 750 };
}

function detectTopics(text = "") {
  const haystack = String(text || "");
  const found = [];

  for (const rule of TOPIC_RULES) {
    if (rule.pattern.test(haystack)) found.push(rule.label);
  }

  return found.slice(0, 5);
}

function uniqueKeywordList(items = []) {
  const seen = new Set();
  const out = [];

  for (const item of items) {
    const keyword = normaliseWhitespace(item);
    const key = keyword.toLowerCase();
    if (!keyword || seen.has(key)) continue;
    seen.add(key);
    out.push(keyword);
  }

  return out;
}

function detectSeoKeywordCandidates(text = "") {
  const haystack = String(text || "");
  const found = [];

  for (const rule of TOPIC_RULES) {
    if (rule.pattern.test(haystack)) {
      found.push(...(rule.keywords || []));
      found.push(rule.label);
    }
  }

  if (/\b(regulation|transparency|bias|accountability|control|security|ethical use|values)\b/i.test(haystack)) {
    found.unshift("AI governance");
  }

  if (/\b(ai|artificial intelligence)\b/i.test(haystack)) {
    found.push(...EVERGREEN_PODCAST_SEO_TERMS);
  }

  if (/\b(news|weekly|latest|announc(?:e|ed|ement)|release|launched?)\b/i.test(haystack)) {
    found.push("artificial intelligence news", "AI weekly podcast");
  }

  return uniqueKeywordList(found).slice(0, 14);
}

function textUsesSeoKeyword(text = "", keywordCandidates = []) {
  const haystack = normaliseWhitespace(text).toLowerCase();
  if (!haystack) return false;

  return keywordCandidates.some((keyword) => {
    const needle = normaliseWhitespace(keyword).toLowerCase();
    return needle.length >= 3 && haystack.includes(needle);
  });
}

function buildSeoKeywordBrief(mainOnly = "") {
  const candidates = detectSeoKeywordCandidates(mainOnly);
  if (candidates.length === 0) {
    return "No forced keyword target. Use specific subjects from the main content only.";
  }

  return candidates.slice(0, 10).join(", ");
}

function oxfordJoin(items = []) {
  const clean = items.map((item) => String(item || "").trim()).filter(Boolean);
  if (clean.length <= 1) return clean[0] || "AI noise";
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

function trimTitle(title = "") {
  const cleaned = normaliseWhitespace(title)
    .replace(/^episode\s+\d+\s*[:\-–—]?\s*/i, "")
    .replace(/^turing[’']?s torch\s*[:\-–—]?\s*/i, "")
    .trim();

  if (cleaned.length <= 80) return cleaned;
  return cleaned.slice(0, 77).replace(/[\s,;:.]+$/, "") + "...";
}

function buildFallbackTitle(mainOnly = "") {
  const topics = detectTopics(mainOnly);
  let title;

  if (topics.length >= 3) {
    title = `${topics[0]}, ${topics[1]}, and ${topics[2]}`;
  } else if (topics.length === 2) {
    title = `${topics[0]} Meets ${topics[1]}`;
  } else if (topics.length === 1) {
    title = `${topics[0]} Without the Sales Fog`;
  } else {
    title = "AI Hype Hits the Plumbing";
  }

  return trimTitle(title);
}

function buildFallbackDescription(mainOnly = "", durationPlan = {}) {
  const targetMins = Number(durationPlan?.targetMins || durationPlan?.targetMinutes || 45);
  const topics = detectTopics(mainOnly);
  const topicLine = topics.length
    ? oxfordJoin(topics.slice(0, targetMins >= 60 ? 5 : 4))
    : "the week’s loudest artificial intelligence claims";

  const paragraphs = [
    `${HOST_NAME} cuts through ${topicLine} in this ${targetMins}-minute ${PODCAST_TITLE} briefing. What matters is simple: what is useful, what is undercooked, and who carries the risk once the demo glow wears off.`,
    "Expect plain-English context on power, money, data, labour and control, with the usual vendor fireworks left outside where they belong.",
  ];

  if (targetMins >= 60) {
    paragraphs[1] += " Longer episodes also leave room for the awkward plumbing: incentives, security assumptions, governance gaps, and the budget line nobody wanted to read.";
  }

  return paragraphs.join("\n\n");
}

function isLikelyGenericTitle(title = "") {
  const t = String(title || "").toLowerCase().trim();
  if (!t) return true;

  const exactGeneric = new Set([
    "ai weekly",
    "artificial intelligence weekly",
    "artificial intelligence news",
    "ai news",
    "weekly ai",
    "tech news",
    "podcast",
    "turing's torch ai weekly",
    "turing’s torch ai weekly",
    "turing's torch: artificial intelligence weekly",
    "turing’s torch: artificial intelligence weekly",
  ]);

  if (exactGeneric.has(t)) return true;
  if (t.length < 10) return true;

  const genericPatterns = [
    /\bweekly\s+(ai|artificial intelligence)\s+(roundup|briefing|update|news)\b/i,
    /\b(latest|top|new)\s+(ai|artificial intelligence)\s+(news|developments|updates)\b/i,
    /\bthis week in (ai|artificial intelligence)\b/i,
    /\bthe future of (ai|artificial intelligence)\b/i,
  ];

  return genericPatterns.some((pattern) => pattern.test(title));
}

function containsBannedPhrases(text = "") {
  const t = String(text || "").toLowerCase();
  const banned = [
    "in this episode",
    "we explore",
    "groundbreaking",
    "rapidly evolving",
    "cutting-edge",
    "in a move that",
    "landscape",
    "delve",
    "underscores",
    "showcases",
    "notably",
    "game-changing",
    "revolutionary leap",
  ];
  return banned.some((p) => t.includes(p));
}

function descriptionMentionsHost(description = "") {
  return /\bjonathan\s+harris\b/i.test(description);
}

function validateMetaCandidate({ title, description } = {}, durationPlan = {}, seoKeywordCandidates = []) {
  const out = { ok: true, reasons: [] };
  const bounds = getMetadataDescriptionBounds(durationPlan?.targetMins || durationPlan?.targetMinutes);

  const tt = String(title || "").trim();
  const dd = String(description || "").trim();
  const keywordCandidates = uniqueKeywordList(seoKeywordCandidates).slice(0, 14);

  if (tt.length < 10 || tt.length > 80) {
    out.ok = false;
    out.reasons.push(`title length ${tt.length} (expected 10-80 chars)`);
  }
  if (isLikelyGenericTitle(tt)) {
    out.ok = false;
    out.reasons.push("title looks generic");
  }
  if (/[\u{1F300}-\u{1FAFF}]/u.test(tt)) {
    out.ok = false;
    out.reasons.push("title contains emoji");
  }
  if (/\bepisode\b/i.test(tt)) {
    out.ok = false;
    out.reasons.push("title contains 'Episode'");
  }
  if (containsBannedPhrases(tt)) {
    out.ok = false;
    out.reasons.push("title contains banned phrase");
  }

  const dLen = dd.length;
  if (dLen < bounds.min || dLen > bounds.max) {
    out.ok = false;
    out.reasons.push(`description length ${dLen} (expected ${bounds.min}-${bounds.max} chars for ${durationPlan?.targetMins || 45} min)`);
  }
  if (containsBannedPhrases(dd)) {
    out.ok = false;
    out.reasons.push("description contains banned phrase");
  }
  if (/https?:\/\//i.test(dd)) {
    out.ok = false;
    out.reasons.push("description contains URL");
  }
  if (!descriptionMentionsHost(dd)) {
    out.ok = false;
    out.reasons.push("description does not mention Jonathan Harris");
  }

  if (keywordCandidates.length > 0 && !textUsesSeoKeyword(`${tt} ${dd}`, keywordCandidates)) {
    out.ok = false;
    out.reasons.push("metadata misses available SEO keyword candidates");
  }

  return out;
}

/* -----------------------------------------------------------
 * Title + Description Prompt (Editorial SEO)
 * -----------------------------------------------------------
 */
export function getTitleDescriptionPrompt(mainOnly, durationPlan = {}) {
  const targetMins = Number(durationPlan?.targetMins || durationPlan?.targetMinutes || 45);
  const bounds = getMetadataDescriptionBounds(targetMins);
  const seoKeywordBrief = buildSeoKeywordBrief(mainOnly);

  return `
${buildPodcastMetadataPersona()}

You are writing episode metadata for the podcast:
"${PODCAST_TITLE}".

Host: ${HOST_NAME}.
Planned episode length: ${targetMins} minutes.
Description length must fit this runtime: ${bounds.min}-${bounds.max} characters.
SEO keyword candidates from the main content: ${seoKeywordBrief}.

VOICE (non-negotiable):
- British Gen-X
- sharp, sceptical, mildly sarcastic when deserved
- conversational, not corporate
- no hype, no breathless tech optimism, no buzzword soup

HARD RULES:
- Output MUST be STRICT JSON ONLY (no markdown, no commentary).
- Title: 10-80 characters.
  - Build it from the specific subjects in the main content.
  - Where it genuinely fits, include ONE natural SEO phrase from the candidates above.
  - Do not use the podcast name as the title.
  - Punchy and specific.
  - Avoid colons unless absolutely necessary.
  - No "Episode", no numbers, no emojis.
  - No bland titles like "AI Weekly", "Artificial Intelligence News", "This Week in AI", or "Latest AI Developments".
- Description: ${bounds.min}-${bounds.max} characters.
  - Start with a concise answer-first angle using natural wording such as What matters is... or The practical issue is...
  - Mention Jonathan Harris once as the host or editorial voice.
  - Include 1-3 suitable SEO phrases from the candidates above only when they read naturally.
  - Match the planned ${targetMins}-minute length: shorter episode means tighter description; longer episode can cover more themes.
  - 2 short paragraphs.
  - Say what happened, what matters, and what is probably noise.
  - Never use clichés like "In this episode", "we explore", "groundbreaking", "rapidly evolving", "landscape".
  - Do not mention sources, websites, URLs, RSS, feeds, transcripts, audio files, or internal process.
  - Do not keyword-stuff. Human clarity beats search-engine confetti.

Return STRICT JSON ONLY:
{"title":"","description":""}

MAIN CONTENT (use only this):
${mainOnly}
`.trim();
}

/* -----------------------------------------------------------
 * SEO Keywords Prompt (Supportive, not spammy)
 * -----------------------------------------------------------
 */
export function getSEOKeywordsPrompt({ title = "", description = "", mainOnly = "", keywordCandidates = [] } = {}) {
  const candidateBrief = uniqueKeywordList(keywordCandidates).slice(0, 14).join(", ") || "none";

  return `
${buildPodcastMetadataPersona()}

Generate 10-14 SEO keywords that a real person might search for.
Lowercase, comma-separated.
No hashtags.
No duplication.
No generic filler.
Prefer specific artificial intelligence topics over broad noise.

Candidate phrases already detected: ${candidateBrief}

Base them ONLY on this episode metadata and main-content excerpt:
Title: ${title}
Description: ${description}
Main content excerpt: ${String(mainOnly || "").slice(0, 2400)}

Return ONLY the keywords.
`.trim();
}

/* -----------------------------------------------------------
 * Artwork Prompt (Editorial Illustration Standard)
 * -----------------------------------------------------------
 */
const ARTWORK_BANNED_TERMS = [
  "pastel",
  "child",
  "children",
  "storybook",
  "playful",
  "cute",
  "whimsical",
  "fantasy",
  "dreamscape",
  "magic",
  "magical",
  "orb",
  "cartoon",
  "anime",
  "candy",
  "fairytale",
  "toy",
];

function sanitiseThemeText(description = "") {
  return String(description || "")
    .replace(/\s+/g, " ")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[^\w\s,.'’\-]/g, " ")
    .trim();
}

function isOffBrandArtworkPrompt(text = "") {
  const lowered = String(text || "").toLowerCase();
  return ARTWORK_BANNED_TERMS.some((term) => lowered.includes(term));
}

export function getArtworkPrompt(description, date) {
  const theme = sanitiseThemeText(description);

  return [
    "Premium editorial AI podcast cover art.",
    "Mood: sharp, sceptical, cinematic, adult, intelligent, grounded.",
    getSeasonalPaletteDirection(date),
    "Style: cinematic magazine-cover storytelling with one strong focal subject, emotional resonance, bold controlled colour, high contrast and clean negative space. Use people, hands, objects or real-world environments when they genuinely express the episode theme. Do not default to abstract geometry, data motifs or generic AI infrastructure.",
    STRICT_TEXT_FREE_RULE,
    "Avoid: pastel fantasy, dreamy clouds, magical orb, cute or childlike sci-fi, cartoon softness.",
    `Themes: ${theme || "AI systems, governance, power, risk, work, security."}`,
  ].join(" ").slice(0, 1600);
}


function firstSentences(text = "", limit = 2) {
  const sentences = normaliseWhitespace(text)
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return sentences.slice(0, limit).join(" ");
}

function deriveEpisodeSummary(description = "", mainOnly = "") {
  const candidate = firstSentences(description, 2) || firstSentences(mainOnly, 2);
  const words = normaliseWhitespace(candidate).split(/\s+/).filter(Boolean);
  return words.slice(0, 60).join(" ").replace(/[\s,;:.]+$/, ".");
}

function deriveEpisodeTakeaways({ description = "", mainOnly = "", topics = [] } = {}) {
  const topicText = topics.length ? oxfordJoin(topics.slice(0, 3)) : "the week’s AI story";
  const base = [
    `What changed: ${firstSentences(description, 1) || `${topicText} moved from headline noise into practical judgement.`}`,
    `Why it matters: listeners get the useful signal, the unresolved risk, and the power or money question underneath ${topicText}.`,
    "What to watch: whether the claims survive deployment, governance, cost, data and security pressure outside the launch deck.",
  ];

  const extra = normaliseWhitespace(mainOnly)
    .split(/(?<=[.!?])\s+/)
    .filter((line) => line.length > 80 && line.length < 220)
    .slice(0, 2);

  return uniqueKeywordList([...base, ...extra]).slice(0, 5);
}

function deriveEpisodeEntities({ keywords = [], topics = [], mainOnly = "" } = {}) {
  const candidateEntities = (mainOnly.match(/\b(?:OpenAI|Anthropic|Google|Microsoft|NVIDIA|Meta|Apple|Amazon|Gemini|Claude|GPT|LLM|AI governance|agentic AI|robotics|finance AI|healthcare AI)\b/gi) || [])
    .map((item) => item.replace(/\s+/g, " ").trim());
  return uniqueKeywordList([
    "Jonathan Harris",
    "Turing's Torch",
    "artificial intelligence",
    ...topics,
    ...candidateEntities,
    ...keywords,
  ]).slice(0, 12);
}

function deriveTopicIndex({ topics = [], keywords = [] } = {}) {
  return uniqueKeywordList([
    ...topics,
    ...keywords.filter((keyword) => /ai|artificial|governance|agent|model|automation|data|security|robot|finance|health/i.test(keyword)),
    "AI governance",
    "AI costs",
    "workflow automation",
  ]).slice(0, 8);
}

/* -----------------------------------------------------------
 * Episode Meta Generator
 * -----------------------------------------------------------
 */
export async function generateEpisodeMetaLLM(rawTranscript, sessionMeta = {}) {
  const sessionId = sessionMeta.sessionId || "episode";

  let mainOnly = "";
  try {
    mainOnly = extractMainContent(rawTranscript);
  } catch {
    mainOnly = rawTranscript || "";
  }

  const durationPlan = calculateDuration("episode", sessionMeta);
  const seoKeywordCandidates = detectSeoKeywordCandidates(mainOnly);

  // On-brand fallbacks. These are used only if the model output fails validation.
  let title = buildFallbackTitle(mainOnly);
  let description = buildFallbackDescription(mainOnly, durationPlan);

  try {
    const prompt = getTitleDescriptionPrompt(mainOnly, durationPlan);
    const tdRaw = await resilientRequest("metadata", {
      sessionId,
      messages: [{ role: "user", content: prompt }],
    });

    let parsed;
    try {
      parsed = JSON.parse(tdRaw);
    } catch {
      // Some models leak text around JSON; recover the first {...} block.
      const m = String(tdRaw || "").match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : null;
    }

    const candidate = {
      title: parsed?.title ? trimTitle(parsed.title) : "",
      description: parsed?.description ? String(parsed.description).trim() : "",
    };

    const v = validateMetaCandidate(candidate, durationPlan, seoKeywordCandidates);
    if (v.ok) {
      title = candidate.title;
      description = candidate.description;
    } else {
      warn("meta.titleDesc.invalid", { sessionId, reasons: v.reasons });
    }
  } catch (err) {
    error("meta.titleDesc.fail", { sessionId, message: err?.message });
  }

  /* SEO Keywords */
  let keywords = [];
  try {
    const kw = await resilientRequest("seoKeywords", {
      sessionId,
      messages: [{ role: "user", content: getSEOKeywordsPrompt({ title, description, mainOnly, keywordCandidates: seoKeywordCandidates }) }],
    });

    keywords = String(kw)
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 14);
  } catch {
    keywords = uniqueKeywordList([
      ...seoKeywordCandidates,
      "artificial intelligence",
      "ai governance",
      "ai podcast",
      "jonathan harris",
    ]).map((k) => k.toLowerCase()).slice(0, 14);
  }

  keywords = uniqueKeywordList([...keywords, ...seoKeywordCandidates])
    .map((k) => k.toLowerCase())
    .slice(0, 14);

  const detectedTopics = detectTopics(mainOnly);
  const episodeSummary = deriveEpisodeSummary(description, mainOnly);
  const keyTakeaways = deriveEpisodeTakeaways({ description, mainOnly, topics: detectedTopics });
  const entities = deriveEpisodeEntities({ keywords, topics: detectedTopics, mainOnly });
  const topicIndex = deriveTopicIndex({ topics: detectedTopics, keywords });

  const discoveryMetadata = buildPodcastDiscoveryMetadata({
    title,
    description,
    mainOnly,
    keywords,
    keywordCandidates: seoKeywordCandidates,
  });

  // Keep the public episode keyword list natural and specific. The old iTunes
  // keyword field is retained as a short legacy compatibility string only.
  keywords = discoveryMetadata.episodeTerms.map((k) => k.toLowerCase()).slice(0, 14);

  /* Artwork Prompt */
  let artworkPrompt = applyArtworkPromptPolicy(getArtworkPrompt(description, sessionId), { date: sessionId, mode: "podcast" });
  try {
    const candidatePrompt = await resilientRequest("artworkPrompt", {
      sessionId,
      messages: [{ role: "user", content: `${buildPodcastArtworkPersona()}\n\nCreate only an image-generation prompt.\n${getArtworkPrompt(description, sessionId)}` }],
    });

    const cleanedCandidate = String(candidatePrompt || "").replace(/\s+/g, " ").trim().slice(0, 500);
    if (cleanedCandidate && !isOffBrandArtworkPrompt(cleanedCandidate)) {
      artworkPrompt = applyArtworkPromptPolicy(cleanedCandidate, { date: sessionId, mode: "podcast" });
    } else if (cleanedCandidate) {
      warn("meta.artwork.offbrand", { sessionId, candidatePrompt: cleanedCandidate });
    }

    await sessionCache.storeTempPart(sessionMeta, "artworkPrompt", artworkPrompt);
  } catch {
    error("meta.artwork.fail", { sessionId });
  }

  const meta = {
    sessionId,
    title,
    description,
    host: HOST_NAME,
    podcastTitle: PODCAST_TITLE,
    targetMins: durationPlan.targetMins,
    targetMinutes: durationPlan.targetMinutes,
    plannedDurationSeconds: durationPlan.plannedDurationSeconds,
    durationPlan,
    keywords,
    seoKeywordCandidates,
    topics: detectedTopics,
    summary: episodeSummary,
    episodeSummary,
    shortSummary: episodeSummary,
    keyTakeaways,
    takeaways: keyTakeaways,
    entities,
    topicIndex,
    discoveryMetadata,
    itunesKeywords: discoveryMetadata.legacy.itunesKeywordsCsv,
    artworkPrompt,
    createdAt: new Date().toISOString(),
  };

  debug("meta.complete", { sessionId, targetMins: durationPlan.targetMins });
  info("🎧 podcast.meta.ready", { sessionId });

  return meta;
}

export const __testing = {
  buildFallbackTitle,
  buildFallbackDescription,
  detectTopics,
  detectSeoKeywordCandidates,
  textUsesSeoKeyword,
  getMetadataDescriptionBounds,
  validateMetaCandidate,
  isLikelyGenericTitle,
  deriveEpisodeSummary,
  deriveEpisodeTakeaways,
  deriveEpisodeEntities,
  deriveTopicIndex,
};

export default {
  getTitleDescriptionPrompt,
  getSEOKeywordsPrompt,
  getArtworkPrompt,
  generateEpisodeMetaLLM,
};
