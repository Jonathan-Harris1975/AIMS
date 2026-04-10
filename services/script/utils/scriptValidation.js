import { OUTRO_CLOSING_TAGLINE } from "./promptTemplates.js";

const MIN_TRANSCRIPT_LENGTH = 500;
const MIN_OUTRO_LENGTH = 120;

function normaliseWhitespace(text = "") {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasRequiredOutro(text = "") {
  const normalised = normaliseWhitespace(text);
  return normalised.includes(normaliseWhitespace(OUTRO_CLOSING_TAGLINE));
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
    /\b(and|or|but|so|because|if|when|while|for|with|to|of|from|about|into|through|around|what|which|that|this|these|those|than|then)\s*$/,
    /[,;:\-–—]\s*$/,
    /\b(?:you would ask for|this means that|the point is that|what happens when)\s*$/,
  ];

  return abruptPatterns.some((pattern) => pattern.test(tail));
}

export function extractOutro(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";

  const taglinePattern = new RegExp(`${escapeRegExp(OUTRO_CLOSING_TAGLINE)}\\s*$`, "i");
  const match = trimmed.match(taglinePattern);
  if (!match) return "";

  const endIndex = trimmed.length;
  const uptoTagline = trimmed.slice(0, endIndex - match[0].length).trimEnd();
  const paragraphs = uptoTagline.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);

  if (!paragraphs.length) return match[0].trim();

  const outroBody = paragraphs[paragraphs.length - 1];
  return `${outroBody}\n\n${match[0].trim()}`.trim();
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

  return {
    ok: reasons.length === 0,
    reasons,
    outro,
  };
}
