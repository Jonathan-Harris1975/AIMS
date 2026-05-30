import {
  BANNED_PROMO_PATTERNS,
  cleanLexiconText,
  findAmericanSpellings,
  findPatternBreaches,
} from "../../content-quality/brandLexicon.js";
import { OUTRO_CLOSING_TAGLINE } from "./promptTemplates.js";

const MIN_TRANSCRIPT_LENGTH = 500;
const MIN_OUTRO_LENGTH = 120;

const LOWERCASE_PUNCTUATION_ABBREVIATIONS = new Set([
  "approx",
  "etc",
  "e.g",
  "i.e",
  "vs",
]);

const DANGLING_CONNECTORS = [
  "and",
  "or",
  "but",
  "so",
  "because",
  "if",
  "when",
  "while",
  "for",
  "with",
  "to",
  "of",
  "from",
  "about",
  "into",
  "through",
  "around",
  "what",
  "which",
  "that",
  "this",
  "these",
  "those",
  "than",
  "then",
];

function normaliseWhitespace(text = "") {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function normaliseForComparison(text = "") {
  return normaliseWhitespace(
    String(text || "")
      .replace(/[“”]/g, '"')
      .replace(/[’]/g, "'")
      .replace(/[‐‑‒–—]/g, "-")
  );
}

function splitParagraphs(text = "") {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function lastNonEmptyParagraph(text = "") {
  const paragraphs = splitParagraphs(text);
  return paragraphs[paragraphs.length - 1] || "";
}

function lastSentence(text = "") {
  const trimmed = String(text || "").trim();
  const sentences = trimmed.match(/[^.!?]+[.!?]?(?:["')\]]+)?/g) || [];
  return (sentences[sentences.length - 1] || "").trim();
}

function words(text = "") {
  return normaliseWhitespace(text).split(/\s+/).filter(Boolean);
}

function textBeforeOutro(text = "") {
  const trimmed = String(text || "").trim();
  const outro = extractOutro(trimmed);
  if (!trimmed || !outro) return trimmed;

  const idx = trimmed.lastIndexOf(outro);
  if (idx < 0) return trimmed;

  return trimmed.slice(0, idx).trim();
}

export function hasRequiredOutro(text = "") {
  const normalised = normaliseForComparison(text).toLowerCase();
  const tagline = normaliseForComparison(OUTRO_CLOSING_TAGLINE).toLowerCase();
  return normalised.includes(tagline);
}

export function endsCleanly(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;
  return /[.!?"]$/.test(trimmed);
}

export function looksAbruptlyCutOff(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return true;
  if (!endsCleanly(trimmed)) return true;

  const tail = trimmed.slice(-180).toLowerCase();
  const abruptPatterns = [
    new RegExp(`\\b(?:${DANGLING_CONNECTORS.join("|")})\\s*$`, "i"),
    /[,;:\-–—]\s*$/,
    /\b(?:you would ask for|this means that|the point is that|what happens when)\s*$/,
  ];

  return abruptPatterns.some((pattern) => pattern.test(tail));
}

export function findBrokenPunctuationJoins(text = "") {
  const source = String(text || "");
  const matches = [];
  const pattern = /\b([a-z][a-z.]{1,14})\.\s+([a-z][a-z]{1,})\b/g;

  for (const match of source.matchAll(pattern)) {
    const before = String(match[1] || "").toLowerCase();
    if (LOWERCASE_PUNCTUATION_ABBREVIATIONS.has(before)) continue;

    matches.push({
      fragment: match[0],
      index: match.index || 0,
    });
  }

  return matches;
}

export function findDanglingFragmentsBeforeOutro(text = "") {
  const beforeOutro = textBeforeOutro(text);
  const finalParagraph = lastNonEmptyParagraph(beforeOutro);
  const finalSentence = lastSentence(finalParagraph);
  const finalWords = words(finalSentence);
  const reasons = [];

  if (!finalParagraph) return reasons;

  if (!endsCleanly(finalParagraph)) {
    reasons.push("main section before outro does not end with complete punctuation");
  }

  const finalParagraphTail = normaliseWhitespace(finalParagraph).slice(-220);

  if (/\.\s+[A-Z][a-z]+\.?$/.test(finalParagraphTail) && finalWords.length === 1) {
    reasons.push(`dangling single-word fragment before outro: "${finalSentence.replace(/[.!?]+$/, "")}"`);
  }

  if (/\.\s+(?:Companies|Governments|Regulators|Executives|Vendors|Investors|Users|Workers|Developers|Models|Systems)\.?$/i.test(finalParagraphTail)) {
    reasons.push("suspicious dangling noun after full stop before outro");
  }

  if (finalWords.length > 0) {
    const lastWord = finalWords[finalWords.length - 1].replace(/[^a-z]/gi, "").toLowerCase();
    if (DANGLING_CONNECTORS.includes(lastWord)) {
      reasons.push(`main section before outro ends on unfinished connector: "${lastWord}"`);
    }
  }

  if (finalWords.length <= 3 && finalWords.length > 0 && !endsCleanly(finalSentence)) {
    reasons.push(`short unfinished final fragment before outro: "${normaliseWhitespace(finalSentence)}"`);
  }

  return Array.from(new Set(reasons));
}

export function extractOutro(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";

  const normalisedTagline = normaliseForComparison(OUTRO_CLOSING_TAGLINE).toLowerCase();
  const paragraphs = splitParagraphs(trimmed);

  if (!paragraphs.length) return "";

  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const normalisedParagraph = normaliseForComparison(paragraphs[i]).toLowerCase();
    if (!normalisedParagraph.includes(normalisedTagline)) continue;

    const bodyStartIndex = i > 0 ? i - 1 : i;
    return paragraphs.slice(bodyStartIndex, i + 1).join("\n\n").trim();
  }

  return "";
}

export function enforceCanonicalOutro(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return OUTRO_CLOSING_TAGLINE;
  if (hasRequiredOutro(trimmed)) return trimmed;

  const base = endsCleanly(trimmed) ? trimmed : `${trimmed}.`;
  return `${base}\n\n${OUTRO_CLOSING_TAGLINE}`.trim();
}

export function validateTranscriptStructure(text = "") {
  const trimmed = String(text || "").trim();
  const reasons = [];

  if (trimmed.length < MIN_TRANSCRIPT_LENGTH) {
    reasons.push(`transcript too short (${trimmed.length} chars)`);
  }

  if (!hasRequiredOutro(trimmed)) {
    reasons.push("required branded outro closing line missing");
  }

  const outro = extractOutro(trimmed);
  if (!outro || normaliseWhitespace(outro).length < MIN_OUTRO_LENGTH) {
    reasons.push("outro block missing or too short");
  }

  if (!endsCleanly(trimmed)) {
    reasons.push("transcript does not end with a complete sentence");
  }

  if (looksAbruptlyCutOff(trimmed)) {
    reasons.push("transcript tail looks abruptly truncated");
  }

  const brokenJoins = findBrokenPunctuationJoins(trimmed);
  if (brokenJoins.length) {
    reasons.push(`broken lowercase punctuation join detected: "${brokenJoins[0].fragment}"`);
  }

  reasons.push(...findDanglingFragmentsBeforeOutro(trimmed));

  return {
    ok: reasons.length === 0,
    reasons: Array.from(new Set(reasons)),
    outro,
  };
}


const SOURCE_TERM_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "else", "when", "while",
  "for", "to", "of", "in", "on", "at", "by", "from", "with", "as", "is", "are",
  "was", "were", "be", "been", "being", "it", "this", "that", "these", "those", "its",
  "their", "they", "them", "we", "you", "your", "our", "us", "into", "over", "under",
  "about", "after", "before", "between", "during", "than", "too", "can", "could", "may",
  "might", "will", "would", "should", "must", "also", "just", "more", "most", "less",
  "least", "much", "many", "some", "any", "new", "news", "update", "today", "episode",
  "podcast", "artificial", "intelligence", "ai", "said", "says", "report", "reports",
  "reported",
]);

function collectSourceMaterial(value, depth = 0) {
  if (!value || depth > 4) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => collectSourceMaterial(item, depth + 1));
  if (typeof value === "object") {
    const fields = [
      "title",
      "summary",
      "description",
      "text",
      "content",
      "rewritten",
      "shortTitle",
      "sourceText",
      "source_title",
      "source_summary",
    ];
    return fields.flatMap((field) => collectSourceMaterial(value[field], depth + 1));
  }
  return [];
}

function extractSourceTextFromSession(sessionMeta = {}) {
  const sourceBuckets = [
    sessionMeta.sources,
    sessionMeta.sourceItems,
    sessionMeta.articles,
    sessionMeta.feedItems,
    sessionMeta.rssItems,
    sessionMeta.rssContext,
    sessionMeta.selectedArticles,
  ];
  return collectSourceMaterial(sourceBuckets)
    .map((part) => cleanLexiconText(part))
    .filter((part) => part.length >= 20)
    .join("\n");
}

function extractConcreteTerms(text = "") {
  return [...new Set(
    cleanLexiconText(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((word) => word.length >= 4 && !SOURCE_TERM_STOPWORDS.has(word))
  )];
}

export function validateTranscriptSourceIntegrity(text = "", sessionMeta = {}) {
  const transcript = cleanLexiconText(text);
  const sourceText = extractSourceTextFromSession(sessionMeta);
  const defects = [];
  const warnings = [];

  const bannedPromo = findPatternBreaches(transcript, BANNED_PROMO_PATTERNS);
  if (bannedPromo.length) {
    defects.push(`transcript contains banned promotional language: ${bannedPromo.slice(0, 5).join(", ")}`);
  }

  const americanSpellings = findAmericanSpellings(transcript);
  if (americanSpellings.length) {
    warnings.push(
      `possible American spellings: ${americanSpellings
        .slice(0, 8)
        .map(({ american, british }) => `${american}->${british}`)
        .join(", ")}`
    );
  }

  if (!sourceText) {
    warnings.push("no source material supplied for deterministic transcript-source overlap check");
  } else {
    const sourceTerms = extractConcreteTerms(sourceText);
    const transcriptTerms = new Set(extractConcreteTerms(transcript));
    const sharedTerms = sourceTerms.filter((term) => transcriptTerms.has(term));
    const minSharedTerms = Number(process.env.PODCAST_TRANSCRIPT_MIN_SOURCE_TERMS || 3);

    if (sourceTerms.length >= minSharedTerms && sharedTerms.length < minSharedTerms) {
      defects.push(
        `transcript keeps only ${sharedTerms.length} concrete source term(s); minimum is ${minSharedTerms}`
      );
    }
  }

  return {
    ok: defects.length === 0,
    defects: Array.from(new Set(defects)),
    warnings: Array.from(new Set(warnings)),
    sourceChecked: Boolean(sourceText),
  };
}
