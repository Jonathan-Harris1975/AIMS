// services/script/utils/podcastHelper.js
// Production-grade podcast metadata generation:
// title, description, SEO keywords, artwork prompt

import { resilientRequest } from "../../shared/utils/ai-service.js";
import * as sessionCache from "./sessionCache.js";
import { info, error, debug } from "../../../logger.js";
import { extractMainContent } from "./textHelpers.js";

/* -----------------------------------------------------------
 * Title + Description Prompt (Editorial SEO)
 * -----------------------------------------------------------
 */
export function getTitleDescriptionPrompt(mainOnly) {
  return `
You are writing metadata for a premium artificial intelligence news podcast.

GOAL:
Attract intelligent listeners who want understanding, not hype.

RULES:
- Title: ≤80 characters, clear, specific, human-sounding
- Avoid buzzwords, colons, emojis, or clickbait
- Description: conversational, confident, explains why this episode matters
- Write for podcast listeners first, search engines second

Return STRICT JSON ONLY:
{
  "title": "",
  "description": ""
}

MAIN SECTION CONTENT:
${mainOnly}
`.trim();
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
export function getArtworkPrompt(description) {
  const month = new Date().getMonth();
  let seasonalTone = "neutral light and shadow";

  if (month >= 2 && month <= 4) seasonalTone = "soft spring light, restrained colour";
  else if (month >= 5 && month <= 7) seasonalTone = "warm summer contrast, gentle glow";
  else if (month >= 8 && month <= 10) seasonalTone = "muted autumn tones, subtle depth";
  else seasonalTone = "cool winter palette, clean contrast";

  return `
Create a premium editorial illustration inspired by the themes below.

STYLE:
Abstract, modern, intelligent.
Organic shapes, smooth gradients, quiet complexity.
Subtle reaction–diffusion or mathematical texture as a nod to foundational AI ideas.
${seasonalTone}.

STRICT RULES:
- No people
- No faces or silhouettes
- No robots
- No circuitry
- No text or lettering
- No logos
- Abstract only
- ≤250 characters

THEMES:
${description}
`.trim();
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
  let title = "Artificial Intelligence Weekly";
  let description = "A clear-eyed look at what actually matters in artificial intelligence.";

  try {
    const td = await resilientRequest("meta-title-description", {
      sessionId,
      messages: [{ role: "user", content: getTitleDescriptionPrompt(mainOnly) }]
    });

    const parsed = JSON.parse(td);
    if (parsed?.title) title = parsed.title.trim();
    if (parsed?.description) description = parsed.description.trim();
  } catch {
    error("meta.titleDesc.fail", { sessionId });
  }

  /* SEO Keywords */
  let keywords = [];
  try {
    const kw = await resilientRequest("meta-seo", {
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
  let artworkPrompt = "";
  try {
    artworkPrompt = await resilientRequest("meta-artwork", {
      sessionId,
      messages: [{ role: "user", content: getArtworkPrompt(description) }]
    });

    artworkPrompt = String(artworkPrompt).slice(0, 250);
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
