// services/artwork/utils/artworkVisualQa.js
//
// Multimodal post-generation QA for editorial artwork. Prompt compliance is
// not proof that an image is usable: image models can still invent typography,
// drift into travel imagery or produce a decorative infographic unrelated to
// the article. This audit inspects the pixels before upload/publication.

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
  const modeRules = mode === "newsletter"
    ? [
        "The image must look like serious AI/technology editorial journalism, not travel, tourism, lifestyle, a generic banner or scenic wallpaper.",
        "Any readable or pseudo-readable typography is a hard failure.",
      ]
    : ["social", "social-blog"].includes(mode)
      ? [
          "The image must communicate the supplied post at phone-thumbnail size through one concrete visual idea.",
          "Generated labels, callout boxes, dashboards, pseudo-text, infographic panels and decorative UI are hard failures unless visible text was explicitly required, which it was not here.",
        ]
      : ["Judge whether the image is specific to the supplied editorial brief rather than generic decoration."];

  return [
    "Audit this generated editorial image. Judge the actual pixels, not the claimed prompt compliance.",
    "Ignore ordinary photographic texture. Look carefully for readable text, pseudo-text, gibberish labels, logos, watermarks, travel scenery, unrelated subjects and broken anatomy.",
    ...modeRules,
    `Mode: ${mode}.`,
    `Creative brief: ${compact(creativePrompt, 2600)}`,
    "Return JSON only with exactly these keys:",
    '{"score":0,"relevance":0,"textSafety":0,"composition":0,"brandFit":0,"defects":[],"hardDefects":[],"summary":""}',
    "Scores are 0-100. Put any text/pseudo-text, off-topic travel/lifestyle scene, unrelated infographic/UI, logo/watermark, severe anatomy defect or unusable composition in hardDefects.",
  ].join("\n");
}

export async function auditArtworkBase64({ base64, mode = "editorial", creativePrompt = "", sessionId = "artwork-qa" } = {}) {
  const image = String(base64 || "").trim();
  if (!image) throw new Error("Artwork visual QA requires a base64 image.");

  const { resilientRequest } = await import("../../shared/utils/ai-service.js");
  const raw = await resilientRequest("artworkVisualQa", {
    sessionId,
    max_tokens: 700,
    temperature: 0.1,
    reasoning: { effort: "minimal" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: buildArtworkVisualQaPrompt({ mode, creativePrompt }) },
          { type: "image_url", image_url: { url: `data:image/png;base64,${image}` } },
        ],
      },
    ],
  });

  return normaliseArtworkVisualQa(raw);
}

export default { auditArtworkBase64, buildArtworkVisualQaPrompt, normaliseArtworkVisualQa };
