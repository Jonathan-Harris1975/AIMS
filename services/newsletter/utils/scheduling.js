// services/newsletter/utils/scheduling.js
//
// Computes the intended send timestamp for a newsletter issue in the
// profile's configured local timezone (default Europe/London), using
// Intl.DateTimeFormat rather than a fixed UTC offset so BST/GMT transitions
// are handled automatically. Actual triggering is owned by MAST (a separate
// repository); this module only decides *what time* an issue should be
// marked for, for inclusion in metadata / the pending-campaign packet.

import { THRESHOLDS } from "../../../config/thresholds.js";

/**
 * Returns the UTC offset (in minutes) for a given IANA timezone at a given
 * instant, derived from Intl so DST is handled correctly without a
 * timezone-database dependency.
 */
function tzOffsetMinutes(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  return (asUtc - date.getTime()) / 60000;
}

/**
 * Returns the next occurrence (as a UTC Date) of the configured local send
 * time on or after `from`. If `from` is already past today's send time, the
 * result rolls to the next day.
 */
export function nextSendTimeUtc({
  from = new Date(),
  timeZone = THRESHOLDS.newsletter.sendTimeZone,
  hourLocal = THRESHOLDS.newsletter.sendHourLocal,
  minuteLocal = THRESHOLDS.newsletter.sendMinuteLocal,
} = {}) {
  // Build a naive UTC guess for "today at hourLocal:minuteLocal in timeZone",
  // then correct using the timezone's actual offset at that instant.
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(from).map((p) => [p.type, p.value]));
  const naiveUtcGuess = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hourLocal, minuteLocal, 0));
  const offsetMinutes = tzOffsetMinutes(naiveUtcGuess, timeZone);
  let candidate = new Date(naiveUtcGuess.getTime() - offsetMinutes * 60000);

  if (candidate <= from) {
    candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
    const correctedOffset = tzOffsetMinutes(candidate, timeZone);
    candidate = new Date(candidate.getTime() - (correctedOffset - offsetMinutes) * 60000);
  }

  return candidate;
}

export default { nextSendTimeUtc };
