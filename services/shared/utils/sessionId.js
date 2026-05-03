// services/shared/utils/sessionId.js

export function sanitizeSessionId(value, prefix = "TT") {
  const fallback = prefix ? `${prefix}-${Date.now()}` : `${Date.now()}`;
  const raw = (value ?? fallback).toString().trim();

  const cleaned = raw
    .replace(/[\/]+/g, "-")
    .replace(/\.\.+/g, "-")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 80);

  if (!cleaned) return fallback;

  if (!prefix) return cleaned;
  if (cleaned.startsWith(`${prefix}-`) || cleaned.startsWith(`${prefix}_`)) {
    return cleaned;
  }

  return `${prefix}-${cleaned}`.slice(0, 80);
}

export default sanitizeSessionId;
