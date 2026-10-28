import { createHash } from "node:crypto";

// Process-local, bounded, short-lived reuse. No source text or pixels are keys.
export function qaFingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function createValidatedResultCache({ ttlMs = 600_000, maxEntries = 128, now = Date.now } = {}) {
  const entries = new Map();
  return {
    get(key) {
      const item = entries.get(key);
      if (!item) return null;
      if (now() - item.at >= ttlMs) { entries.delete(key); return null; }
      return structuredClone(item.result);
    },
    put(key, result) {
      // Failure and infrastructure-fallback verdicts must never become approvals.
      if (result?.pass !== true || result?.skipped === true) return;
      entries.delete(key);
      entries.set(key, { at: now(), result: structuredClone(result) });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    },
  };
}

export const visualQaCache = createValidatedResultCache();
