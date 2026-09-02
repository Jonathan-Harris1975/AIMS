import crypto from "node:crypto";

export function normaliseSimple(value = "") {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function extractHashtags(value = "") {
  return [...String(value || "").matchAll(/(^|\s)(#[A-Za-z0-9_]+)/g)].map((match) => match[2]);
}

export function wordCount(value = "") {
  const text = compactText(value).replace(/(^|\s)#[A-Za-z0-9_]+/g, " ").trim();
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

export function findPlainPhraseBreaches(text = "", phrases = []) {
  const source = compactText(text).toLowerCase();
  return (Array.isArray(phrases) ? phrases : [])
    .map((phrase) => String(phrase || "").trim())
    .filter(Boolean)
    .filter((phrase) => source.includes(phrase.toLowerCase()));
}

export function safeModelPreview(value = "", max = 500) {
  const text = String(value || "")
    .replace(/sk-or-[A-Za-z0-9_-]{8,}/g, "sk-or-***")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "github_pat_***")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function extractJsonCandidate(raw = "") {
  const text = String(raw || "").trim();
  if (!text) return "";
  try {
    JSON.parse(text);
    return text;
  } catch {}
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  return text;
}

export function parseJsonObject(raw, label) {
  const candidate = extractJsonCandidate(raw);
  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${label} response was not a JSON object`);
    }
    return parsed;
  } catch (error) {
    const err = new Error(`Invalid ${label} JSON from model: ${error.message}`);
    err.statusCode = 502;
    throw err;
  }
}

export function compactText(value = "") {
  return String(value || "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function ensureQuizAnswerMarker(value = "") {
  const text = compactText(value);
  if (!text) return "";

  const normalised = text
    .replace(/^\s*(?:quiz\s+answer|answer)\s*[:.!-]\s*/i, "Quiz Answer! ")
    .replace(/^\s*Quiz Answer!\s*/i, "Quiz Answer! ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (/^Quiz Answer!/i.test(normalised)) return normalised;
  return `Quiz Answer! ${normalised}`;
}

export function escapeRegExp(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function ensureHashtags(content, hashtags, { maxTags = 3 } = {}) {
  const base = compactText(content);
  const tags = (Array.isArray(hashtags) ? hashtags : [])
    .map((tag) => String(tag || "").trim())
    .filter(Boolean)
    .filter((tag, index, array) => array.findIndex((item) => item.toLowerCase() === tag.toLowerCase()) === index)
    .slice(0, Math.max(0, Number(maxTags || 3)));
  if (!tags.length) return base;

  const missing = tags.filter((tag) => !new RegExp(`(^|\\s)${escapeRegExp(tag)}(?=\\s|$)`, "i").test(base));
  if (!missing.length) return base;
  return `${base}\n\n${missing.join(" ")}`;
}

export function contentHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

export function parseScheduleTime(value = "") {
  const text = String(value || "").trim();
  if (!text) return NaN;
  return Date.parse(text.replace(" ", "T"));
}

export function isWithinDuplicateWindow(first = "", second = "", hours = 48) {
  const a = parseScheduleTime(first);
  const b = parseScheduleTime(second);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= Math.max(1, Number(hours || 48)) * 3600000;
}

export function queuedItemAccountIds(item) {
  const rows = [
    ...(Array.isArray(item?.platformAnalytics) ? item.platformAnalytics : []),
    ...(Array.isArray(item?.platforms) ? item.platforms : []),
  ];
  return new Set(rows.map((row) => {
    const account = row?.accountId;
    if (account && typeof account === "object") {
      return String(account._id || account.id || account.accountId || "");
    }
    return String(account || "");
  }).filter(Boolean));
}

export function isTruthyOption(value) {
  if (value === true) return true;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  return false;
}

export function statusCodeFromError(error) {
  const status = Number(error?.statusCode || error?.status);
  return Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
}

export function safeErrorMessage(error) {
  return error?.message || String(error || "Unknown error");
}

export function retrySummaryFromError(error) {
  const retry = error?.zernioRetry;
  if (!retry) return null;
  return {
    attempts: retry.attempts,
    maxAttempts: retry.maxAttempts,
    retryable: retry.retryable,
    operation: retry.operation || null,
  };
}

export function retryWarningFromError(error) {
  const retry = retrySummaryFromError(error);
  if (!retry) return null;
  return `Zernio API retry attempts used: ${retry.attempts}/${retry.maxAttempts}${retry.operation ? ` (${retry.operation})` : ""}.`;
}

export function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on", "y"].includes(String(value).trim().toLowerCase());
}

export function positiveInteger(name, fallback, max = 10) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

export function delay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, Number(ms || 0)));
    timer.unref?.();
  });
}
