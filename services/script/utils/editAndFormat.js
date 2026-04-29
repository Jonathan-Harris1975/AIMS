// ====================================================================
// editAndFormat.js - Production-Safe Final Pass
// ====================================================================

const BRITISH_SPELLINGS = new Map([
  ["clamor", "clamour"],
  ["clamors", "clamours"],
  ["clamored", "clamoured"],
  ["clamoring", "clamouring"],
]);

const HIGH_CONFIDENCE_PUNCTUATION_REPAIRS = new Set([
  "a",
  "an",
  "the",
  "this",
  "that",
  "these",
  "those",
  "my",
  "our",
  "your",
  "their",
  "his",
  "her",
  "its",
]);

function preserveCase(source, replacement) {
  if (!source) return replacement;
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  if (source[0] === source[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function normaliseBritishSpelling(text = "") {
  let out = String(text || "");

  for (const [american, british] of BRITISH_SPELLINGS.entries()) {
    const pattern = new RegExp(`\\b${american}\\b`, "gi");
    out = out.replace(pattern, (match) => preserveCase(match, british));
  }

  return out;
}

function spokenDomain(hostname = "") {
  return String(hostname || "")
    .replace(/^www\./i, "")
    .replace(/-/g, " dash ")
    .replace(/\./g, " dot ")
    .replace(/\s+/g, " ")
    .trim();
}

function urlToSpeech(match = "") {
  try {
    const url = new URL(match);
    const domain = spokenDomain(url.hostname);
    const path = String(url.pathname || "").toLowerCase();

    if (/jonathan-harris\.online$/i.test(url.hostname) || /books\.jonathan-harris\.online$/i.test(url.hostname)) {
      return path.includes("ebook") || path.includes("book") || /books\.jonathan-harris\.online$/i.test(url.hostname)
        ? "jonathan-harris dot online, under eBooks"
        : "jonathan-harris dot online";
    }

    return domain;
  } catch {
    return match;
  }
}

function normaliseUrlSpeech(text = "") {
  return String(text || "")
    .replace(/https?:\/\/[^\s)\]}>'"]+/gi, (match) => {
      const trailing = match.match(/[.,!?]+$/)?.[0] || "";
      const clean = trailing ? match.slice(0, -trailing.length) : match;
      return `${urlToSpeech(clean)}${trailing}`;
    })
    .replace(/\bbooks\s+dot\s+jonathan\s+dash\s+harris\s+dot\s+online\b/gi, "jonathan-harris dot online, under eBooks")
    .replace(/\bjonathan\s+dash\s+harris\s+dot\s+online(?:\s+slash\s+[a-z0-9\s+dash]+)+/gi, (match) =>
      /ebook|book/i.test(match) ? "jonathan-harris dot online, under eBooks" : "jonathan-harris dot online"
    )
    .replace(/\bjonathan-harris\s+dot\s+online(?:\s+slash\s+[a-z0-9\s+dash]+)+/gi, (match) =>
      /ebook|book/i.test(match) ? "jonathan-harris dot online, under eBooks" : "jonathan-harris dot online"
    );
}

function repairPunctuationGlitches(text = "") {
  return String(text || "").replace(
    /\b([a-z]{1,8})\.\s+([a-z][a-z]{1,})\b/g,
    (match, before, after) =>
      HIGH_CONFIDENCE_PUNCTUATION_REPAIRS.has(before.toLowerCase())
        ? `${before} ${after}`
        : match
  );
}

function sentenceCase(text = "") {
  return String(text || "").replace(/^([a-z])/, (m) => m.toUpperCase());
}

function splitSentenceAtBoundary(sentence = "") {
  const trimmed = String(sentence || "").trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= 32) return [trimmed];

  const minWords = 9;
  const ideal = 22;
  const maxFirstWords = Math.min(26, words.length - minWords);
  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = minWords; i <= maxFirstWords; i++) {
    const previous = words[i - 1] || "";
    const current = words[i] || "";
    const boundary = /[,;:]$/.test(previous) || /^(and|but|because|while|when|which|so|then|where|although)$/i.test(current);
    if (!boundary) continue;

    const score = Math.abs(i - ideal);
    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex < 0) {
    bestIndex = Math.max(minWords, Math.min(maxFirstWords, Math.round(words.length / 2)));
  }

  const firstWords = words.slice(0, bestIndex);
  const secondWords = words.slice(bestIndex);
  if (firstWords.length < minWords || secondWords.length < minWords) return [trimmed];

  const first = firstWords.join(" ").replace(/[,;:]$/, "").replace(/[.!?]?$/, ".");
  const second = sentenceCase(secondWords.join(" "));

  return [first, second];
}

function splitLongSentenceRecursive(sentence = "") {
  const queue = [String(sentence || "").trim()].filter(Boolean);
  const out = [];

  while (queue.length) {
    const current = queue.shift();
    const wordCount = current.split(/\s+/).filter(Boolean).length;

    if (wordCount <= 32) {
      out.push(current);
      continue;
    }

    const parts = splitSentenceAtBoundary(current);
    if (parts.length === 1) {
      out.push(current);
      continue;
    }

    queue.unshift(parts[1]);
    queue.unshift(parts[0]);
  }

  return out;
}

function splitLongSentencesInParagraph(paragraph = "") {
  const sentences = String(paragraph || "").match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g) || [];

  return sentences
    .flatMap((sentence) => splitLongSentenceRecursive(sentence.trim()))
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .join(" ");
}

function splitLongSentences(text = "") {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((paragraph) => splitLongSentencesInParagraph(paragraph.trim()))
    .filter(Boolean)
    .join("\n\n");
}

function expandAI(text) {
  return text
    .replace(/\bAI\b(?![a-zA-Z])/g, "artificial intelligence")
    .replace(
      /(artificial intelligence)(\s+artificial intelligence)+/gi,
      "artificial intelligence"
    );
}

export default function editAndFormat(text) {
  if (!text || typeof text !== "string") return "";

  let out = text.trim();

  // spacing
  out = out.replace(/[ \t]+/g, " ");
  out = out.replace(/\n{3,}/g, "\n\n");

  // ellipses
  out = out.replace(/\.{3,}/g, ", ");

  // deterministic polish before sentence splitting
  out = normaliseUrlSpeech(out);
  out = repairPunctuationGlitches(out);
  out = normaliseBritishSpelling(out);

  // expand AI safely
  out = expandAI(out);

  // sentence length control
  out = splitLongSentences(out);

  return out.trim();
}

export const __testing = {
  normaliseBritishSpelling,
  normaliseUrlSpeech,
  repairPunctuationGlitches,
  splitLongSentences,
};
