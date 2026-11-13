// Exact, Friday-only preparation of four weekend Blotato publication slots.
const WEEKEND_LANES = Object.freeze({
  saturday: Object.freeze({ am: "news-insight", pm: "model-verdict" }),
  sunday: Object.freeze({ am: "ai-at-work", pm: "reality-check" }),
});

export function fridayWeekendBlotatoPlan(day, slot, now = new Date()) {
  if (!Object.hasOwn(WEEKEND_LANES, day) || !Object.hasOwn(WEEKEND_LANES[day], slot)) return null;
  const calendar = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit",
    day: "2-digit", weekday: "long",
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  if (calendar.weekday?.toLowerCase() !== "friday") return null;
  const date = new Date(Date.UTC(Number(calendar.year), Number(calendar.month) - 1,
    Number(calendar.day) + (day === "saturday" ? 1 : 2), 12));
  return {
    laneSlug: WEEKEND_LANES[day][slot],
    scheduleSlot: slot,
    scheduleDate: date.toISOString().slice(0, 10),
    publishMode: slot === "am" ? "autoshorts-scheduled" : "evening-scheduled",
  };
}
