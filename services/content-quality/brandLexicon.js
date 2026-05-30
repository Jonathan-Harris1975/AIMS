export const BANNED_PROMO_PATTERNS = Object.freeze([
  /\bbuy\s+now\b/i,
  /\blimited\s+time\b/i,
  /\bdon'?t\s+miss\s+out\b/i,
  /\bguaranteed\b/i,
  /\bmake\s+money\s+fast\b/i,
  /\bget\s+rich\b/i,
  /\bsecret\s+formula\b/i,
  /\bunlock\s+the\s+future\b/i,
  /\brevolutionary\b/i,
  /\bgame[-\s]?changing\b/i,
  /\bgroundbreaking\b/i,
  /\bcutting[-\s]?edge\b/i,
  /\btransformative\b/i,
  /\bparadigm\s+shift\b/i,
  /\bdelve\b/i,
  /\bgame\s+changer\b/i,
]);

export const AMERICAN_TO_BRITISH = Object.freeze([
  ["analyze", "analyse"],
  ["analyzed", "analysed"],
  ["analyzing", "analysing"],
  ["behavior", "behaviour"],
  ["behaviors", "behaviours"],
  ["color", "colour"],
  ["colors", "colours"],
  ["colored", "coloured"],
  ["center", "centre"],
  ["centered", "centred"],
  ["centering", "centring"],
  ["favorite", "favourite"],
  ["favorites", "favourites"],
  ["honor", "honour"],
  ["honors", "honours"],
  ["labor", "labour"],
  ["license", "licence"],
  ["modeled", "modelled"],
  ["modeling", "modelling"],
  ["optimize", "optimise"],
  ["optimized", "optimised"],
  ["optimizing", "optimising"],
  ["optimization", "optimisation"],
  ["organize", "organise"],
  ["organized", "organised"],
  ["organizing", "organising"],
  ["organization", "organisation"],
  ["organizations", "organisations"],
  ["personalization", "personalisation"],
  ["personalize", "personalise"],
  ["personalized", "personalised"],
  ["prioritize", "prioritise"],
  ["prioritized", "prioritised"],
  ["prioritizing", "prioritising"],
  ["program", "programme"],
  ["programs", "programmes"],
  ["traveling", "travelling"],
  ["traveled", "travelled"],
]);

export const ENGAGEMENT_BAIT_PATTERNS = Object.freeze([
  /\bplease\s+share\b/i,
  /\bsmash\s+the\s+like\b/i,
  /\bfollow\s+for\s+more\b/i,
  /\btag\s+a\s+friend\b/i,
  /\bshare\s+this\s+with\b/i,
  /\bcomment\s+yes\b/i,
]);

export const INFLATED_EBOOK_CLAIM_PATTERNS = Object.freeze([
  /\bmaster\b/i,
  /\bmastery\b/i,
  /\btransform\b/i,
  /\btransforms\b/i,
  /\bcomplete\s+guide\b/i,
  /\beverything\s+you\s+need\b/i,
  /\bdefinitive\s+guide\b/i,
  /\bultimate\s+guide\b/i,
]);

export function cleanLexiconText(value = "") {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|quot|apos|lt|gt);/gi, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function findPatternBreaches(text = "", patterns = []) {
  const source = cleanLexiconText(text);
  return patterns
    .filter((pattern) => pattern.test(source))
    .map((pattern) => pattern.source.replace(/\\b|\\s\+|\\s\?|\(\?:|\)/g, " ").replace(/\\/g, "").trim());
}

export function findAmericanSpellings(text = "") {
  const source = cleanLexiconText(text);
  return AMERICAN_TO_BRITISH
    .filter(([american]) => new RegExp(`\\b${american}\\b`, "i").test(source))
    .map(([american, british]) => ({ american, british }));
}
