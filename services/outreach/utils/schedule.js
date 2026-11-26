export const OUTREACH_TIME_ZONE = "Europe/London";
export const OUTREACH_AUTHORISED_WEEKDAYS = Object.freeze(["monday", "wednesday", "friday"]);
export const OUTREACH_SESSION_START_MINUTE = 9 * 60;
export const OUTREACH_SESSION_WINDOW_MINUTES = 120;

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

