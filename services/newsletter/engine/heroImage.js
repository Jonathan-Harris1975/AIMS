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
export async function buildHeroImagePrompt({ profile, heroHeadline, leadStory = null, bigThree = [], sessionId }) {
  const messages = [
    {
      role: "system",
      content:
        "You write a single concise image-generation prompt (1-2 sentences) for the hero " +
        "illustration for the AI Edge newsletter. Build one visually immediate editorial scene from the actual lead news story, not merely the headline wording. " +
        "Use cinematic lighting, emotional resonance, bold controlled colour, high contrast and magazine-quality thumbnail composition. " +
        "Prefer a concrete human-scale scene, real-world object, consequence or workplace moment over generic abstract AI geometry. Use believable adult humans when a person helps tell the story. " +
        "Do not depict humanoid robots, cyborgs, androids, chrome people, synthetic heads or robot substitutes unless the lead story is specifically about physical robotics. " +
        "Avoid corporate stock-photo language, boardrooms, handshakes, staged office teams, generic data centres, floating dashboards, polygon networks and glowing AI orbs unless the headline genuinely requires them. " +
        "The image must visibly belong to technology, AI security, governance, software engineering or the specific news domain described. " +
        "Never use beaches, coastlines, oceans, resorts, tourism, travel, countryside, mountains, roads, paths, signposts, sunsets or lifestyle imagery unless the lead article itself is explicitly about that subject. " +
        "Never include typography, headlines, letters, numbers, logos, watermarks or pseudo-text inside the image. Seasonal colour direction is applied downstream, so do not fight it. No depictions of real named people. " +
        "Respond with ONLY the prompt text, nothing else.",
    },
    {
      role: "user",
      content: JSON.stringify({
        heroHeadline,
        leadStory: leadStory ? { title: leadStory.title, summary: leadStory.summary } : null,
        supportingHeadlines: bigThree.slice(0, 3).map((item) => item.title),
      }),
    },
  ];

  try {
    const raw = await resilientRequest("newsletterHeroPrompt", { sessionId, messages, max_tokens: 150 });
    const prompt = String(raw || "").trim();
    const forbidden = /\b(beach|coast|coastline|ocean|sea|resort|tourism|travel|holiday|countryside|mountain|road|path|signpost|sunset|landscape|vacation)\b/i;
    if (prompt && !forbidden.test(prompt)) return prompt;
    if (prompt) warn("newsletter.hero.prompt_rejected_off_topic", { sessionId, heroHeadline, prompt });
  } catch (err) {
    warn("newsletter.hero.prompt_generation_failed", { sessionId, error: err.message });
  }

  const context = `${heroHeadline} ${leadStory?.title || ""} ${leadStory?.summary || ""}`.toLowerCase();
  if (/secure|security|attack|adversarial|vulnerab|governance|agent/.test(context)) {
    return "Cinematic editorial close-up of an isolated AI inference server behind layered physical security glass, with one subtle corrupted input pattern breaching an otherwise controlled system; tense technical atmosphere, realistic hardware, high contrast, no people, no hands, no text, no logos, no travel or landscape imagery.";
  }
  return `Cinematic magazine-quality editorial image rooted directly in this AI news story: ${heroHeadline}. Show a specific real technical consequence or workplace object, not travel, scenery or lifestyle imagery. No text, letters, numbers, logos, humanoid robots, cyborgs or visible hands.`;
}

/**
 * Generates the prompt and the image, uploads to the profile's configured
 * blog-images bucket under newsletter/{profileId}/{sessionId}.png.
 */
export async function generateHeroImage({ profile, heroHeadline, leadStory = null, bigThree = [], sessionId }) {
  const prompt = await buildHeroImagePrompt({ profile, heroHeadline, leadStory, bigThree, sessionId });

  const result = await createBlogArtwork({
    sessionId,
    prompt,
    keyPrefix: profile.storage.keyPrefix,
    mode: "newsletter",
  });

  if (!result.ok) {
    warn("newsletter.hero.generation_failed", { sessionId, profileId: profile.id, error: result.error });
    return { ok: false, error: result.error, prompt };
  }

  return { ok: true, prompt, imageUrl: result.publicUrl, key: result.key };
}

export default { buildHeroImagePrompt, generateHeroImage };
