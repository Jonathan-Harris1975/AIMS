// services/script/utils/podcastHelper.js
// Production-grade podcast metadata generation:
// title, description, SEO keywords, artwork prompt

import { resilientRequest } from "../../shared/utils/ai-service.js";
import * as sessionCache from "./sessionCache.js";
import { info, error, debug, warn } from "../../../logger.js";
import { extractMainContent } from "./textHelpers.js";

/* -----------------------------------------------------------
 * Title + Description Prompt (Editorial SEO)
 * -----------------------------------------------------------
 */
export function getTitleDescriptionPrompt(mainOnly) {
  return `
You are writing the episode metadata for the podcast:
"Turing’s Torch AI Weekly".

VOICE (non‑negotiable):
- British Gen‑X
- sharp, sceptical, mildly sarcastic when deserved
- conversational (smart mate in a pub), not "editorial"
- no hype, no corporate optimism, no buzzword soup

HARD RULES:
- Output MUST be STRICT JSON ONLY (no markdown, no commentary).
- Title: 10–80 characters.
  - Punchy and specific.
  - Avoid colons unless absolutely necessary.
  - No "Episode", no numbers, no emojis.
  - No bland titles like "AI Weekly" or "Artificial Intelligence News".
- Description: 320–750 characters.
  - 2–3 short paragraphs.
  - Say what happened, what matters, and what’s probably noise.
  - Never use clichés like "In this episode", "we explore", "groundbreaking", "rapidly evolving", "landscape".
  - Don’t mention sources, websites, or URLs.

Return STRICT JSON ONLY:
{"title":"","description":""}

MAIN CONTENT (use only this):
${mainOnly}
`.trim();
}

function isLikelyGenericTitle(title = "") {
  const t = String(title || "").toLowerCase().trim();
  if (!t) return true;
  const generic = [
    "ai weekly",
    "artificial intelligence weekly",
    "artificial intelligence news",
    "ai news",
    "weekly ai",
    "tech news",
    "podcast",
  ];
  if (generic.includes(t)) return true;
  if (t.length < 10) return true;
  return false;
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
  ];
  return banned.some((p) => t.includes(p));
}

function validateMetaCandidate({ title, description } = {}) {
  const out = { ok: true, reasons: [] };

  const tt = String(title || "").trim();
  const dd = String(description || "").trim();

  if (tt.length < 10 || tt.length > 80) {
    out.ok = false;
    out.reasons.push(`title length ${tt.length} (expected 10–80 chars)`);
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
  if (dLen < 320 || dLen > 750) {
    out.ok = false;
    out.reasons.push(`description length ${dLen} (expected 320–750 chars)`);
  }
  if (containsBannedPhrases(dd)) {
    out.ok = false;
    out.reasons.push("description contains banned phrase");
  }
  if (/https?:\/\//i.test(dd)) {
    out.ok = false;
    out.reasons.push("description contains URL");
  }

  return out;
}

/* -----------------------------------------------------------
 * SEO Keywords Prompt (Supportive, not spammy)
 * -----------------------------------------------------------
 */
export function getSEOKeywordsPrompt(description) {
  return `
Generate 10–14 SEO keywords that a real person might search for.
Lowercase, comma-separated.
No hashtags.
No duplication.
No generic filler.

Base them ONLY on this description:
${description}

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

export function getArtworkPrompt(description) {
  const theme = sanitiseThemeText(description);

  return [
    "Premium editorial AI podcast cover art.",
    "Mood: sharp, sceptical, cinematic, adult, intelligent, grounded.",
    "Palette: deep navy, charcoal, restrained teal, muted purple, soft metallic highlights.",
    "Style: abstract technological realism, clean geometry, subtle data motifs, negative space, no text.",
    "Avoid: pastel fantasy, dreamy clouds, magical orb, cute or childlike sci-fi, cartoon softness.",
    `Themes: ${theme || "AI systems, governance, power, risk, work, security."}`,
  ].join(" ").slice(0, 500);
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

  /* Title + Description */
  const dateStr =
    (sessionMeta?.date && String(sessionMeta.date).slice(0, 10)) ||
    new Date().toISOString().slice(0, 10);

  // On-brand fallbacks (only used if the model output fails validation)
  let title = `Turing’s Torch AI Weekly — ${dateStr}`;
  let description =
    "A blunt, British take on what actually mattered in AI this week — and what was just noise dressed as a breakthrough.";

  try {
    const prompt = getTitleDescriptionPrompt(mainOnly);
    const tdRaw = await resilientRequest("metadata", {
      sessionId,
      messages: [{ role: "user", content: prompt }],
    });

    let parsed;
    try {
      parsed = JSON.parse(tdRaw);
    } catch {
      // Some models leak text around JSON — recover the first {...} block.
      const m = String(tdRaw || "").match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : null;
    }

    const candidate = {
      title: parsed?.title ? String(parsed.title).trim() : "",
      description: parsed?.description ? String(parsed.description).trim() : "",
    };

    const v = validateMetaCandidate(candidate);
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
      messages: [{ role: "user", content: getSEOKeywordsPrompt(description) }]
    });

    keywords = String(kw)
      .split(",")
      .map(k => k.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 14);
  } catch {
    keywords = ["artificial intelligence", "ai news", "machine learning", "technology"];
  }

  /* Artwork Prompt */
  let artworkPrompt = getArtworkPrompt(description);
  try {
    const candidatePrompt = await resilientRequest("artworkPrompt", {
      sessionId,
      messages: [{ role: "user", content: getArtworkPrompt(description) }]
    });

    const cleanedCandidate = String(candidatePrompt || "").replace(/\s+/g, " ").trim().slice(0, 500);
    if (cleanedCandidate && !isOffBrandArtworkPrompt(cleanedCandidate)) {
      artworkPrompt = cleanedCandidate;
    } else if (cleanedCandidate) {
      warn("meta.artwork.offbrand", { sessionId, candidatePrompt: cleanedCandidate });
    }

    await sessionCache.storeTempPart(sessionMeta, "artworkPrompt", artworkPrompt);
  } catch {
    error("meta.artwork.fail", { sessionId });
  }

  const meta = {
    title,
    description,
    keywords,
    artworkPrompt,
    createdAt: new Date().toISOString()
  };

  debug("meta.complete", { sessionId });
  info("🎧 podcast.meta.ready", { sessionId });

  return meta;
}

export default {
  getTitleDescriptionPrompt,
  getSEOKeywordsPrompt,
  getArtworkPrompt,
  generateEpisodeMetaLLM
};
