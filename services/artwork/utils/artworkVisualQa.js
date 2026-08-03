// services/artwork/utils/artworkVisualQa.js
//
// Multimodal post-generation QA for editorial artwork. Prompt compliance is
// not proof that an image is usable: image models can still invent typography,
// drift into travel imagery or produce a decorative infographic unrelated to
// the article. This audit inspects the pixels before upload/publication.

import { detectImageFormat } from "./imageFormat.js";

const DEFAULT_THRESHOLD = Math.max(1, Math.min(100, Number(process.env.ARTWORK_VISUAL_QA_THRESHOLD || 80)));

function compact(value = "", max = 4000) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function extractJsonObject(raw = "") {
  const text = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  const candidate = first >= 0 && last > first ? text.slice(first, last + 1) : text;
  return JSON.parse(candidate);
}

function numberScore(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : fallback;
}

function stringArray(value) {
  return Array.isArray(value) ? value.map((item) => compact(item, 320)).filter(Boolean).slice(0, 12) : [];
}

export function normaliseArtworkVisualQa(raw, { threshold = DEFAULT_THRESHOLD } = {}) {
  const parsed = typeof raw === "string" ? extractJsonObject(raw) : raw;
  const defects = stringArray(parsed?.defects);
  const hardDefects = stringArray(parsed?.hardDefects);
  const score = numberScore(parsed?.score);
  const relevance = numberScore(parsed?.relevance);
  const textSafety = numberScore(parsed?.textSafety);
  const composition = numberScore(parsed?.composition);
  const brandFit = numberScore(parsed?.brandFit);
  const hardFailure = hardDefects.length > 0;
  const pass = !hardFailure && score >= threshold && relevance >= 70 && textSafety >= 90;

  return {
    pass,
    score,
    threshold,
    relevance,
    textSafety,
    composition,
    brandFit,
    defects,
    hardDefects,
    summary: compact(parsed?.summary || "", 700),
  };
}

export function buildArtworkVisualQaPrompt({ mode = "editorial", creativePrompt = "" } = {}) {
  const rules = {
    podcast: [
      "The image must visibly communicate a concrete subject from the episode brief. A generic AI emblem, digital snowflake, circuit mandala, neural flower, floating polygon or decorative data network is a hard failure.",
      "It must look like adult technology journalism rather than fantasy, lifestyle, generic sci-fi or a permanent show logo.",
      "Any readable or pseudo-readable typography, logo or watermark is a hard failure.",
    ],
    blog: [
      "The image must represent the article title, summary and dominant themes through one concrete editorial scene rather than generic AI decoration.",
      "A stock office, decorative data centre, abstract network or unrelated technology scene is a hard failure when it does not express the article's actual angle.",
      "Any readable or pseudo-readable typography, logo or watermark is a hard failure.",
    ],
    newsletter: [
      "The image must look like serious AI/technology editorial journalism and visibly represent the lead story, not travel, tourism, lifestyle, a generic banner, magazine-cover mock-up or scenic wallpaper.",
      "Any readable or pseudo-readable typography is a hard failure.",
    ],
    social: [
      "The image must communicate the supplied post and lane at phone-thumbnail size through one concrete focal idea.",
      "Generated labels, callout boxes, dashboards, pseudo-text, infographic panels and decorative UI are hard failures.",
    ],
    "social-blog": [
      "The image must visibly match the selected source story and its stated consequence or decision, not merely the broad topic of AI.",
      "Generated labels, callout boxes, dashboards, pseudo-text, infographic panels and decorative UI are hard failures.",
    ],
    quiz: [
      "Visible text is required. Compare it against the supplied question/answer brief: missing, altered, repeated, invented or illegible wording is a hard failure.",
      "A question card must show exactly four equally weighted options without revealing the answer. An answer card must retain all four options and highlight only the correct one.",
      "Tiny text, weak contrast, clutter or a layout that is unreadable on a phone is a hard failure.",
    ],
  };
  const modeRules = rules[mode] || ["Judge whether the image is specific to the supplied editorial brief rather than generic decoration."];

  return [
    "Audit this generated image. Judge the actual pixels, not the claimed prompt compliance.",
    "Check topical relevance, focal clarity, composition, brand fit, anatomy, object coherence and text behaviour.",
    ...modeRules,
    `Mode: ${mode}.`,
    `Creative brief: ${compact(creativePrompt, 3000)}`,
    "Return JSON only with exactly these keys:",
    '{"score":0,"relevance":0,"textSafety":0,"composition":0,"brandFit":0,"defects":[],"hardDefects":[],"summary":""}',
    "Scores are 0-100. Put every publication-blocking defect in hardDefects. Be strict: attractive but off-topic artwork does not pass.",
  ].join("\n");
}

export async function auditArtworkBase64({ base64, mode = "editorial", creativePrompt = "", sessionId = "artwork-qa", signal } = {}) {
  const image = String(base64 || "").trim();
  if (!image) throw new Error("Artwork visual QA requires a base64 image.");

  const { base64: cleanBase64, mimeType } = detectImageFormat(image);
  const { resilientRequest } = await import("../../shared/utils/ai-service.js");
  const parseAttempts = Math.max(1, Math.min(3, Number(process.env.ARTWORK_VISUAL_QA_PARSE_ATTEMPTS || 2)));
  let lastError;

  for (let attempt = 1; attempt <= parseAttempts; attempt += 1) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Artwork visual QA aborted");
    const raw = await resilientRequest("artworkVisualQa", {
      sessionId: `${sessionId}-${attempt}`,
      max_tokens: 700,
      temperature: 0.1,
      reasoning: { effort: "minimal" },
      response_format: { type: "json_object" },
      maxRetries: 1,
      signal,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${buildArtworkVisualQaPrompt({ mode, creativePrompt })}${attempt > 1 ? "\nYour previous response was malformed. Return one complete valid JSON object only." : ""}`,
            },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${cleanBase64}` } },
          ],
        },
      ],
    });

    try {
      return normaliseArtworkVisualQa(raw);
    } catch (error) {
      lastError = error;
      if (attempt >= parseAttempts) throw error;
    }
  }

  throw lastError || new Error("Artwork visual QA returned no valid result");
}

export default { auditArtworkBase64, buildArtworkVisualQaPrompt, normaliseArtworkVisualQa };
