export function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

export function json(value) {
  return JSON.stringify(value ?? null);
}

export function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function text(value, maximum = 10_000) {
  return String(value ?? "").trim().slice(0, maximum);
}

export function nowIso() {
  return new Date().toISOString();
}

export function placeholders(count) {
  return Array.from({ length: count }, () => "?").join(",");
}
