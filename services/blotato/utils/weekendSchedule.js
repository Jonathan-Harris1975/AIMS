// Prepare both weekend video slots on Friday, never after the intended
// publication day has arrived. Publication timing remains the provider's job.
export const WEEKEND_VIDEO_LANES = Object.freeze({
  saturday: "weekend-debate",
  sunday: "weekend-spotlight",
});
export const WEEKEND_VIDEO_SLOTS = Object.freeze(["am", "pm"]);

export function weekendVideoPreparation({ day, slot, now = new Date() } = {}) {
  const targetDay = String(day || "").trim().toLowerCase();
  const targetSlot = String(slot || "").trim().toLowerCase();
  if (!(targetDay in WEEKEND_VIDEO_LANES) || !WEEKEND_VIDEO_SLOTS.includes(targetSlot)) {
    const error = new Error("Weekend Blotato preparation requires saturday/sunday and am/pm.");
    error.statusCode = 400;
    error.code = "blotato-weekend-slot-invalid";
    throw error;
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Invalid preparation clock.");
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const friday = new Date(`${date}T12:00:00Z`);
  if (friday.getUTCDay() !== 5) {
    const error = new Error("Weekend videos must be prepared on Friday, ahead of their publishing slots.");
    error.statusCode = 409;
    error.code = "blotato-weekend-preparation-day";
    throw error;
  }
  const publishDate = new Date(friday.getTime() + (targetDay === "saturday" ? 1 : 2) * 86_400_000)
    .toISOString().slice(0, 10);
  return {
    lane: WEEKEND_VIDEO_LANES[targetDay],
    day: targetDay,
    slot: targetSlot,
    publishDate,
    preparedOn: date,
  };
}
