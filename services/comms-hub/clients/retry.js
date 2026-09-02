export function retryableStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
}

export function retryableError(error) {
  // Provider clients make a more informed retry decision than a translated
  // HTTP status can. Honour that explicit decision before applying generic
  // status/message heuristics (for example, a permanent D1 quota error may be
  // exposed to callers as a 502/503 but must not be replayed).
  if (typeof error?.retryable === "boolean") return error.retryable;
  const status = Number(error?.statusCode || error?.status || 0);
  if (retryableStatus(status)) return true;
  const haystack = `${error?.name || ""} ${error?.code || ""} ${error?.message || error || ""}`.toLowerCase();
  return /abort|timeout|timed out|temporar|throttl|rate|busy|unavailable|network|socket|reset|econnreset|etimedout|eai_again/.test(haystack);
}

export async function withRetry(operation, { attempts = 4, baseMs = 500, maxMs = 8000, onRetry = null } = {}) {
  let lastError;
  const maxAttempts = Math.max(1, Number(attempts) || 1);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !retryableError(error)) throw error;
      const delayMs = Math.min(maxMs, baseMs * (2 ** (attempt - 1))) + Math.floor(Math.random() * 150);
      await onRetry?.({ attempt, maxAttempts, delayMs, error });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
