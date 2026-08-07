// services/artwork/utils/artworkVisualQa.js
//
// Multimodal post-generation QA for editorial artwork. Prompt compliance is
// not proof that an image is usable: image models can still invent typography,
// drift into travel imagery or produce a decorative infographic unrelated to
// the article. This audit inspects the pixels before upload/publication.

import { detectImageFormat } from "./imageFormat.js";
import { parseStructuredJson, strictJsonResponseFormat } from "../../shared/utils/structuredJson.js";

const DEFAULT_THRESHOLD = Math.max(1, Math.min(100, Number(process.env.ARTWORK_VISUAL_QA_THRESHOLD || 80)));
const DEFAULT_MIN_RELEVANCE = Math.max(0, Math.min(100, Number(process.env.ARTWORK_VISUAL_QA_MIN_RELEVANCE || 70)));
const DEFAULT_MIN_TEXT_SAFETY = Math.max(0, Math.min(100, Number(process.env.ARTWORK_VISUAL_QA_MIN_TEXT_SAFETY || 90)));

function modeQaNumber(mode, suffix, fallback) {
  const prefix = String(mode || "editorial").replace(/[^a-z0-9]+/gi, "_").toUpperCase();
  const raw = process.env[`${prefix}_ARTWORK_VISUAL_QA_${suffix}`];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : fallback;
}

export function artworkVisualQaThresholds(mode = "editorial") {
  return {
    threshold: modeQaNumber(mode, "THRESHOLD", DEFAULT_THRESHOLD),
    minRelevance: modeQaNumber(mode, "MIN_RELEVANCE", DEFAULT_MIN_RELEVANCE),
    minTextSafety: modeQaNumber(mode, "MIN_TEXT_SAFETY", DEFAULT_MIN_TEXT_SAFETY),
  };
}

const ARTWORK_QA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "number", minimum: 0, maximum: 100 },
    relevance: { type: "number", minimum: 0, maximum: 100 },
    textSafety: { type: "number", minimum: 0, maximum: 100 },
    composition: { type: "number", minimum: 0, maximum: 100 },
    brandFit: { type: "number", minimum: 0, maximum: 100 },
    defects: {
      type: "array",
      maxItems: 8,
      items: { type: "string", maxLength: 320 },
    },
    hardDefects: {
      type: "array",
      maxItems: 6,
      items: { type: "string", maxLength: 320 },
    },
    summary: { type: "string", maxLength: 700 },
  },
  required: ["score", "relevance", "textSafety", "composition", "brandFit", "defects", "hardDefects", "summary"],
};

function compact(value = "", max = 4000) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function extractJsonObject(raw = "") {
  return parseStructuredJson(raw, "artwork visual QA response");
}

function numberScore(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : fallback;
}

function stringArray(value) {
  return Array.isArray(value) ? value.map((item) => compact(item, 320)).filter(Boolean).slice(0, 12) : [];
}

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  return ["1", "true", "yes", "on", "y"].includes(String(raw).trim().toLowerCase());
}

const SPECULATIVE_DEFECT_PATTERN = /\b(?:possible|possibly|appears? to|may be|might be|could be|cannot confirm|can\'t confirm|borderline|if confirmed|at any zoom|potential|seems? to|unclear whether)\b/i;

function isSpeculativeDefect(value = "") {
  return SPECULATIVE_DEFECT_PATTERN.test(String(value || ""));
}

export function normaliseArtworkVisualQa(raw, {
  threshold = DEFAULT_THRESHOLD,
  minRelevance = DEFAULT_MIN_RELEVANCE,
  minTextSafety = DEFAULT_MIN_TEXT_SAFETY,
} = {}) {
  const parsed = typeof raw === "string" ? extractJsonObject(raw) : raw;
  const reportedDefects = stringArray(parsed?.defects);
  const reportedHardDefects = stringArray(parsed?.hardDefects);
  const speculativeHardDefects = reportedHardDefects.filter(isSpeculativeDefect);
  const hardDefects = reportedHardDefects.filter((item) => !isSpeculativeDefect(item));
  const defects = [...new Set([...reportedDefects, ...speculativeHardDefects])].slice(0, 12);
  const score = numberScore(parsed?.score);
  const relevance = numberScore(parsed?.relevance);
  const textSafety = numberScore(parsed?.textSafety);
  const composition = numberScore(parsed?.composition);
  const brandFit = numberScore(parsed?.brandFit);
  const hardFailure = hardDefects.length > 0;
  const pass = !hardFailure && score >= threshold && relevance >= minRelevance && textSafety >= minTextSafety;

  return {
    pass,
    score,
    threshold,
    minRelevance,
    minTextSafety,
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
      "The image must visibly represent artificial intelligence or the article's AI-enabled consequence through one concrete editorial scene rather than generic decoration.",
      "A stock office, decorative data centre, abstract network or unrelated technology scene is a hard failure when it does not express the article's actual angle.",
      "Any readable or pseudo-readable typography, logo or watermark is a hard failure.",
    ],
    newsletter: [
      "The image must look like serious photorealistic AI/technology editorial journalism and visibly represent the lead story, not anime, fantasy illustration, travel, tourism, lifestyle, a generic banner, magazine-cover mock-up or scenic wallpaper.",
      "Any readable or pseudo-readable typography is a hard failure.",
    ],
    social: [
      "The image must communicate the supplied post and lane at phone-thumbnail size through one concrete focal idea that is credibly compatible with the post's AI-enabled action, consequence or decision.",
      "Do not require a literal AI symbol, neural-network diagram, dashboard or readable software interface to prove that the subject is AI. Credible compute, robotics, research, security, governance or human-tool context can carry the story without labels.",
      "Treat unmistakably unrelated subject matter, anime/fantasy drift, a fabricated identifiable likeness of a named person, prominent readable text, or a dominant labelled dashboard/infographic layout as hard failures.",
      "A broadly relevant workstation, compute or operational scene that lacks specificity is a relevance/composition defect, not a hard failure by itself. A small unreadable or naturally defocused screen graphic is also a soft defect unless it dominates the composition or contains readable text.",
      "Do not require or reward a fabricated likeness of a named person when the brief contains no verified reference image. A source-specific scene, rear-view human, silhouette or other deliberately non-identifiable treatment can satisfy a named-person story. Only flag identity as a hard defect when the pixels falsely present an identifiable person as the named individual or identity itself is an explicit verified-reference requirement.",
    ],
    "social-blog": [
      "The image must visibly match the selected source story and its stated AI-enabled consequence or decision, not merely the broad topic of AI or an unrelated real-world scene.",
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
    "Scores are 0-100. Put only directly observable publication-blocking defects in hardDefects. Speculation such as possible, borderline, cannot confirm or if visible at another zoom belongs in defects, not hardDefects. Be strict about actual readable text, anime/illustration drift and off-topic imagery: attractive but off-topic artwork does not pass.",
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
      // Claude/OpenRouter vision routes have repeatedly rejected the stricter
      // optional parameter bundle before succeeding with the portable payload.
      // JSON is still enforced by the prompt plus deterministic parser; strict
      // response_format remains opt-in for providers known to support it.
      reasoning: null,
      response_format: envFlag("ARTWORK_VISUAL_QA_STRICT_RESPONSE_FORMAT", false)
        ? strictJsonResponseFormat("artwork_visual_qa", ARTWORK_QA_SCHEMA)
        : undefined,
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
      return normaliseArtworkVisualQa(raw, artworkVisualQaThresholds(mode));
    } catch (error) {
      lastError = error;
      if (attempt >= parseAttempts) throw error;
    }
  }

  throw lastError || new Error("Artwork visual QA returned no valid result");
}

export default { auditArtworkBase64, buildArtworkVisualQaPrompt, normaliseArtworkVisualQa };
