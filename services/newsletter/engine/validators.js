// services/newsletter/engine/validators.js
//
// Deterministic (non-AI) QA checks for one composed newsletter. Each
// validator returns { pass, issues: [{ code, message, field? }] } and never
// throws. These run before the AI editorial review pass in the QA loop so
// obvious, mechanical problems don't waste an AI call.

const BANNED_PHRASES = [
  "game-changing", "game changing", "revolutionary", "groundbreaking",
  "cutting-edge", "cutting edge", "in today's fast-paced world",
  "delve into", "unlock the power of", "paradigm shift", "seamless integration",
  "unlock value", "smash the like", "follow for more",
];

const AMERICANISM_PAIRS = [
  ["analyze", "analyse"], ["color", "colour"], ["behavior", "behaviour"],
  ["organization", "organisation"], ["favorite", "favourite"], ["center", "centre"],
  ["optimize", "optimise"], ["prioritize", "prioritise"], ["program ", "programme "],
];

function textOf(newsletter) {
  return [
    newsletter.subject,
    newsletter.previewText,
    newsletter.heroHeadline,
    newsletter.leadArticleHtml,
    ...(newsletter.stories || []).map((s) => s.summary),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function validateBannedPhrases(newsletter) {
  const haystack = textOf(newsletter).toLowerCase();
  const hits = BANNED_PHRASES.filter((phrase) => haystack.includes(phrase));
  return {
    pass: hits.length === 0,
    issues: hits.map((phrase) => ({ code: "banned_phrase", message: `Contains banned phrase: "${phrase}"` })),
  };
}

export function validateBritishSpelling(newsletter) {
  const haystack = textOf(newsletter).toLowerCase();
  const hits = AMERICANISM_PAIRS
    .filter(([american]) => haystack.includes(american))
    .map(([american, british]) => ({
      code: "americanism",
      message: `Found American spelling "${american.trim()}" — use "${british.trim()}"`,
    }));
  return { pass: hits.length === 0, issues: hits };
}

export function validateSubjectLength(newsletter) {
  const issues = [];
  if (!newsletter.subject) issues.push({ code: "missing_subject", message: "Subject line is missing." });
  else if (newsletter.subject.length > 78) {
    issues.push({ code: "subject_too_long", message: `Subject line is ${newsletter.subject.length} chars (limit 78 to avoid clipping).` });
  }
  return { pass: issues.length === 0, issues };
}

export function validateStructuralCompleteness(newsletter, { expectedStoryCount } = {}) {
  const issues = [];
  if (!newsletter.heroHeadline) issues.push({ code: "missing_hero_headline", message: "Hero headline is missing." });
  if (!newsletter.leadArticleHtml) issues.push({ code: "missing_lead_article", message: "Lead article body is missing." });
  if (!newsletter.heroImageUrl) issues.push({ code: "missing_hero_image", message: "Hero image URL is missing." });
  if (!Array.isArray(newsletter.stories) || newsletter.stories.length === 0) {
    issues.push({ code: "missing_stories", message: "No top-story summaries present." });
  } else if (expectedStoryCount && newsletter.stories.length < expectedStoryCount) {
    issues.push({
      code: "story_count_short",
      message: `Only ${newsletter.stories.length} of ${expectedStoryCount} expected stories present.`,
    });
  }
  return { pass: issues.length === 0, issues };
}

export function validateNoDuplicateStories(newsletter) {
  const links = [newsletter.sourceLink, ...(newsletter.stories || []).map((s) => s.link)].filter(Boolean);
  const seen = new Set();
  const dupes = new Set();
  for (const link of links) {
    const key = link.toLowerCase().replace(/[?#].*$/, "");
    if (seen.has(key)) dupes.add(key);
    seen.add(key);
  }
  return {
    pass: dupes.size === 0,
    issues: [...dupes].map((link) => ({ code: "duplicate_story", message: `Story link appears more than once: ${link}` })),
  };
}

export function validateLinks(newsletter) {
  const issues = [];
  const links = [newsletter.sourceLink, ...(newsletter.stories || []).map((s) => s.link)];
  for (const link of links) {
    if (!link) {
      issues.push({ code: "missing_link", message: "A story is missing its source link." });
      continue;
    }
    try {
      const parsed = new URL(link);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        issues.push({ code: "unsafe_link_protocol", message: `Story link uses an unsupported protocol: ${link}` });
      }
    } catch {
      issues.push({ code: "malformed_link", message: `Story link is not a valid URL: ${link}` });
    }
  }
  return { pass: issues.length === 0, issues };
}

const ALL_VALIDATORS = [
  validateBannedPhrases,
  validateBritishSpelling,
  validateSubjectLength,
  validateStructuralCompleteness,
  validateNoDuplicateStories,
  validateLinks,
];

/**
 * Runs every deterministic validator and returns a combined report.
 */
export function runDeterministicValidators(newsletter, { expectedStoryCount } = {}) {
  const issues = [];
  for (const validator of ALL_VALIDATORS) {
    const result = validator(newsletter, { expectedStoryCount });
    issues.push(...result.issues);
  }
  return { pass: issues.length === 0, issues };
}

export default {
  validateBannedPhrases,
  validateBritishSpelling,
  validateSubjectLength,
  validateStructuralCompleteness,
  validateNoDuplicateStories,
  validateLinks,
  runDeterministicValidators,
};
