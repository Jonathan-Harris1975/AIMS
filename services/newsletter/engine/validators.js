import { canonicalStoryUrl, canonicalStoryTitle } from './editorialHistory.js';
// services/newsletter/engine/validators.js
// Deterministic QA for AI Edge v2. Mechanical failures are caught before the
// multi-model council spends tokens on a draft that cannot be published.

const BANNED_PHRASES = [
  "game-changing", "game changing", "revolutionary", "groundbreaking", "cutting-edge", "cutting edge",
  "in today's fast-paced world", "delve into", "unlock the power of", "paradigm shift", "seamless integration",
  "unlock value", "smash the like", "follow for more",
];

const AMERICANISM_PAIRS = [
  ["analyze", "analyse"], ["color", "colour"], ["behavior", "behaviour"], ["organization", "organisation"],
  ["favorite", "favourite"], ["center", "centre"], ["optimize", "optimise"], ["prioritize", "prioritise"],
];

function editorialText(newsletter) {
  return [
    newsletter.subject,
    newsletter.previewText,
    newsletter.heroHeadline,
    newsletter.openingNoteHtml,
    ...(newsletter.bigThree || []).flatMap((s) => [s.whatHappened, s.whyItMatters, s.jonathanTake]),
    newsletter.worthUsing?.summary,
    newsletter.worthUsing?.whyUseful,
    ...(newsletter.onRadar || []).map((s) => s.summary),
    newsletter.realityCheck?.claim,
    newsletter.realityCheck?.assessment,
  ].filter(Boolean).join("\n");
}

function sourceLinks(newsletter) {
  return [
    ...(newsletter.bigThree || []).map((s) => s.link),
    newsletter.worthUsing?.link,
    ...(newsletter.onRadar || []).map((s) => s.link),
    newsletter.realityCheck?.link,
  ].filter(Boolean);
}

export function validateBannedPhrases(newsletter) {
  const haystack = editorialText(newsletter).toLowerCase();
  const hits = BANNED_PHRASES.filter((phrase) => haystack.includes(phrase));
  return { pass: hits.length === 0, issues: hits.map((phrase) => ({ code: "banned_phrase", message: `Contains banned phrase: "${phrase}"` })) };
}

export function validateDailyOpening(newsletter) {
  if (["saturday", "sunday"].includes(newsletter.edition)) return { pass: true, issues: [] };
  const opening = String(newsletter.openingNoteHtml || "").replace(/<[^>]*>/g, " ")
    .replace(/&(?:rsquo|apos|#39|#x27);/gi, "'");
  const weeklyFrame = new RegExp([
    "\\b(?:this|the) week['’]s (?:theme|edition|briefing|round-?up|newsletter|issue)\\b",
    "\\b(?:this|our) weekly (?:theme|edition|briefing|round-?up|newsletter|issue)\\b",
    "\\bthis week(?:,| we (?:look|cover|explore|examine|discuss))|\\bwelcome to (?:the |our )?week",
  ].join("|"), "iu");
  const issues = weeklyFrame.test(opening)
    ? [{ code: "weekly_opening", message: "Daily opening uses weekly edition framing. Introduce today's selected topics instead." }] : [];
  return { pass: issues.length === 0, issues };
}

export function validateBritishSpelling(newsletter) {
  const haystack = editorialText(newsletter).toLowerCase();
  const hits = AMERICANISM_PAIRS.filter(([american]) => haystack.includes(american)).map(([american, british]) => ({
    code: "americanism", message: `Found American spelling "${american}" — use "${british}"`,
  }));
  return { pass: hits.length === 0, issues: hits };
}

export function validateSubjectLength(newsletter) {
  const issues = [];
  if (!newsletter.subject) issues.push({ code: "missing_subject", message: "Subject line is missing." });
  else if (newsletter.subject.length > 78) issues.push({ code: "subject_too_long", message: `Subject line is ${newsletter.subject.length} chars (limit 78).` });
  return { pass: issues.length === 0, issues };
}

export function validateStructuralCompleteness(newsletter, { expectedStoryCount, requireHeroImage = true } = {}) {
  const issues = [];
  if (!newsletter.heroHeadline) issues.push({ code: "missing_hero_headline", message: "Hero headline is missing." });
  if (!newsletter.openingNoteHtml) issues.push({ code: "missing_opening_note", message: "Opening note is missing." });
  if (requireHeroImage && !newsletter.heroImageUrl) issues.push({ code: "missing_hero_image", message: "Hero image URL is missing." });
  if (!Array.isArray(newsletter.bigThree) || newsletter.bigThree.length !== 3) issues.push({ code: "big_three_incomplete", message: "The Big Three must contain exactly three stories." });
  if (!newsletter.realityCheck?.assessment) issues.push({ code: "missing_reality_check", message: "Reality Check is missing." });
  const uniqueLinks = new Set(sourceLinks(newsletter));
  if (expectedStoryCount && uniqueLinks.size < expectedStoryCount) issues.push({ code: "story_count_short", message:
     `Only ${uniqueLinks.size} of ${expectedStoryCount} expected source stories are represented.` });
  return { pass: issues.length === 0, issues };
}

export function validateNoDuplicateStories(newsletter) {
  const links = sourceLinks(newsletter);
  const seen = new Set();
  const dupes = new Set();
  for (const link of links) {
    const key = String(link).toLowerCase().replace(/[?#].*$/, "");
    if (seen.has(key)) dupes.add(key);
    seen.add(key);
  }
  // Reality Check deliberately points back to a Big Three source, so allow
  // that one deliberate repeat by comparing the unique editorial slots only.
  if (newsletter.realityCheck?.link) dupes.delete(String(newsletter.realityCheck.link).toLowerCase().replace(/[?#].*$/, ""));
  return { pass: dupes.size === 0, issues: [...dupes].map((link) => ({ code: "duplicate_story", message: `Story link appears in multiple editorial slots: ${link}` })) };
}

export function validateLinks(newsletter) {
  const issues = [];
  const links = [...sourceLinks(newsletter), newsletter.promotion?.url].filter(Boolean);
  for (const link of links) {
    try {
      const parsed = new URL(link);
      if (!["http:", "https:"].includes(parsed.protocol)) issues.push({ code: "unsafe_link_protocol", message: `Unsupported link protocol: ${link}` });
    } catch { issues.push({ code: "malformed_link", message: `Invalid URL: ${link}` }); }
  }
  return { pass: issues.length === 0, issues };
}

export function validatePromotion(newsletter) {
  const promotion = newsletter.promotion;
  if (!promotion) return { pass: true, issues: [] };
  const issues = [];
  if (!promotion.title) issues.push({ code: "promotion_missing_title", message: "Promotion title is missing." });
  if (!promotion.url) issues.push({ code: "promotion_missing_url", message: "Promotion URL is missing." });
  if (!["book", "podcast"].includes(promotion.type)) issues.push({ code: "promotion_type_invalid", message: `Unsupported promotion type: ${promotion.type}` });
  return { pass: issues.length === 0, issues };
}


export function validateRecentCoverage(newsletter, { recentHistory = null } = {}) {
  if (!recentHistory) return { pass: true, issues: [] };
  const links = recentHistory.recentLinks || new Set();
  const titles = recentHistory.recentTitles || new Set();
  const stories = [...(newsletter.bigThree || []), newsletter.worthUsing, ...(newsletter.onRadar || [])].filter(Boolean);
  const issues = stories.filter((story) => links.has(canonicalStoryUrl(story.link))
    || (story.title && titles.has(canonicalStoryTitle(story.title))))
    .map((story) => ({ code: 'recently_published_story', message: 'Already dispatched in the last seven days: ' + story.title }));
  return { pass: issues.length === 0, issues };
}

export function validatePracticalValue(newsletter) {
  if (newsletter.edition !== 'daily') return { pass: true, issues: [] };
  const tip = String(newsletter.worthUsing?.whyUseful || '');
  const useful = tip.length >= 50 && /\b(check|compare|try|test|ask|use|measure|review|verify|look|read|run|track|start|consider|inspect|request|require)\b/i.test(tip);
  return { pass: useful, issues: useful ? [] :
    [{ code: 'missing_actionable_takeaway', message: 'Worth Using needs a concrete, source-grounded reader action (50+ characters), not a generic claim.' }] };
}

export function validatePromotionalResidue(newsletter) {
  const text = [newsletter.worthUsing?.summary, ...(newsletter.onRadar || []).map((story) => story.summary)].filter(Boolean).join('\n');
  const leaked = /\b(the post .{5,140} appeared first on|read more at|click here to read more|book a demo today|subscribe to our blog)\b/i.test(text);
  return { pass: !leaked, issues: leaked ? [{ code: 'promotional_rss_residue', message: 'Unedited RSS/marketing boilerplate leaked into reader-facing copy.' }] : [] };
}

const NUMBER_WORDS = { one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
function quantitativeClaims(value) {
  const normalised = String(value || '').toLowerCase()
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+(million|billion|thousand|trillion)\b/gi,
      (_, word, unit) => NUMBER_WORDS[word.toLowerCase()] + ' ' + unit.toLowerCase());
  const pattern = /\b(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s*(?:thousand|million|billion|trillion|percent|per cent)|\d+(?:\.\d+)?%)\b/gi;
  return [...normalised.matchAll(pattern)].map((m) => m[0].replace(/[\s,]/g, ''));
}

export function validateQuantitativeEvidence(newsletter, { sources = [] } = {}) {
  const sourceMap = new Map(sources.map((source, i) => ['S' + i, source]));
  const claims = [
    ...(newsletter.bigThree || []).map((s) => ({ sourceId: s.sourceId, text: s.whatHappened })),
    { sourceId: newsletter.realityCheck?.sourceId, text: newsletter.realityCheck?.claim },
    { sourceId: newsletter.worthUsing?.sourceId, text: newsletter.worthUsing?.summary },
  ];
  const issues = [];
  for (const claim of claims) {
    const source = sourceMap.get(claim.sourceId);
    if (!source?.evidenceVerified || !source.evidence) continue;
    const supported = new Set(quantitativeClaims(source.title + '\n' + source.evidence));
    for (const number of quantitativeClaims(claim.text)) {
      if (!supported.has(number)) {
        issues.push({ code: 'quantitative_claim_unverified', message:
          'Quantitative claim ' + number + ' is not supported by retrieved original article for ' + source.title });
      }
    }
  }
  return { pass: issues.length === 0, issues };
}

const ALL_VALIDATORS = [validateDailyOpening, validateBannedPhrases, validateBritishSpelling,
  validateSubjectLength, validateStructuralCompleteness, validateNoDuplicateStories,
  validateLinks, validatePromotion, validateRecentCoverage, validatePracticalValue,
  validatePromotionalResidue, validateQuantitativeEvidence];

export function runDeterministicValidators(newsletter, {
  expectedStoryCount, requireHeroImage = true, recentHistory = null, sources = [],
} = {}) {
  const issues = [];
  for (const validator of ALL_VALIDATORS) {
    issues.push(...validator(newsletter, { expectedStoryCount, requireHeroImage, recentHistory, sources }).issues);
  }
  return { pass: issues.length === 0, issues };
}

export default { validateBannedPhrases, validateBritishSpelling, validateSubjectLength, validateStructuralCompleteness, validateNoDuplicateStories, validateLinks,
   validatePromotion, runDeterministicValidators };
