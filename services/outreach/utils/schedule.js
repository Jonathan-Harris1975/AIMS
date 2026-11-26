export const OUTREACH_TIME_ZONE = "Europe/London";
export const OUTREACH_AUTHORISED_WEEKDAYS = Object.freeze(["monday", "wednesday", "friday"]);
export const OUTREACH_SESSION_START_MINUTE = 9 * 60;
export const OUTREACH_SESSION_WINDOW_MINUTES = 120;
const LONDON_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: OUTREACH_TIME_ZONE,
  weekday: "long",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function londonParts(date = new Date()) {
  const values = Object.fromEntries(LONDON_FORMATTER.formatToParts(new Date(date)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
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
  const original = new Date(date);
  for (let day = 0; day <= 8; day += 1) {
    const anchor = new Date(original.getTime() + day * 24 * 60 * 60_000);
    const anchorParts = londonParts(anchor);
    const [year, month, calendarDay] = anchorParts.date.split("-").map(Number);
    const roughCandidate = new Date(Date.UTC(year, month - 1, calendarDay, 9, 0));
    const roughParts = londonParts(roughCandidate);
    const offsetMinutes = (roughParts.hour - 9) * 60 + roughParts.minute;
    const candidate = new Date(roughCandidate.getTime() - offsetMinutes * 60_000);
    const candidateParts = londonParts(candidate);
    if (candidate > original
      && OUTREACH_AUTHORISED_WEEKDAYS.includes(candidateParts.weekday)
      && candidateParts.hour * 60 + candidateParts.minute === OUTREACH_SESSION_START_MINUTE) {
      return candidate;
    }
  }
  throw new Error("Unable to calculate the next authorised outreach session");
}

