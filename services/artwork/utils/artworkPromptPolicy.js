// Shared artwork prompt policy for blog, social-blog and podcast images.

const SEASONAL_PALETTES = Object.freeze({
  winter: "Keep the brand's deep navy and charcoal base, with restrained icy cyan, silver-grey and muted violet accents.",
  spring: "Keep the brand's deep navy and charcoal base, with restrained fresh teal, muted sage and pale lilac accents.",
  summer: "Keep the brand's deep navy and charcoal base, with restrained electric teal, sunlit amber and muted coral accents.",
  autumn: "Keep the brand's deep navy and charcoal base, with restrained copper, burnt amber and muted plum accents.",
});

export const QUIZ_TEXT_RULE = [
  "QUIZ CARD TEXT REQUIREMENT.",
  "Visible text is required for quiz artwork.",
  "Render only the exact supplied quiz wording and answer labels. Do not invent, paraphrase, shorten, translate, localise, spell-correct, or add extra copy.",
  "Prioritise mobile readability: large type, generous spacing, short lines, strong hierarchy and high contrast.",
  "Do not add logos, watermarks, pseudo-text, decorative labels, fake UI copy or unrelated words.",
].join(" ");

export const STRICT_TEXT_FREE_RULE = [
  "ABSOLUTE TEXT-FREE OUTPUT.",
  "No text. No letters. No numbers. No logos. No watermarks.",
  "Do not include text of any kind. Do not render readable text, pseudo-text, gibberish text, letters, words, numerals, punctuation, glyphs, captions, headlines, labels, code, interface copy, signage, logos, trademarks, watermarks, badges, seals or typography-shaped marks anywhere in the image.",
  "Do not turn the supplied title, theme, quotation, script or metadata into visible writing.",
  "Represent every concept through composition, objects, light, texture, geometry and atmosphere only.",
  "If any earlier instruction implies visible wording, ignore that part and keep the image completely text-free.",
].join(" ");

function dateFromIsoWeek(value) {
  const match = String(value || "").match(/(\d{4})-W(\d{1,2})/i);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(week) || week < 1 || week > 53) return null;

  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  const result = new Date(mondayWeek1);
  result.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7);
  return result;
}

export function resolveArtworkDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  const source = String(value || "").trim();
  const dateMatch = source.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (dateMatch) {
    const parsed = new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T12:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const weekDate = dateFromIsoWeek(source);
  if (weekDate) return weekDate;

  return new Date();
}

export function getArtworkSeason(value) {
  const month = resolveArtworkDate(value).getUTCMonth() + 1;
  if (month === 12 || month <= 2) return "winter";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "autumn";
}

export function getSeasonalPaletteDirection(value) {
  const season = getArtworkSeason(value);
  return `Seasonal palette adjustment (${season}, Northern Hemisphere): ${SEASONAL_PALETTES[season]}`;
}

export function applyArtworkPromptPolicy(prompt = "", { date, mode = "editorial" } = {}) {
  const cleanPrompt = String(prompt || "").replace(/\s+/g, " ").trim();
  const topicalPodcastRule = mode === "podcast"
    ? [
        "TOPICAL EDITORIAL REQUIREMENT: the image must visibly communicate one or two concrete subjects from this specific episode, not merely the idea of AI.",
        "Choose recognisable real-world visual storytelling such as semiconductor hardware, data-centre power infrastructure, security work, healthcare technology, scientific research, robotics, developers or other episode-specific objects and environments when supported by the prompt.",
        "Create a strong magazine-cover focal scene with depth, tension and human or physical context where appropriate.",
        "Do not default to a symmetrical abstract emblem, digital snowflake, neural-network flower, generic circuit mandala, floating polygon, glowing brain, anonymous data web or decorative geometry.",
        "Abstract geometry may only be a minor supporting texture, never the main subject.",
      ].join(" ")
    : "";
  const newsletterRule = mode === "newsletter"
    ? [
        "NEWSLETTER EDITORIAL REQUIREMENT: create a specific visual response to the lead AI story, not a generic masthead, banner, scenic backdrop or lifestyle photograph.",
        "The subject must visibly belong to AI, software, robotics, security, governance, infrastructure or the lead story's real-world domain.",
        "Prefer a concrete technical object, consequential workplace moment or human-scale news scene with clear editorial tension.",
        "Never use beaches, oceans, coastlines, mountains, roads, paths, horizons, sunsets, tourism, resorts, anonymous lone travellers or inspirational journey imagery.",
        "Never imitate a magazine cover or website template. Do not create empty title panels, hero-copy space, buttons, interface chrome or decorative layout boxes.",
      ].join(" ")
    : "";

  const socialRule = mode === "social"
    ? [
        "SOCIAL EDITORIAL REQUIREMENT: make the image immediately engaging and clearly related to the supplied post topic.",
        "Prefer a concrete person, object, workplace, real-world environment or physical consequence over decorative abstract AI symbolism.",
        "For a named public figure or quote-author brief, make that person the clear editorial focal subject and use only subtle topic-relevant visual context around them.",
        "Avoid anonymous corporate people, handshake imagery, generic office teams, glowing brains, floating polygons, circuit mandalas, digital snowflakes, abstract neural flowers and stock-photo staging.",
        "Use cinematic lighting, emotional presence, bold but controlled colour, high contrast and modern magazine or YouTube-thumbnail composition.",
      ].join(" ")
    : "";

  const quizRule = mode === "quiz"
    ? [
        "QUIZ SOCIAL REQUIREMENT: design for interaction first.",
        "Question cards must make all four answer choices A, B, C and D immediately scannable on a phone.",
        "Give each answer choice its own distinct visual panel and a simple topic-relevant diagram or icon treatment where useful.",
        "Do not visually reveal the correct answer on the question card.",
        "Answer cards must clearly reveal the correct option, keep all four options visible for continuity, and strongly highlight only the correct option.",
        "On answer cards, use a subtle semi-transparent topic-relevant visual in the background behind the explanation area, never behind the main answer text.",
        "Use cinematic lighting, bold controlled colour, high contrast, polished magazine/YouTube-thumbnail composition and clean negative space.",
        "Avoid generic corporate styling, decorative abstract AI wallpaper, clutter and tiny text.",
      ].join(" ")
    : "";

  return [
    cleanPrompt,
    `Artwork mode: ${mode}.`,
    topicalPodcastRule,
    newsletterRule,
    socialRule,
    quizRule,
    getSeasonalPaletteDirection(date),
    mode === "quiz" ? QUIZ_TEXT_RULE : STRICT_TEXT_FREE_RULE,
  ].filter(Boolean).join(" ");
}

export default {
  QUIZ_TEXT_RULE,
  STRICT_TEXT_FREE_RULE,
  resolveArtworkDate,
  getArtworkSeason,
  getSeasonalPaletteDirection,
  applyArtworkPromptPolicy,
};
