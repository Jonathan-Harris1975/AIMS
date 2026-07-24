// ============================================================
// 🧷 Phase 3 Autonomous Content Gates
// ============================================================
//
// Purpose:
// - Allow RSS/blog/social content to publish automatically only when it
//   passes brand, source-integrity, SEO/GEO/AEO, readability and TTS gates.
// - Fail closed: failed content is quarantined by the caller and is not
//   published, scheduled, merged into manifests, or pushed into RSS.
//
// This module is deterministic by design. It complements model-based QA;
// it does not replace source evidence, tests, or publication governance.
// ============================================================

const DEFAULT_AUTOPUBLISH_THRESHOLD = 85;
const DEFAULT_SOURCE_MIN_CHARS = 180;
const DEFAULT_MAX_SENTENCE_WORDS = 34;
const DEFAULT_MAX_PODCAST_SENTENCE_WORDS = 26;

export const PHASE3_MODE = "auto-review-auto-publish-fail-closed";

const BRITISH_SPELLINGS = [
  ["analyze", "analyse"],
  ["analyzed", "analysed"],
  ["analyzing", "analysing"],
  ["behavior", "behaviour"],
  ["behaviors", "behaviours"],
  ["center", "centre"],
  ["centered", "centred"],
  ["color", "colour"],
  ["colors", "colours"],
  ["favor", "favour"],
  ["favorite", "favourite"],
  ["honor", "honour"],
  ["labor", "labour"],
  ["organization", "organisation"],
  ["organizations", "organisations"],
  ["organize", "organise"],
  ["organized", "organised"],
  ["organizing", "organising"],
  ["optimize", "optimise"],
  ["optimized", "optimised"],
  ["optimizing", "optimising"],
  ["prioritize", "prioritise"],
  ["prioritized", "prioritised"],
  ["program", "programme"],
  ["programs", "programmes"],
  ["realize", "realise"],
  ["realized", "realised"],
  ["recognize", "recognise"],
  ["recognized", "recognised"],
];

const BANNED_PHRASES = [
  "in a significant development",
  "in a move that",
  "as we move forward",
  "the implications are significant",
  "in today's rapidly evolving landscape",
  "today's fast-paced world",
  "rapidly evolving landscape",
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
  "game-changing",
  "game changer",
  "game-changer",
  "paradigm shift",
  "unprecedented",
  "delve",
  "landscape",
  "realm",
  "notably",
  "underscores",
  "showcases",
  "robust data fabric",
  "robust data infrastructure",
  "seamless data integration",
  "meaningful business value",
  "deliver meaningful business value",
  "competitive advantage",
  "holistic approach",
  "mainstream application",
  "finds its footing",
  "pivotal moment",
  "poses significant",
  "raises questions",
  "harness the power",
  "unlock the potential",
  "supercharge",
  "democratize",
  "democratise",
];

const BANNED_TITLE_PATTERNS = [
  [/^\s*(title|ai|openai|report|study|analysis)\s*:/i, "Title uses a banned label prefix"],
  [/^\s*(why|how)\b/i, "Title uses a generic explainer scaffold"],
  [/^\s*what\s+to\s+know\b/i, "Title uses a generic 'what to know' scaffold"],
  [/^\s*everything\s+you\s+need\s+to\s+know\b/i, "Title uses a generic explainer scaffold"],
  [/\band\s+the\s+challenge\s+of\b/i, "Title uses formulaic challenge wording"],
  [/\brequires\s+robust\b/i, "Title uses corporate scaffold wording"],
  [/\bhampers\s+progress\b/i, "Title uses generic progress wording"],
];

const IMAGE_BANS = [
  "text",
  "letters",
  "numbers",
  "logos",
  "watermarks",
  "glowing brains",
  "cartoon robots",
  "stock office scenes",
  "generic ai wallpaper",
];

const EXEMPT_ENTITY_WORDS = new Set([
  "AI",
  "RSS",
  "URL",
  "HTML",
  "JSON",
  "SEO",
  "AEO",
  "GEO",
  "TTS",
  "API",
  "R2",
  "UK",
  "US",
  "EU",
  "Jonathan",
  "Harris",
  "Jonathan Harris",
  "Artificial",
  "Intelligence",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]);

function asText(value = "") {
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join("\n");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value || "");
}

export function normaliseContentText(value = "") {
  return asText(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function toLowerText(value = "") {
  return normaliseContentText(value).toLowerCase();
}

function splitSentences(text = "") {
  const clean = normaliseContentText(text);
  if (!clean) return [];
  return clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [];
}

function countWords(text = "") {
  return normaliseContentText(text).split(/\s+/).filter(Boolean).length;
}

function listBannedPhrases(text = "") {
  const lowered = toLowerText(text);
  return BANNED_PHRASES.filter((phrase) => lowered.includes(phrase));
}

function listAmericanSpellings(text = "") {
  const lowered = ` ${toLowerText(text)} `;
  return BRITISH_SPELLINGS
    .filter(([american]) => new RegExp(`\\b${american}\\b`, "i").test(lowered))
    .map(([american, british]) => ({ american, british }));
}

function extractNumbersAndClaims(text = "") {
  const clean = normaliseContentText(text);
  return clean.match(/(?:£|\$|€)?\b\d+(?:[,.]\d+)*(?:\.\d+)?\s?(?:%|percent|per cent|bn|billion|m|million|k|thousand)?\b/gi) || [];
}

function extractQuotedClaims(text = "") {
  const clean = normaliseContentText(text);
  const matches = clean.match(/"[^"\n]{24,}"/g) || [];

  return matches
    .map((quote) => quote.trim())
    .filter((quote) => {
      const inner = quote.replace(/^"|"$/g, "").trim();

      // Short quoted labels such as "Deploying" or "eligible automated purchases"
      // are editorial terminology, not direct evidence claims. Keep the hard gate
      // focused on substantial direct quotations that would need source backing.
      if (countWords(inner) < 5) return false;

      return true;
    });
}

function extractDateClaims(text = "") {
  const clean = normaliseContentText(text);
  return clean.match(/\b(?:20\d{2}|19\d{2}|Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/gi) || [];
}

function extractEntities(text = "") {
  const clean = normaliseContentText(text);
  const matches = clean.match(/\b[A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,3}\b/g) || [];
  return [...new Set(matches.map((x) => x.trim()).filter((entity) => {
    if (entity.length < 3) return false;
    if (EXEMPT_ENTITY_WORDS.has(entity)) return false;
    if (entity.split(/\s+/).every((part) => EXEMPT_ENTITY_WORDS.has(part))) return false;
    return true;
  }))];
}

function unsupportedItems(generated = [], sourceText = "") {
  const source = toLowerText(sourceText);
  return [...new Set(generated)].filter((claim) => {
    const clean = normaliseContentText(claim);
    if (!clean) return false;
    return !source.includes(clean.toLowerCase());
  });
}

function sourceContainsNumericClaim(claim = "", sourceText = "") {
  const clean = normaliseContentText(claim).toLowerCase().replace(/,/g, "").trim();
  if (!clean) return true;

  const source = toLowerText(sourceText).replace(/,/g, " ");
  const compactSource = source.replace(/\s+/g, "");
  const compactClaim = clean.replace(/\s+/g, "");

  if (source.includes(clean) || compactSource.includes(compactClaim)) return true;

  const match = clean.match(/^(£|\$|€)?(\d+(?:\.\d+)?)\s*(m|million|bn|billion|k|thousand)?$/i);
  if (!match) return false;

  const [, currency = "", number, suffix = ""] = match;
  const lowerSuffix = suffix.toLowerCase();
  const suffixVariants = lowerSuffix === "million" || lowerSuffix === "m"
    ? ["m", " million"]
    : lowerSuffix === "billion" || lowerSuffix === "bn"
      ? ["bn", " billion"]
      : lowerSuffix === "thousand" || lowerSuffix === "k"
        ? ["k", " thousand"]
        : [""];

  return suffixVariants.some((variant) => {
    const readable = `${currency}${number}${variant}`.trim();
    const compact = readable.replace(/\s+/g, "");
    return source.includes(readable) || compactSource.includes(compact);
  });
}

function unsupportedNumericClaims(generated = [], sourceText = "") {
  return [...new Set(generated)].filter((claim) => !sourceContainsNumericClaim(claim, sourceText));
}

function keywordOverlap(sourceText = "", outputText = "") {
  const stop = new Set([
    "about", "after", "again", "also", "because", "before", "being", "between", "could", "from", "have", "into", "more", "most", "much", "news", "over", "same", "some", "that", "their", "there", "these", "this", "those", "through", "what", "when", "where", "which", "while", "with", "would", "your",
  ]);
  const words = (text) => normaliseContentText(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((word) => word.length >= 5 && !stop.has(word));
  const source = new Set(words(sourceText));
  const output = new Set(words(outputText));
  if (!source.size || !output.size) {
    return { overlap: 0, sourceCoverage: 0, shared: 0, sourceTerms: source.size, outputTerms: output.size };
  }
  let shared = 0;
  for (const word of output) {
    if (source.has(word)) shared += 1;
  }
  return {
    overlap: shared / output.size,
    sourceCoverage: shared / source.size,
    shared,
    sourceTerms: source.size,
    outputTerms: output.size,
  };
}

function gate(name, passed, details = {}, weight = 10, hard = true) {
  const defects = Array.isArray(details.defects) ? details.defects.filter(Boolean) : [];
  const warnings = Array.isArray(details.warnings) ? details.warnings.filter(Boolean) : [];
  return {
    name,
    passed: Boolean(passed),
    hard: Boolean(hard),
    weight,
    defects,
    warnings,
    details: Object.fromEntries(
      Object.entries(details).filter(([key]) => !["defects", "warnings"].includes(key)),
    ),
  };
}

function buildSourceText({ sourceText, sourceItems = [], sources = [] } = {}) {
  const itemText = Array.isArray(sourceItems)
    ? sourceItems.map((item) => [item?.title, item?.summary, item?.description, item?.rewritten, item?.link].filter(Boolean).join("\n")).join("\n\n")
    : "";
  const sourceListText = Array.isArray(sources)
    ? sources.map((item) => [item?.title, item?.summary, item?.description, item?.rewritten, item?.link].filter(Boolean).join("\n")).join("\n\n")
    : "";
  return normaliseContentText([sourceText, itemText, sourceListText].filter(Boolean).join("\n\n"));
}

function buildOutputText(payload = {}) {
  const parts = [
    payload.title,
    payload.summary,
    payload.bodyText,
    payload.socialCaption,
    payload.hook,
    payload.takeaway,
    Array.isArray(payload.sections)
      ? payload.sections.map((section) => [section?.heading, section?.paragraphs, section?.bullets].filter(Boolean).join(" ")).join("\n")
      : "",
    Array.isArray(payload.themes) ? payload.themes.join(" ") : "",
    Array.isArray(payload.hashtags) ? payload.hashtags.join(" ") : "",
  ];
  return normaliseContentText(parts.filter(Boolean).join("\n\n"));
}

export function runPhase3AutopublishGate(payload = {}) {
  const contentType = String(payload.contentType || "content");
  const threshold = Number(process.env.PHASE3_AUTOPUBLISH_MIN_SCORE || DEFAULT_AUTOPUBLISH_THRESHOLD);
  const sourceMinChars = Number(process.env.PHASE3_SOURCE_MIN_CHARS || DEFAULT_SOURCE_MIN_CHARS);
  const maxSentenceWords = Number(
    contentType.includes("podcast")
      ? process.env.PHASE3_MAX_PODCAST_SENTENCE_WORDS || DEFAULT_MAX_PODCAST_SENTENCE_WORDS
      : process.env.PHASE3_MAX_SENTENCE_WORDS || DEFAULT_MAX_SENTENCE_WORDS,
  );

  const title = normaliseContentText(payload.title);
  const summary = normaliseContentText(payload.summary);
  const imagePrompt = normaliseContentText(payload.imagePrompt || payload.image_prompt);
  const outputText = buildOutputText(payload);
  const sourceText = buildSourceText(payload);
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  const themes = Array.isArray(payload.themes) ? payload.themes.filter(Boolean) : [];
  const hashtags = Array.isArray(payload.hashtags) ? payload.hashtags.filter(Boolean) : [];
  const sentences = splitSentences(outputText);
  const overlongSentences = sentences
    .map((sentence) => ({ sentence, words: countWords(sentence) }))
    .filter((item) => item.words > maxSentenceWords);

  const bannedTitlePatterns = BANNED_TITLE_PATTERNS
    .filter(([pattern]) => pattern.test(title))
    .map(([, message]) => message);
  const bannedPhrases = listBannedPhrases(outputText);
  const americanSpellings = listAmericanSpellings(outputText);
  const sourceOverlap = keywordOverlap(sourceText, outputText);
  const sourceOverlapFloor = contentType.includes("rss")
    ? Number(process.env.PHASE3_RSS_SOURCE_OVERLAP_MIN || 0.10)
    : Number(process.env.PHASE3_SOURCE_OVERLAP_MIN || 0.16);
  const sourceCoverageFloor = contentType.includes("rss")
    ? Number(process.env.PHASE3_RSS_SOURCE_COVERAGE_MIN || 0.15)
    : Number(process.env.PHASE3_SOURCE_COVERAGE_MIN || 0.18);
  const hasEnoughSourceOverlap = sourceOverlap.overlap >= sourceOverlapFloor || sourceOverlap.sourceCoverage >= sourceCoverageFloor;
  const outputNumbers = extractNumbersAndClaims(outputText);
  const unsupportedNumbers = unsupportedNumericClaims(outputNumbers, sourceText);
  const quotedClaims = extractQuotedClaims(outputText);
  const unsupportedQuotes = unsupportedItems(quotedClaims, sourceText);
  const dateClaims = extractDateClaims(outputText);
  const unsupportedDates = unsupportedItems(dateClaims, sourceText);
  const outputEntities = extractEntities(outputText);
  const unsupportedEntities = unsupportedItems(outputEntities, sourceText).slice(0, 10);

  const titleWords = countWords(title);
  const summarySentences = splitSentences(summary).length;
  const hasSourceLinks = sources.some((source) => /^https?:\/\//i.test(String(source?.link || source?.url || "")));
  const hasAnswerFirstSummary = summarySentences >= 1 && countWords(summary) >= 12;
  const hasUsefulThemes = themes.length >= (contentType.includes("rss") ? 0 : 2);
  const hasSocialTags = !contentType.includes("social") || (hashtags.length >= 3 && hashtags.length <= 8);
  const hasImagePromptContract = !imagePrompt || (
    /dark|navy|charcoal|editorial|premium/i.test(imagePrompt)
    && IMAGE_BANS.every((phrase) => new RegExp(`no\\s+${phrase.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}`, "i").test(imagePrompt))
  );

  const gates = [
    gate("brand-tone", !bannedPhrases.length && !bannedTitlePatterns.length, {
      defects: [
        ...bannedTitlePatterns,
        ...bannedPhrases.map((phrase) => `Banned phrase detected: ${phrase}`),
      ],
      bannedPhrases,
      bannedTitlePatterns,
    }, 18, true),
    gate("british-english", !americanSpellings.length, {
      defects: americanSpellings.map(({ american, british }) => `Use British English: ${american} → ${british}`),
      americanSpellings,
    }, 8, false),
    gate("source-integrity", sourceText.length >= sourceMinChars && !unsupportedNumbers.length && !unsupportedQuotes.length && hasEnoughSourceOverlap, {
      defects: [
        sourceText.length < sourceMinChars ? `Source evidence too thin (${sourceText.length} chars < ${sourceMinChars})` : "",
        ...unsupportedNumbers.map((claim) => `Unsupported numeric claim: ${claim}`),
        ...unsupportedQuotes.map((claim) => `Unsupported quotation: ${claim}`),
        !hasEnoughSourceOverlap ? `Low source/output keyword overlap (${sourceOverlap.overlap.toFixed(2)}; source coverage ${Number(sourceOverlap.sourceCoverage || 0).toFixed(2)})` : "",
      ],
      warnings: unsupportedDates.map((claim) => `Date claim should be source-backed: ${claim}`),
      sourceChars: sourceText.length,
      sourceOverlap,
      unsupportedNumbers,
      unsupportedQuotes,
      unsupportedDates,
      unsupportedEntities,
    }, 22, true),
    gate("structure", Boolean(title && titleWords >= 3 && titleWords <= 14 && hasAnswerFirstSummary), {
      defects: [
        !title ? "Missing title" : "",
        titleWords && titleWords < 3 ? `Title too short (${titleWords} words)` : "",
        titleWords > 14 ? `Title too long (${titleWords} words)` : "",
        !hasAnswerFirstSummary ? "Summary must be answer-first and substantive" : "",
      ],
      titleWords,
      summarySentences,
      summaryWords: countWords(summary),
    }, 15, true),
    gate("seo-geo-aeo", Boolean(title && summary && hasSourceLinks && hasUsefulThemes), {
      defects: [
        !hasSourceLinks ? "At least one source link is required for publication evidence" : "",
        !hasUsefulThemes ? "Missing themes/entities/topics for GEO/AEO extraction" : "",
      ],
      sourceCount: sources.length,
      themeCount: themes.length,
    }, 14, true),
    gate("readability-tts", !overlongSentences.length, {
      defects: overlongSentences.slice(0, 5).map((item) => `Sentence too long (${item.words} words): ${item.sentence.slice(0, 120)}`),
      maxSentenceWords,
      overlongCount: overlongSentences.length,
    }, 10, false),
    gate("image-prompt", hasImagePromptContract, {
      defects: imagePrompt ? ["Image prompt must explicitly ban text, letters, numbers, logos, watermarks, glowing brains, cartoon robots, stock office scenes and generic AI wallpaper"] : [],
      hasImagePrompt: Boolean(imagePrompt),
    }, 6, false),
    gate("social-contract", hasSocialTags, {
      defects: hasSocialTags ? [] : [`Social content needs 3 to 8 hashtags; found ${hashtags.length}`],
      hashtagCount: hashtags.length,
    }, 7, contentType.includes("social")),
  ];

  const weightedTotal = gates.reduce((sum, item) => sum + item.weight, 0);
  const passedWeight = gates.reduce((sum, item) => sum + (item.passed ? item.weight : 0), 0);
  const score = weightedTotal ? Math.round((passedWeight / weightedTotal) * 1000) / 10 : 0;
  const hardFailures = gates.filter((item) => item.hard && !item.passed);
  const ok = hardFailures.length === 0 && score >= threshold;
  const defects = gates.flatMap((item) => item.defects.map((defect) => `${item.name}: ${defect}`));
  const warnings = gates.flatMap((item) => item.warnings.map((warning) => `${item.name}: ${warning}`));

  return {
    schemaVersion: "2026-05-17.phase3-autopublish-gate",
    mode: PHASE3_MODE,
    contentType,
    ok,
    status: ok ? "PASSED_AUTO_PUBLISH" : "QUARANTINED_FAIL_CLOSED",
    score,
    threshold,
    hardFailureCount: hardFailures.length,
    gates,
    defects,
    warnings,
    metrics: {
      titleWords,
      summaryWords: countWords(summary),
      summarySentences,
      sentenceCount: sentences.length,
      sourceChars: sourceText.length,
      sourceCount: sources.length,
      themeCount: themes.length,
      hashtagCount: hashtags.length,
      outputChars: outputText.length,
    },
    generatedAt: new Date().toISOString(),
  };
}

export function assertPhase3AutopublishGate(payload = {}) {
  const report = runPhase3AutopublishGate(payload);
  if (report.ok) return report;

  const err = new Error(
    `Phase 3 auto-publish gate failed (${report.score}/${report.threshold}): ${report.defects.slice(0, 6).join(" | ")}`,
  );
  err.name = "Phase3AutopublishGateError";
  err.phase3Report = report;
  throw err;
}

export function buildPhase3QuarantinePayload({ context = {}, report, payload = {} } = {}) {
  return {
    schemaVersion: "2026-05-17.phase3-quarantine",
    ok: false,
    quarantine: true,
    mode: PHASE3_MODE,
    context,
    report,
    payload,
    createdAt: new Date().toISOString(),
  };
}

export function phase3QuarantineKey({ contentType = "content", id = "item", createdAt = new Date().toISOString() } = {}) {
  const safeType = String(contentType || "content").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "content";
  const safeId = String(id || "item").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "item";
  const timestamp = String(createdAt || new Date().toISOString()).replace(/[:.]/g, "-");
  return `phase-3-quarantine/${safeType}/${timestamp}-${safeId}.json`;
}

export function summarisePhase3Reports(reports = []) {
  const safeReports = Array.isArray(reports) ? reports.filter(Boolean) : [];
  const passed = safeReports.filter((report) => report.ok).length;
  const failed = safeReports.length - passed;
  const averageScore = safeReports.length
    ? Math.round((safeReports.reduce((sum, report) => sum + Number(report.score || 0), 0) / safeReports.length) * 10) / 10
    : 0;

  return {
    schemaVersion: "2026-05-17.phase3-summary",
    mode: PHASE3_MODE,
    total: safeReports.length,
    passed,
    failed,
    averageScore,
    status: failed ? "HAS_QUARANTINED_ITEMS" : "ALL_PASSED_AUTO_PUBLISH",
  };
}

export default {
  PHASE3_MODE,
  normaliseContentText,
  runPhase3AutopublishGate,
  assertPhase3AutopublishGate,
  buildPhase3QuarantinePayload,
  phase3QuarantineKey,
  summarisePhase3Reports,
};
