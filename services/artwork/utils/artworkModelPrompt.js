// Model-aware artwork prompt shaping.
// Each image family receives the prompt structure its own documentation favours.

const MODE_SPECS = {
  podcast: {
    format: "square 1:1 podcast episode artwork",
    composition: "one dominant episode-specific subject occupying roughly two thirds of the frame, with one supporting element at most",
    style: "premium cinematic technology editorial, adult, sceptical, grounded, high contrast, deep navy and cyan with a restrained warm accent",
    textRule: "Render only the visual scene. Every surface is clean and unmarked; there is no typography, lettering, numbering, logo, interface copy or watermark.",
  },
  blog: {
    format: "wide 16:9 website article hero",
    composition: "one article-specific focal scene with useful negative space and strong left-to-right depth",
    style: "premium magazine-feature realism, cinematic but restrained, high contrast and editorial rather than promotional",
    textRule: "Render only the visual scene. Every surface is clean and unmarked; there is no typography, lettering, numbering, logo, interface copy or watermark.",
  },
  newsletter: {
    format: "wide 16:9 AI-news newsletter hero",
    composition: "one concrete lead-story scene with a decisive focal subject and no banner, cover or template layout",
    style: "serious technology journalism, contemporary editorial realism, controlled colour, high contrast and believable physical detail",
    textRule: "Render only the visual scene. Every surface is clean and unmarked; there is no typography, lettering, numbering, logo, interface copy or watermark.",
  },
  "social-blog": {
    format: "wide 16:9 social-distributed article image",
    composition: "one source-specific consequence, decision or technical action that reads immediately at phone-feed size",
    style: "cinematic editorial realism, bold controlled colour, high contrast and visible human or physical stakes",
    textRule: "Render only the visual scene. Every surface is clean and unmarked; there is no typography, lettering, numbering, logo, interface copy or watermark.",
  },
  social: {
    format: "square 1:1 social-media editorial image",
    composition: "one uninterrupted photographic scene with one unmistakable focal idea, readable at thumbnail size, and no split-panel, poster, card or infographic layout",
    style: "intelligent modern editorial realism, cinematic lighting, bold controlled colour and natural human or physical context",
    surfaceRule: "Use text-resistant staging: keep screens dark, blank, turned away or naturally defocused; avoid visible documents, signs, whiteboards, charts, dashboards, \
floating panels and labelled diagrams. Communicate the idea through physical action, objects, posture, environment and consequence.",
    textRule: "Render only the visual scene. Every surface is clean and unmarked; there is no typography, lettering, numbering, logo, interface copy or watermark.",
  },
  quiz: {
    format: "square 1:1 interactive quiz card",
    composition: "clear phone-first hierarchy with the question and exactly four answer choices in distinct balanced panels",
    style: "polished editorial information design, high contrast, generous spacing and highly legible type",
    textRule: "Render the supplied wording exactly. Do not invent, paraphrase, repeat or omit any visible text.",
  },
};

function compact(value = "", max = 3000) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

export function getArtworkModelFamily(model = "") {
  const id = String(model || "").toLowerCase();
  if (id.includes("seedream")) return "seedream";
  if (id.includes("recraft")) return "recraft";
  if (id.includes("flux")) return "flux";
  return "generic";
}

function removeNegativePromptSentences(value = "") {
  return String(value || "")
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/^\s*(?:avoid|do not|don't|never|no\b|without\b|exclude\b|final compliance check)/i.test(sentence))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function specFor(mode) {
  return MODE_SPECS[mode] || MODE_SPECS.podcast;
}

export function buildModelAwareArtworkPrompt({ model, mode = "podcast", creativeDirection = "" } = {}) {
  const family = getArtworkModelFamily(model);
  const spec = specFor(mode);
  const direction = compact(creativeDirection, family === "seedream" ? 2600 : 2200);

  if (family === "flux") {
    const positiveDirection = compact(removeNegativePromptSentences(direction), 1800);
    return [
      `Subject: ${positiveDirection || "a concrete, source-specific artificial-intelligence editorial scene"}`,
      `Action: show the central real-world consequence or decision as a visible physical moment rather than decorative symbolism.`,
      spec.surfaceRule ? `Scene discipline: ${spec.surfaceRule}` : "",
      `Style: ${spec.style}.`,
      `Context: ${spec.format}; ${spec.composition}.`,
      `Output discipline: ${spec.textRule}`,
    ].filter(Boolean).join("\n");
  }

  if (family === "recraft") {
    return [
      `CORE CONCEPT: ${direction || "a concrete, source-specific artificial-intelligence editorial scene"}`,
      `BACKGROUND AND ENVIRONMENT: use only the real environment supported by the subject; keep it quiet enough for a clear silhouette.`,
      `PRIMARY FRAMING: ${spec.composition}.`,
      `PHYSICAL DETAIL: believable materials, objects and relationships; avoid generic symbolic filler.`,
      `LIGHTING: purposeful cinematic key light with controlled falloff and readable depth.`,
      `CAMERA AND FORMAT: ${spec.format}; editorial framing with strong hierarchy.`,
      `MOOD AND STYLE: ${spec.style}.`,
      `OUTPUT: ${spec.textRule}`,
    ].join("\n");
  }

  if (family === "seedream") {
    return [
      `FORMAT: ${spec.format}.`,
      spec.surfaceRule ? `SURFACE AND LAYOUT DISCIPLINE: ${spec.surfaceRule}` : "",
      `MAIN SUBJECT: ${direction || "a concrete, source-specific artificial-intelligence editorial scene"}`,
      `SPATIAL COMPOSITION: ${spec.composition}.`,
      `SUBJECT DETAIL: preserve realistic object identity, materials, proportions and physical relationships.`,
      `LIGHTING AND COLOUR: ${spec.style}; coherent light direction and controlled colour continuity across the whole frame.`,
      `STORY PRIORITY: communicate one clear editorial idea, not a collage of unrelated technology motifs.`,
      `OUTPUT CONSTRAINT: ${spec.textRule}`,
    ].filter(Boolean).join("\n");
  }

  return [
    `${spec.format}.`,
    direction,
    spec.composition,
    spec.style,
    spec.textRule,
  ].filter(Boolean).join("\n");
}

export function getDefaultArtworkAspectRatio(mode = "podcast") {
  return ["blog", "newsletter", "social-blog"].includes(mode) ? "16:9" : "1:1";
}

export default { buildModelAwareArtworkPrompt, getArtworkModelFamily, getDefaultArtworkAspectRatio };
