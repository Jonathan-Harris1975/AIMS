// Shared artwork prompt policy for blog, social-blog and podcast images.

const SEASONAL_PALETTES = Object.freeze({
  winter: "Keep the brand's deep navy and charcoal base, with restrained icy cyan, silver-grey and muted violet accents.",
  spring: "Keep the brand's deep navy and charcoal base, with restrained fresh teal, muted sage and pale lilac accents.",
  summer: "Keep the brand's deep navy and charcoal base, with restrained electric teal, sunlit amber and muted coral accents.",
  autumn: "Keep the brand's deep navy and charcoal base, with restrained copper, burnt amber and muted plum accents.",
});

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
  return [
    cleanPrompt,
    `Artwork mode: ${mode}.`,
    topicalPodcastRule,
    getSeasonalPaletteDirection(date),
    STRICT_TEXT_FREE_RULE,
  ].filter(Boolean).join(" ");
}

export default {
  STRICT_TEXT_FREE_RULE,
  resolveArtworkDate,
  getArtworkSeason,
  getSeasonalPaletteDirection,
  applyArtworkPromptPolicy,
};
