import { localDateTimeToUtc } from "../../comms-hub/domain/businessHours.js";

export const OUTREACH_TIME_ZONE = "Europe/London";
export const OUTREACH_AUTHORISED_WEEKDAYS = Object.freeze(["monday", "wednesday", "friday"]);
export const OUTREACH_SESSION_START_MINUTE = 9 * 60;
export const OUTREACH_SESSION_WINDOW_MINUTES = 120;

const WEEKDAYS = Object.freeze(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]);

function localDatePlusDays({ year, month, day }, days) {
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function londonParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: OUTREACH_TIME_ZONE,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(formatter.formatToParts(new Date(date)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    weekday: String(values.weekday || "").toLowerCase(),
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

export function isAuthorisedOutreachSession(date = new Date(), { windowMinutes = OUTREACH_SESSION_WINDOW_MINUTES } = {}) {
  const parts = londonParts(date);
  const minuteOfDay = parts.hour * 60 + parts.minute;
  return OUTREACH_AUTHORISED_WEEKDAYS.includes(parts.weekday)
    && minuteOfDay >= OUTREACH_SESSION_START_MINUTE
    && minuteOfDay < OUTREACH_SESSION_START_MINUTE + Number(windowMinutes);
}

export function nextAuthorisedOutreachSession(date = new Date()) {
  const current = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(current.getTime())) throw new TypeError("A valid date is required.");
  const parts = londonParts(current);
  const currentMinute = parts.hour * 60 + parts.minute;

  for (let offset = 0; offset <= 7; offset += 1) {
    const local = localDatePlusDays({ year: Number(parts.date.slice(0, 4)), month: Number(parts.date.slice(5, 7)), day: Number(parts.date.slice(8, 10)) }, offset);
    const weekday = WEEKDAYS[new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay()];
    if (!OUTREACH_AUTHORISED_WEEKDAYS.includes(weekday)) continue;
    if (offset === 0 && currentMinute < OUTREACH_SESSION_START_MINUTE) {
      return localDateTimeToUtc({ ...local, hour: 9, minute: 0, second: 0 }, OUTREACH_TIME_ZONE);
    }
    if (offset === 0 && currentMinute < OUTREACH_SESSION_START_MINUTE + OUTREACH_SESSION_WINDOW_MINUTES) return current;
    if (offset === 0) continue;
    return localDateTimeToUtc({ ...local, hour: 9, minute: 0, second: 0 }, OUTREACH_TIME_ZONE);
  }
  throw new Error("Unable to calculate the next authorised outreach session.");
}
