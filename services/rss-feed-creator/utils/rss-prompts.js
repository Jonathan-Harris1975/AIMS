// ============================================================
// 🧠 RSS Feed Creator — Jonathan Harris Editorial Prompt Pack
// ============================================================
//
// Purpose:
// - Enforce a consistent on-brand Jonathan Harris RSS voice
// - Keep titles and summaries human, sharp, and clean
// - Prevent podcast, PR, and trade-publication drift
// ============================================================

import { warn } from "../../../logger.js";
import { buildRssPersona } from "./toneSetter.js";

const MIN_SUMMARY_CHARS =
  Number(process.env.MIN_SUMMARY_CHARS) > 0
    ? Number(process.env.MIN_SUMMARY_CHARS)
    : 300;

const MAX_SUMMARY_CHARS =
  Number(process.env.MAX_SUMMARY_CHARS) > 0
    ? Number(process.env.MAX_SUMMARY_CHARS)
    : 1100;

const TITLE_BRAND_PATTERNS = [
  { pattern: /^\s*title\s*:/i, message: 'Title uses banned prefix "Title:"' },
  { pattern: /^\s*ai\s*:/i, message: 'Title uses banned prefix "AI:"' },
  { pattern: /^\s*openai\s*:/i, message: 'Title uses banned prefix "OpenAI:"' },
  { pattern: /^\s*report\s*:/i, message: 'Title uses banned prefix "Report:"' },
  { pattern: /^\s*study\s*:/i, message: 'Title uses banned prefix "Study:"' },
  { pattern: /^\s*analysis\s*:/i, message: 'Title uses banned prefix "Analysis:"' },
  { pattern: /^\s*rewrite_aborted\s*$/i, message: 'Title is sentinel value "REWRITE_ABORTED"' },
  { pattern: /\brewrite_aborted\b/i, message: 'Title contains sentinel value "REWRITE_ABORTED"' },
  { pattern: /^\s*why\b/i, message: 'Title uses banned explainer scaffold "Why..."' },
  { pattern: /^\s*how\b/i, message: 'Title uses banned explainer scaffold "How..."' },
  {
    pattern: /^\s*what\s+to\s+know\b/i,
    message: 'Title uses banned explainer scaffold "What to know..."',
  },
  {
    pattern: /^\s*everything\s+you\s+need\s+to\s+know\b/i,
    message: 'Title uses banned explainer scaffold "Everything you need to know..."',
  },
  {
    pattern: /^\s*questions\s+to\s+consider\b/i,
    message: 'Title uses banned explainer scaffold "Questions to consider..."',
  },
];

const METADATA_LEAK_PATTERNS = [
  { pattern: /(^|\n)\s*character\s*count\s*:/i, message: 'Contains metadata leak "Character count:"' },
  { pattern: /(^|\n)\s*word\s*count\s*:/i, message: 'Contains metadata leak "Word count:"' },
  { pattern: /(^|\n)\s*note\s*:/i, message: 'Contains metadata leak "Note:"' },
  { pattern: /(^|\n)\s*label\s*:/i, message: 'Contains metadata leak "Label:"' },
  { pattern: /(^|\n)\s*summary\s*:/i, message: 'Contains metadata leak "Summary:"' },
  { pattern: /(^|\n)\s*headline\s*:/i, message: 'Contains metadata leak "Headline:"' },
  { pattern: /(^|\n)\s*title\s*:/i, message: 'Contains metadata leak "Title:"' },
];

const BANNED_SUMMARY_PHRASES = [
  "in a significant development",
  "in a move that",
  "as we move forward",
  "the implications are significant",
  "in today's rapidly evolving landscape",
  "this highlights the importance of",
  "this underscores",
  "this showcases",
  "it remains to be seen",
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
  "underscores",
  "showcases",
  "notably",
];

export const SYSTEM = `
${buildRssPersona()}

NON-NEGOTIABLE RULES

1. TOPIC FIDELITY
- Stay on the exact subject of the provided source content.
- Do not invent facts.
- Do not widen the piece into generic AI commentary.
- If the content is empty, too thin, broken, or clearly mismatched with the title, output exactly:
REWRITE_ABORTED

2. TITLE RULES
- Output one clean headline only
- Maximum 12 words
- No prefixes of any kind
- Never begin with or include labels such as: Title:, AI:, OpenAI:, Report:, Study:, Analysis:
- Avoid explainer scaffolding such as: Why..., How..., What to know..., Everything you need to know..., X as Y...
- Avoid generic vendor-announcement structures unless there is no more natural way to say it
- Avoid colon-led scaffolding unless absolutely necessary
- No clickbait
- No stacked clauses
- No SEO phrasing
- Prefer natural headline casing

3. SUMMARY RULES
- Write one short editorial brief in plain text prose
- Aim for 2 to 4 short paragraphs
- Sound spoken, not editorial
- Be direct and clear about what happened, why it matters, and what feels overblown, missing, risky, or worth watching
- Mild wit is welcome
- Dry scepticism is welcome
- Do not over-explain obvious points
- Do not mention the source publication unless essential to the story itself
- Summary length must be between ${MIN_SUMMARY_CHARS} and ${MAX_SUMMARY_CHARS} characters

4. HARD BANS
Do not use:
- marketing sludge
- PR cadence
- fake urgency
- inspirational wrap-up lines
- abstract future-gazing filler
- generic transition phrases like:
  in a significant development
  in a move that
  as we move forward
  the implications are significant
  in today's rapidly evolving landscape
  this highlights the importance of
  this underscores
  this showcases
  it remains to be seen
  the future of
  this could pave the way
  it will be interesting to see
  one might wonder
  in a world where
- obvious LLM words and rhythms like:
  delve
  landscape
  realm
  notably
  underscores
  showcases
  transformative
  groundbreaking
  revolutionary
  cutting-edge
  game-changer
  paradigm shift

5. PRESENTATION RULES
- Plain UTF-8 text only
- No HTML
- No bullets
- No emojis
- No quotation marks around the headline
- No source names unless essential to the story itself
- No URLs
- No read more language
- No newsletter language
- No calls to action
- Never output character counts, word counts, notes, labels, or explanations

OUTPUT FORMAT
Line 1: headline
Line 2: blank
Line 3 onward: summary only

Before finalising, silently check:
- Is the headline clean and natural?
- Does it avoid prefixes and formula templates?
- Does the summary sound spoken rather than editorial?
- Does it avoid filler, hype, and corporate sludge?
- Does it feel like Jonathan Harris, not generic AI middleware?

If not, rewrite it internally before answering.
`.trim();

export function USER_ITEM({
  title = "",
  text = "",
  published = "",
  maxTitleWords = 12,
  minChars = MIN_SUMMARY_CHARS,
  maxChars = MAX_SUMMARY_CHARS,
} = {}) {
  const clean = (t = "") =>
    String(t).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

  const cleanedTitle = clean(title);
  const cleanedText = clean(text) || "(No description provided)";

  return [
    "Rewrite this AI news item for the Jonathan Harris RSS feed.",
    "",
    `Source title: ${cleanedTitle}`,
    published ? `Published: ${clean(published)}` : "",
    "",
    "Source text:",
    cleanedText,
    "",
    "Return only:",
    `1. headline (maximum ${maxTitleWords} words)`,
    "2. blank line",
    `3. summary (${minChars}-${maxChars} characters)`,
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeStraightQuotes(text = "") {
  return String(text || "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

export function normalizePlainText(text = "") {
  return normalizeStraightQuotes(text).replace(/\s+/g, " ").trim();
}

export function normalizeSummaryText(summary = "") {
  const normalized = normalizeStraightQuotes(summary).replace(/\r\n?/g, "\n");
  const paragraphs = normalized
    .split(/\n\s*\n+/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/[ \t]+/g, " ")
        .trim()
    )
    .filter(Boolean);

  return paragraphs.join("\n\n").trim();
}

export function normalizeModelText(result = "") {
  const text = normalizeStraightQuotes(result).replace(/\r\n?/g, "\n").trim();
  const lines = text.split("\n");

  let title = "";
  const summaryLines = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!title) {
      if (line) {
        title = line;
      }
      continue;
    }

    summaryLines.push(rawLine);
  }

  return {
    title: normalizePlainText(title),
    summary: normalizeSummaryText(summaryLines.join("\n")),
  };
}

export function clampTitleTo12Words(title = "", maxWords = 12) {
  const cleaned = normalizePlainText(title);
  const words = cleaned ? cleaned.split(/\s+/) : [];

  if (words.length <= maxWords) return cleaned;

  const trimmed = words.slice(0, maxWords).join(" ");
  return trimmed.replace(/[,;:]$/, "").trim();
}

export function clampSummaryToWindow(
  summary = "",
  min = MIN_SUMMARY_CHARS,
  max = MAX_SUMMARY_CHARS
) {
  const normalized = normalizeSummaryText(summary);

  if (!normalized) return "";

  if (normalized.length < min) {
    warn("rss.summary.tooShort", { length: normalized.length, min });
    return normalized;
  }

  if (normalized.length <= max) return normalized;

  const cutoffPeriod = normalized.lastIndexOf(".", max);
  const cutoffQuestion = normalized.lastIndexOf("?", max);
  const cutoffExclaim = normalized.lastIndexOf("!", max);
  const cutoff = Math.max(cutoffPeriod, cutoffQuestion, cutoffExclaim);

  if (cutoff > min) {
    return normalizeSummaryText(normalized.slice(0, cutoff + 1));
  }

  const lastSpace = normalized.lastIndexOf(" ", max);
  if (lastSpace > min) {
    return normalizeSummaryText(normalized.slice(0, lastSpace)) + "…";
  }

  return normalizeSummaryText(normalized.slice(0, max - 1)) + "…";
}

export function findMetadataLeaks(text = "") {
  const source = String(text || "");
  return METADATA_LEAK_PATTERNS.filter(({ pattern }) => pattern.test(source)).map(
    ({ message }) => message
  );
}

export function hasMetadataLeak(text = "") {
  return findMetadataLeaks(text).length > 0;
}

export function findBannedSummaryPhrases(summary = "") {
  const lowered = normalizeSummaryText(summary).toLowerCase();
  return BANNED_SUMMARY_PHRASES.filter((phrase) => lowered.includes(phrase));
}

export function validateTitleBrand(title = "") {
  const cleanedTitle = normalizePlainText(title);
  const errors = [];

  if (!cleanedTitle) {
    errors.push("Title is empty");
    return { valid: false, errors };
  }

  for (const { pattern, message } of TITLE_BRAND_PATTERNS) {
    if (pattern.test(cleanedTitle)) {
      errors.push(message);
    }
  }

  errors.push(...findMetadataLeaks(cleanedTitle));

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateOutput(title = "", summary = "", config = {}) {
  const {
    maxTitleWords = 12,
    minChars = MIN_SUMMARY_CHARS,
    maxChars = MAX_SUMMARY_CHARS,
  } = config;

  const normalizedTitle = normalizePlainText(title);
  const normalizedSummary = normalizeSummaryText(summary);

  const errors = [];
  const warnings = [];

  const titleBrand = validateTitleBrand(normalizedTitle);
  if (!titleBrand.valid) {
    errors.push(...titleBrand.errors);
  }

  const titleWords = normalizedTitle ? normalizedTitle.split(/\s+/).length : 0;
  if (titleWords > maxTitleWords) {
    errors.push(`Title exceeds ${maxTitleWords} words (has ${titleWords})`);
  }

  if (!normalizedSummary) {
    errors.push("Summary is empty");
  }

  const summaryLength = normalizedSummary.length;
  if (summaryLength < minChars) {
    warnings.push(`Summary too short: ${summaryLength} chars (min: ${minChars})`);
  }
  if (summaryLength > maxChars) {
    errors.push(`Summary too long: ${summaryLength} chars (max: ${maxChars})`);
  }

  if (/<[^>]+>/.test(normalizedSummary)) {
    errors.push("Summary contains HTML markup");
  }

  const summaryMetadataLeaks = findMetadataLeaks(normalizedSummary);
  if (summaryMetadataLeaks.length) {
    errors.push(...summaryMetadataLeaks);
  }

  const bannedSummaryPhrases = findBannedSummaryPhrases(normalizedSummary);
  if (bannedSummaryPhrases.length) {
    errors.push(
      `Summary contains banned filler: ${bannedSummaryPhrases.slice(0, 5).join(", ")}`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      titleWords,
      summaryChars: summaryLength,
      summaryWords: normalizedSummary ? normalizedSummary.split(/\s+/).length : 0,
    },
  };
}

const RSS_PROMPTS = {
  SYSTEM,
  USER_ITEM,
  user: USER_ITEM,
  normalizePlainText,
  normalizeSummaryText,
  normalizeModelText,
  clampTitleTo12Words,
  clampSummaryToWindow,
  validateTitleBrand,
  validateOutput,
  findMetadataLeaks,
  hasMetadataLeak,
  findBannedSummaryPhrases,
  TITLE_BRAND_PATTERNS,
  METADATA_LEAK_PATTERNS,
  BANNED_SUMMARY_PHRASES,
  MIN_SUMMARY_CHARS,
  MAX_SUMMARY_CHARS,
};

export { RSS_PROMPTS };
export default RSS_PROMPTS;
