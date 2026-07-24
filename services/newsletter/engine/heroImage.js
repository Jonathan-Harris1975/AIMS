// services/newsletter/engine/heroImage.js
//
// Generates exactly one hero image per newsletter issue — never one per
// story. Reuses the existing blog artwork pipeline (same model routing,
// same R2 buckets) rather than standing up a parallel image pipeline.

import { resilientRequest } from "../../shared/utils/ai-service.js";
import { createBlogArtwork } from "../../artwork/createBlogArtwork.js";
import { warn } from "../../../logger.js";

/**
 * Asks the model for a single, concrete art-direction prompt for the day's
 * hero image, grounded in the lead story's headline (not the individual
 * top-10 stories — those never get their own artwork).
 */
export async function buildHeroImagePrompt({ profile, heroHeadline, sessionId }) {
  const messages = [
    {
      role: "system",
      content:
        "You write a single concise image-generation prompt (1-2 sentences) for the hero " +
        "illustration of a daily AI newsletter. Build one visually immediate story from the lead headline. " +
        "Use cinematic lighting, emotional resonance, bold controlled colour, high contrast and magazine-quality thumbnail composition. " +
        "Prefer a concrete scene, object, consequence or human-scale moment over generic abstract AI geometry. Avoid corporate stock-photo language, " +
        "boardrooms, handshakes, staged office teams, generic data centres, floating dashboards, polygon networks and glowing AI orbs unless the headline genuinely requires them. " +
        "Seasonal colour direction is applied downstream, so do not fight it. No text or logos in the image and no depictions of real named people. " +
        "Respond with ONLY the prompt text, nothing else.",
    },
    { role: "user", content: `Today's lead headline: ${heroHeadline}` },
  ];

  try {
    const raw = await resilientRequest("newsletterHeroPrompt", { sessionId, messages, max_tokens: 150 });
    const prompt = String(raw || "").trim();
    if (prompt) return prompt;
  } catch (err) {
    warn("newsletter.hero.prompt_generation_failed", { sessionId, error: err.message });
  }

  return `Cinematic magazine-quality editorial story image with a strong focal subject, emotional tension, bold controlled colour and high contrast, themed specifically around: ${heroHeadline}. Avoid generic corporate or abstract AI imagery.`;
}

/**
 * Generates the prompt and the image, uploads to the profile's configured
 * blog-images bucket under newsletter/{profileId}/{sessionId}.png.
 */
export async function generateHeroImage({ profile, heroHeadline, sessionId }) {
  const prompt = await buildHeroImagePrompt({ profile, heroHeadline, sessionId });

  const result = await createBlogArtwork({
    sessionId,
    prompt,
    keyPrefix: profile.storage.keyPrefix,
  });

  if (!result.ok) {
    warn("newsletter.hero.generation_failed", { sessionId, profileId: profile.id, error: result.error });
    return { ok: false, error: result.error, prompt };
  }

  return { ok: true, prompt, imageUrl: result.publicUrl, key: result.key };
}

export default { buildHeroImagePrompt, generateHeroImage };
