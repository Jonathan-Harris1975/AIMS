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

// Grouped anti-hype abstraction list from the on-brand audit (OB-002 / OB-010 /
// BSC-OB-003). These are generic newsroom/PR abstractions that read as filler
// unless immediately anchored to a concrete effect ("what specifically
// changes: who/what/impact"). Kept separate from BANNED_PROMO_PATTERNS so
// callers can report a distinct "generic abstraction" defect type and surface
// the audit's exact remediation copy.
export const GENERIC_ABSTRACTION_TERMS = Object.freeze([
  "landscape",
  "revolution",
  "paradigm",
  "game-changer",
  "game changer",
  "transform",
  "unprecedented",
]);

export const GENERIC_ABSTRACTION_PATTERNS = Object.freeze(
  GENERIC_ABSTRACTION_TERMS.map((term) => new RegExp(`\\b${term.replace(/[-\s]+/g, "[-\\s]?")}\\b`, "i"))
);

// "reality" used as empty shorthand ("AI's messy reality") rather than a
// concrete noun phrase. Matched narrowly to avoid flagging legitimate uses
// such as "the reality of deploying this in production".
export const GENERIC_REALITY_SHORTHAND_PATTERN = /\b(?:messy|quiet|real)\s+reality\b|\breality\s+(?:check)?\s*$/i;

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
  ["artifact", "artefact"],
  ["artifacts", "artefacts"],
  ["catalog", "catalogue"],
  ["catalogs", "catalogues"],
  ["cataloged", "catalogued"],
  ["cataloging", "cataloguing"],
  ["defense", "defence"],
  ["gray", "grey"],
  ["fueled", "fuelled"],
  ["fueling", "fuelling"],
  ["skillful", "skilful"],
  ["toward", "towards"],
  ["checkmark", "tick"],
  ["airplane", "aeroplane"],
  ["dialog", "dialogue"],
  ["dialogs", "dialogues"],
  ["analog", "analogue"],
  ["authorize", "authorise"],
  ["authorized", "authorised"],
  ["authorizing", "authorising"],
  ["authorization", "authorisation"],
  ["summarize", "summarise"],
  ["summarized", "summarised"],
  ["summarizing", "summarising"],
  ["customize", "customise"],
  ["customized", "customised"],
  ["customizing", "customising"],
  ["minimize", "minimise"],
  ["minimized", "minimised"],
  ["minimizing", "minimising"],
  ["maximize", "maximise"],
  ["maximized", "maximised"],
  ["maximizing", "maximising"],
  ["specialize", "specialise"],
  ["specialized", "specialised"],
  ["specializing", "specialising"],
]);



export const GENERIC_HASHTAGS = Object.freeze([
  "#ai",
  "#artificialintelligence",
  "#technology",
  "#tech",
  "#innovation",
  "#future",
  "#news",
]);

export const SOCIAL_BLOG_BANNED_PHRASES = Object.freeze([
  "in a significant development",
  "game changer",
  "game-changing",
  "paradigm shift",
  "rapidly evolving",
  "transformative",
  "revolutionary",
  "groundbreaking",
  "cutting-edge",
  "ai is transforming everything",
  "unlock value",
  "unlocking value",
  "seamless integration",
  "robust ecosystem",
  "robust data fabric",
  "this is huge",
  "you need to know",
  "don't miss",
  "don’t miss",
  "must read",
  "it remains to be seen",
  "only time will tell",
  "worth watching",
  "beneath the hype",
  "the real story",
  "as ai continues",
  "as artificial intelligence continues",
  "artificial intelligence landscape",
  "ai landscape",
]);

export const RSS_BANNED_SUMMARY_PHRASES = Object.freeze([
  "in a significant development",
  "in a move that",
  "as we move forward",
  "the implications are significant",
  "in today's rapidly evolving landscape",
  "this highlights the importance of",
  "this underscores",
  "this showcases",
  "robust data fabric",
  "seamless data integration",
  "meaningful business value",
  "competitive advantage",
  "holistic approach",
  "it remains to be seen",
  "only time will tell",
  "worth watching",
  "the future of",
  "this could pave the way",
  "it will be interesting to see",
  "one might wonder",
  "in a world where",
  "rapidly evolving",
  "transformative",
  "groundbreaking",
  "revolutionary",
  "cutting-edge",
  "game-changer",
  "paradigm shift",
  "unprecedented",
  "delve into",
  "landscape",
  "realm",
  "notably",
  "underscores",
  "showcases",
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

export const ANTI_HYPE_HEDGING_PHRASES = Object.freeze([
  "it remains to be seen",
  "only time will tell",
  "worth watching",
  "watch this space",
]);

export const MOTIVATIONAL_HASHTAGS = Object.freeze([
  "#mondaymotivation",
  "#aiinspiration",
  "#techleadership",
  "#buildinpublic",
  "#motivation",
  "#inspiration",
]);

export const MOTIVATIONAL_TONE_PATTERNS = Object.freeze([
  /\banother week, another\b/i,
  /\bsmall win(?:s)?\b/i,
  /\bkeep pushing\b/i,
  /\bbuilding in public\b/i,
  /\bturn dreams into\b/i,
]);

export function cleanLexiconText(value = "") {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script\b[^>]*>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style\b[^>]*>/gi, " ")
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
    .filter((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(source);
    })
    .map((pattern) => pattern.source.replace(/\\b|\\s\+|\\s\?|\(\?:|\)/g, " ").replace(/\\/g, "").trim());
}


// Returns matched generic-abstraction terms (deduplicated), or [] if clean.
// Mirrors findPatternBreaches but reports the plain matched term so calling
// validators/gates can render the audit's fix instruction:
// "what specifically changes: e.g. inventory ranking, supply chain opacity, compute cost"
export function findGenericAbstractionBreaches(text = "") {
  const source = cleanLexiconText(text);
  const found = new Set();
  GENERIC_ABSTRACTION_PATTERNS.forEach((pattern, index) => {
    pattern.lastIndex = 0;
    if (pattern.test(source)) found.add(GENERIC_ABSTRACTION_TERMS[index]);
  });
  if (GENERIC_REALITY_SHORTHAND_PATTERN.test(source)) found.add("reality (empty shorthand)");
  return [...found];
}

export function findAmericanSpellings(text = "") {
  const source = cleanLexiconText(text);
  return AMERICAN_TO_BRITISH
    .filter(([american]) => new RegExp(`\\b${american}\\b`, "i").test(source))
    .map(([american, british]) => ({ american, british }));
}
