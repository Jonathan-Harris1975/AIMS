function formatter(timeZone, options) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, ...options });
}

function zonedOffsetMs(date, timeZone) {
  const parts = formatter(timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const renderedAsUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return renderedAsUtc - date.getTime();
}

export function isValidTimeZone(value) {
  try {
    formatter(String(value || ""), { year: "numeric" }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function zonedDateTimeToUtcIso(value, timeZone) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  // Preserve timestamps which already carry an explicit zone/offset.
  if (/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const date = new Date(raw);
    return Number.isNaN(date.valueOf()) ? null : date.toISOString();
  }

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match || !isValidTimeZone(timeZone)) return null;

  const localAsUtc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] || 0),
  );
  let candidate = new Date(localAsUtc);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    candidate = new Date(localAsUtc - zonedOffsetMs(candidate, timeZone));
  }
  return candidate.toISOString();
}
