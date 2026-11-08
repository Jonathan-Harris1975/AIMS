// Europe/London calendar guard shared by the monthly audit routes.
export function nthWeekdayGuard(req, res, { weekday, occurrence, error, hint }, now = new Date()) {
  const override = ["1", "true", "yes"].includes(String(req.body?.force || req.query?.force || "").toLowerCase());
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const actualWeekday = values.weekday;
  const dayOfMonth = Number(values.day);
  const actualOccurrence = Math.ceil(dayOfMonth / 7);
  if (!override && (actualWeekday !== weekday || actualOccurrence !== occurrence)) {
    res.status(409).json({ ok: false, error, weekday: actualWeekday, occurrence: actualOccurrence, hint });
    return false;
  }
  return true;
}

