// services/newsletter/engine/heroImage.js
//
// Generates exactly one hero image per newsletter issue — never one per
// story. Reuses the existing blog artwork pipeline (same model routing,
// same R2 buckets) rather than standing up a parallel image pipeline.

import { resilientRequest } from "../../shared/utils/ai-service.js";
import { createBlogArtwork } from "../../artwork/createBlogArtwork.js";
import { warn } from "../../../logger.js";

export function selectNewsletterArtLead({ lead, stories = [], bigThree = [] }) {
  const sources = [lead, ...stories].filter(Boolean);
  const selected = bigThree[0];
  return sources.find((source) => source.link === selected?.link) || lead;
}

function safeAttemptDiagnostic(result, attempt) {
  const supplied = result?.artworkDiagnostics;
  const reasonCodes = Array.isArray(supplied?.reasonCodes)
    ? supplied.reasonCodes.filter((code) => /^[a-z_]{1,48}$/.test(String(code))).slice(0, 4)
    : [];
  const scores = supplied?.scores && typeof supplied.scores === "object"
    ? Object.fromEntries(Object.entries(supplied.scores)
      .filter(([, value]) => Number.isFinite(Number(value)))
      .slice(0, 8)
      .map(([key, value]) => [key, Math.max(0, Math.min(100, Math.round(Number(value))))]))
    : null;
  const provider = supplied?.provider && typeof supplied.provider === "object"
    ? Object.fromEntries(["id", "model"].filter((key) =>
      typeof supplied.provider[key] === "string" && /^[a-zA-Z0-9._:/-]{1,120}$/.test(supplied.provider[key]))
      .map((key) => [key, supplied.provider[key]]))
    : null;
  const stage = supplied?.stage === "visual_qa" ? "visual_qa" : "generation";
  return {
    attempt,
    outcome: stage === "visual_qa" ? "visual_qa_failed" : "generation_failed",
    stage,
    reasonCodes,
    scores,
    provider: provider && Object.keys(provider).length ? provider : null,
    recoveryAttempted: attempt === 1,
  };
}

/**
 * Asks the model for a single, concrete art-direction prompt for the day's
 * hero image, grounded in the lead story's headline (not the individual
 * top-10 stories — those never get their own artwork).
 */
export async function buildHeroImagePrompt({ profile, heroHeadline, leadStory = null, bigThree = [], sessionId, repairDiagnostics = null }) {
  const messages = [
    {
      role: "system",
      content:
        "You write a single concise image-generation prompt (1-2 sentences) for the hero " +
        "illustration for the AI Edge newsletter. Build one visually immediate editorial scene from the actual lead news story, not merely the headline wording. " +
        "Use cinematic lighting, emotional resonance, bold controlled colour, high contrast and magazine-quality thumbnail composition. " +
        "The image must be newly generated for this issue and specific to today's lead story; never use a generic brand image, site icon, logo or reusable fallback artwork. " +
        "Begin with the specific source-supported subject and visible action, before lighting or styling. Never make geometric shapes, polygons, glowing orbs, networks or \
decorative AI symbols the subject. " +
        "Prefer a concrete human-scale scene, real-world object, consequence or workplace moment over generic abstract AI geometry. Use believable adult humans when a person helps tell the story. " +
        "Do not depict humanoid robots, cyborgs, androids, chrome people, synthetic heads or robot substitutes unless the lead story is specifically about physical robotics. " +
        "Avoid corporate stock-photo language, boardrooms, handshakes, staged office teams, generic data centres, floating dashboards, polygon networks and glowing AI orbs \
unless the headline genuinely requires them. " +
        "The image must visibly belong to technology, AI security, governance, software engineering or the specific news domain described. " +
        "Never use beaches, coastlines, oceans, resorts, tourism, travel, countryside, mountains, roads, paths, signposts, sunsets or lifestyle imagery unless the lead article \
itself is explicitly about that subject. " +
        "Prefer physical objects and human-scale consequences that do not require visible screens. " +
        "If a screen is unavoidable, turn it away or keep it dark and naturally defocused. " +
        "Never include typography, headlines, letters, numbers, logos, watermarks or pseudo-text inside the image. " +
        "Seasonal colour is a subtle palette accent only; the story scene always takes priority. No depictions of real named people. " +
        "Respond with ONLY the prompt text, nothing else.",
    },
    {
      role: "user",
      content: JSON.stringify({
        heroHeadline,
        leadStory: leadStory ? { title: leadStory.title, summary: leadStory.summary } : null,
        // The lead alone grounds the image; secondary headlines invite collages.
        recovery: repairDiagnostics ? {
          reasonCodes: repairDiagnostics.reasonCodes,
          direction: "Choose a different source-supported physical scene. Use plain unmarked equipment, a quiet background and one visible action. " +
            "Keep screens, documents, labels, diagrams and decorative geometry out of frame. Describe what should be visible, not a list of forbidden objects.",
        } : null,
      }),
    },
  ];

  try {
    const raw = await resilientRequest("newsletterHeroPrompt", { sessionId, messages, max_tokens: 220 });
    const prompt = String(raw || "").trim();
    const forbidden = /\b(beach|coast|coastline|ocean|sea|resort|tourism|travel|holiday|countryside|mountain|road|path|signpost|sunset|landscape|vacation)\b/i;
    if (prompt && !forbidden.test(prompt)) return prompt;
    if (prompt) warn("newsletter.hero.prompt_rejected_off_topic", { sessionId, heroHeadline, prompt });
  } catch (err) {
    warn("newsletter.hero.prompt_generation_failed", { sessionId, error: err.message });
  }

  return `Source-specific editorial photograph: ${leadStory?.title || heroHeadline}. Context: ${leadStory?.summary || ""}. Show one recognisable physical subject and action \
that expresses this story's actual consequence. Believable human-scale detail, clean unmarked surfaces, cinematic natural light. No geometric wallpaper, floating shapes, \
glowing networks, text, logos or unrelated scenery.`;

}

/**
 * Generates the prompt and the image, uploads to the profile's configured
 * blog-images bucket under newsletter/{profileId}/{sessionId}.png.
 */
export async function generateHeroImage({ profile, heroHeadline, leadStory = null, bigThree = [], sessionId }, {
  buildPrompt = buildHeroImagePrompt,
  createArtwork = createBlogArtwork,
} = {}) {
  const originalPrompt = await buildPrompt({ profile, heroHeadline, leadStory, bigThree, sessionId });
  let prompt = originalPrompt;
  let result;
  const attempts = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      result = await createArtwork({
        sessionId: attempt === 1 ? sessionId : `${sessionId}-artwork-repair`,
        prompt, keyPrefix: profile.storage.keyPrefix, mode: "newsletter",
      });
    } catch (error) { result = { ok: false, error: error.message }; }
    if (result?.ok && result.publicUrl && !result.fallback && result.imageStatus !== "deterministic-fallback") {
      return { ok: true, prompt, imageUrl: result.publicUrl, key: result.key,
        bucketKey: result.bucketKey, imageStatus: "generated" };
    }
    attempts.push(safeAttemptDiagnostic(result, attempt));
    if (attempt === 1) {
      const feedback = result?.artworkDiagnostics?.stage === "visual_qa"
        ? "Newsletter artwork failed visual QA."
        : String(result?.error || result?.warning || "No usable generated artwork returned.").slice(0, 500);
      warn("newsletter.hero.corrective_retry", {
        sessionId, profileId: profile.id, error: feedback,
        artworkDiagnostics: attempts[0],
      });
      const replacement = await buildPrompt({ profile, heroHeadline, leadStory, bigThree: [],
        sessionId: `${sessionId}-art-direction-repair`, repairDiagnostics: attempts[0] });
      prompt = [
        String(replacement || "").trim().slice(0, 1000) || `Source-specific editorial photograph about ${leadStory?.title || heroHeadline}.`,
        "CORRECTIVE RENDER: simplify the scene to one clear physical subject and one source-supported action. Preserve the news topic and editorial photographic style.",
        "Replace busy monitor or control-cabinet compositions. Do not show screens, control panels, documents, printed surfaces, " +
        "labels, logos, readable text or pseudo-text. Keep hands out of frame and avoid complex reflections.",
        "Use a close-up of a single plausible physical object, with no robotic manipulators, molecular diagrams, glassware labels, interfaces or written markings.",
      ].join(" ");
    }
  }
  const artworkDiagnostics = {
    stage: attempts.some((item) => item.stage === "visual_qa") ? "visual_qa" : "generation",
    attemptCount: attempts.length,
    recoveryAttempted: attempts.length > 1,
    attempts,
  };
  const visualQaFailed = artworkDiagnostics.stage === "visual_qa";
  const error = visualQaFailed
    ? "Newsletter artwork did not pass visual QA after bounded recovery."
    : result?.error || "Newsletter requires newly generated artwork; diagnostic fallback rejected.";
  warn("newsletter.hero.generation_failed", {
    sessionId,
    profileId: profile.id,
    error: visualQaFailed ? error : String(error).slice(0, 500),
    artworkDiagnostics,
  });
  return { ok: false, error, prompt, artworkDiagnostics };
}

export default { buildHeroImagePrompt, generateHeroImage };
