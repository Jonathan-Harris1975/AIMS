const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const TOKEN_PATTERN = /\b(?:bearer\s+)?[A-Za-z0-9_-]{24,}\b/gi;
const PHONE_PATTERN = /(?<!\w)(?:\+?\d[\d\s().-]{7,}\d)(?!\w)/g;

export function redactDiagnosticText(value) {
  return String(value ?? "")
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(PHONE_PATTERN, "[redacted-phone]")
    .replace(TOKEN_PATTERN, "[redacted-token]")
    .slice(0, 1000);
}

export function safeErrorLog(error) {
  return {
    name: String(error?.name || "Error").slice(0, 100),
    code: String(error?.code || "unknown").slice(0, 120),
    statusCode: Number(error?.statusCode || error?.status || 0) || null,
    retryable: Boolean(error?.retryable),
    failureClass: error?.failureClass || null,
    message: redactDiagnosticText(error?.message || error),
  };
}
