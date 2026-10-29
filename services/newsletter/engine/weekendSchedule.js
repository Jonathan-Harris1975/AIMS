export const WEEKEND_TIMES = Object.freeze({ saturday: '17:10', sunday: '05:10' });
export const CUTOFF_TIMES = Object.freeze({ saturday: '17:55', sunday: '05:55' });
const DAY_MS = 86400000;
export function londonDate(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function londonInstant(day, time) {
  const target = new Date(`${day}T${time}:00Z`).getTime();
  let instant = target;
  for (let i = 0; i < 3; i += 1) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(instant)).map(p => [p.type, p.value]));
    const local = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`);
    instant += target - local;
  }
  return new Date(instant).toISOString();
}
export function weekendPlan(now = new Date()) {
  const friday = londonDate(now);
  const anchor = new Date(`${friday}T12:00:00Z`);
  if (anchor.getUTCDay() !== 5) throw new Error('Weekend editions must be prepared on Friday (Europe/London).');
  return ['saturday', 'sunday'].map((edition, index) => {
    const date = new Date(anchor.getTime() + (index + 1) * DAY_MS).toISOString().slice(0, 10);
    return { edition, date, preparedOn: friday, sessionId: `NL-ai-edge-${edition}-${date}`,
      scheduledAt: londonInstant(date, WEEKEND_TIMES[edition]), cutoffAt: londonInstant(date, CUTOFF_TIMES[edition]) };
  });
}
