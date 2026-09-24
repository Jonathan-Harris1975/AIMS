// Shared artwork prompt policy for blog, social-blog and podcast images.

const SEASONAL_PALETTES = Object.freeze({
  winter: "Keep the brand's deep navy and charcoal base, with restrained icy cyan, silver-grey and muted violet accents.",
  spring: "Keep the brand's deep navy and charcoal base, with restrained fresh teal, muted sage and pale lilac accents.",
  summer: "Keep the brand's deep navy and charcoal base, with restrained electric teal, sunlit amber and muted coral accents.",
  autumn: "Keep the brand's deep navy and charcoal base, with restrained copper, burnt amber and muted plum accents.",
});

const EVENT_PALETTES = Object.freeze({
  new_year: "Keep the active seasonal palette and add restrained champagne-gold, silver and midnight-blue celebratory highlights. Avoid fireworks text, year numerals and party clichés unless the brief explicitly requires them.",
  valentines: "Keep the active seasonal palette and add restrained berry, rose and warm blush highlights. Keep the treatment editorial rather than romantic-card styling.",
  easter: "Keep the active seasonal palette and add restrained soft yellow, fresh green and pale lavender highlights. Keep the treatment modern and editorial rather than novelty or confectionery-led.",
  halloween: "Keep the active seasonal palette and add restrained ember-orange, aubergine and smoky-violet highlights. Keep the treatment atmospheric rather than horror, gore or novelty styling.",
  christmas: "Keep the active seasonal palette and add restrained evergreen, warm gold and cranberry highlights. Keep the treatment elegant and editorial rather than novelty, cartoon or excessive festive styling.",
  safer_internet_day: "Keep the active seasonal palette and add restrained trustworthy cyan, cobalt and cool-violet highlights. Keep the treatment digital, calm and security-aware rather than alarmist.",
  international_womens_day: "Keep the active seasonal palette and add restrained violet, magenta and warm-white highlights. Keep the treatment contemporary and editorial, avoiding tokenistic iconography.",
  st_patricks_day: "Keep the active seasonal palette and add restrained emerald, moss and soft-gold highlights. Keep the treatment elegant rather than novelty shamrock styling.",
  mothering_sunday: "Keep the active seasonal palette and add restrained rose, soft lilac and warm cream highlights. Keep the treatment warm and editorial rather than greeting-card styling.",
  earth_day: "Keep the active seasonal palette and add restrained leaf-green, ocean-teal and earth-toned highlights. Keep the treatment environmental and modern rather than generic globe imagery.",
  pride_month: "Keep the active seasonal palette and allow restrained spectrum highlights as secondary accents only. Preserve brand hierarchy, readability and editorial restraint rather than using a full rainbow wash.",
  fathers_day: "Keep the active seasonal palette and add restrained cobalt, teal and warm-amber highlights. Keep the treatment warm and editorial rather than greeting-card styling.",
  bonfire_night: "Keep the active seasonal palette and add restrained ember-orange, warm gold and smoke-violet highlights. Keep the treatment atmospheric and abstract rather than depicting unsafe pyrotechnic handling.",
  remembrance: "Keep the active seasonal palette and add restrained poppy-red and warm-grey accents. Keep the treatment quiet, respectful and minimal rather than celebratory.",
});

function easterSundayUtc(year) {
  // Anonymous Gregorian algorithm, valid for Gregorian calendar years.
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function utcDayKey(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

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
  "Do not include text of any kind. Do not render readable text, pseudo-text, gibberish text, letters, words, numerals, punctuation, glyphs, captions, headlines, labels, code, \
interface copy, signage, logos, trademarks, watermarks, badges, seals or typography-shaped marks anywhere in the image.",
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

export function getArtworkEvent(value) {
  const date = resolveArtworkDate(value);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();

  // Event layer is intentionally short-lived and overrides only accent direction.
  if ((month === 12 && day === 31) || (month === 1 && day <= 2)) return "new_year";
  if (month === 2 && day === 14) return "valentines";
  if (month === 3 && day === 8) return "international_womens_day";
  if (month === 3 && day === 17) return "st_patricks_day";
  if (month === 4 && day === 22) return "earth_day";
  if (month === 10 && day === 31) return "halloween";
  if (month === 11 && day === 5) return "bonfire_night";
  if (month === 11 && day === 11) return "remembrance";
  if (month === 12 && day >= 20 && day <= 30) return "christmas";

  // Safer Internet Day: second Tuesday in February.
  if (month === 2 && date.getUTCDay() === 2 && day >= 8 && day <= 14) return "safer_internet_day";

  const easter = easterSundayUtc(year);
  const deltaDays = Math.round((utcDayKey(date) - utcDayKey(easter)) / 86400000);
  if (deltaDays === -21) return "mothering_sunday";
  if (deltaDays >= -2 && deltaDays <= 1) return "easter";

  // Father's Day: third Sunday in June. Specific day overrides the month-long Pride accent.
  if (month === 6 && date.getUTCDay() === 0 && day >= 15 && day <= 21) return "fathers_day";
  if (month === 6) return "pride_month";
  return null;
}

export function getSeasonalPaletteDirection(value) {
  const season = getArtworkSeason(value);
  const event = getArtworkEvent(value);
  const layers = [
    `Base brand: preserve the established deep navy/charcoal identity, composition standards and accessibility-safe contrast.`,
    `Seasonal palette adjustment (${season}, Northern Hemisphere): ${SEASONAL_PALETTES[season]}`,
  ];
  if (event) layers.push(`Optional event accent (${event.replace(/_/g, " ")}): ${EVENT_PALETTES[event]}`);
  return layers.join(" ");
}

export function applyArtworkPromptPolicy(prompt = "", { date, mode = "editorial" } = {}) {
  const cleanPrompt = String(prompt || "").replace(/\s+/g, " ").trim();
  const topicalPodcastRule = mode === "podcast"
    ? [
        "TOPICAL EDITORIAL REQUIREMENT: the image must visibly communicate one or two concrete subjects from this specific episode, not merely the idea of AI.",
        "Choose recognisable real-world visual storytelling such as semiconductor hardware, data-centre power infrastructure, security work, healthcare technology, scientific \
research, robotics, developers or other episode-specific objects and environments when supported by the prompt.",
        "Create a strong magazine-cover focal scene with depth, tension and human or physical context where appropriate.",
        "Do not default to a symmetrical abstract emblem, digital snowflake, neural-network flower, generic circuit mandala, floating polygon, glowing brain, anonymous data \
web or decorative geometry.",
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
        "SOCIAL EDITORIAL REQUIREMENT: make the image immediately engaging, visibly connected to artificial intelligence, and clearly related to the supplied post topic.",
        "Prefer a concrete person using an AI tool, AI-relevant technical object, compute or robotics environment, research/security/governance consequence, or another source-\
supported AI-enabled moment over decorative abstract symbolism.",
        "Treat a quote-author name as attribution context only unless the supplied brief explicitly requests a person spotlight; never infer a portrait from attribution alone.",
        "Do not fabricate the likeness of a named public figure from text alone. Unless verified reference imagery is supplied, represent a named-person story through their \
source-supported work, field, objects or environment; if a human is useful, keep them anonymous and non-identifiable through rear-view, silhouette or cropped editorial framing.",
        "Avoid anime, fantasy illustration, anonymous corporate people, handshake imagery, generic office teams, unrelated industrial hardware, glowing brains, floating \
polygons, circuit mandalas, digital snowflakes, abstract neural flowers and stock-photo staging.",
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
  getArtworkEvent,
  getSeasonalPaletteDirection,
  applyArtworkPromptPolicy,
};
