import { createHash } from 'node:crypto';

const FORMATTERS = new Map();

function formatter(timeZone) {
  if (!FORMATTERS.has(timeZone)) {
    FORMATTERS.set(timeZone, new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    }));
  }
  return FORMATTERS.get(timeZone);
}

function zonedParts(value, timeZone = 'Europe/London') {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('A valid date is required.');
  const parts = Object.fromEntries(
    formatter(timeZone).formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function localDateDayOfWeek({ year, month, day }) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function localDatePlusDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function utcOffsetMs(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  const representedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const actual = Math.floor(date.getTime() / 1000) * 1000;
  return representedUtc - actual;
}

export function localDateTimeToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone = 'Europe/London') {
  const localUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidate = localUtc;
  for (let i = 0; i < 4; i += 1) {
    const offset = utcOffsetMs(new Date(candidate), timeZone);
    const corrected = localUtc - offset;
    if (Math.abs(corrected - candidate) < 1000) return new Date(corrected);
    candidate = corrected;
  }
  return new Date(candidate);
}

function stableNumber(seed, salt = '') {
  const digest = createHash('sha256').update(`${seed}:${salt}`).digest();
  return digest.readUInt32BE(0);
}

export function isWeekday(value, timeZone = 'Europe/London') {
  const parts = zonedParts(value, timeZone);
  const day = localDateDayOfWeek(parts);
  return day >= 1 && day <= 5;
}

export function isWithinBusinessHours(value = new Date(), {
  timeZone = 'Europe/London', startHour = 9, endHour = 17,
} = {}) {
  const parts = zonedParts(value, timeZone);
  const weekday = localDateDayOfWeek(parts);
  if (weekday === 0 || weekday === 6) return false;
  const minute = parts.hour * 60 + parts.minute;
  return minute >= startHour * 60 && minute < endHour * 60;
}

export function nextBusinessOpening(value = new Date(), {
  timeZone = 'Europe/London', startHour = 9, endHour = 17,
} = {}) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = zonedParts(date, timeZone);
  const minute = parts.hour * 60 + parts.minute;
  const weekday = localDateDayOfWeek(parts);
  if (weekday >= 1 && weekday <= 5 && minute < startHour * 60) {
    return localDateTimeToUtc({ ...parts, hour: startHour, minute: 0, second: 0 }, timeZone);
  }
  if (weekday >= 1 && weekday <= 5 && minute >= startHour * 60 && minute < endHour * 60) return date;

  let local = { year: parts.year, month: parts.month, day: parts.day };
  do { local = localDatePlusDays(local, 1); } while ([0, 6].includes(localDateDayOfWeek(local)));
  return localDateTimeToUtc({ ...local, hour: startHour, minute: 0, second: 0 }, timeZone);
}

function rollLocalDateToWeekday(localDate) {
  let current = { ...localDate };
  while ([0, 6].includes(localDateDayOfWeek(current))) current = localDatePlusDays(current, 1);
  return current;
}

export function delayedBusinessReplyAt({
  receivedAt,
  seed,
  timeZone = 'Europe/London',
  startHour = 9,
  endHour = 17,
  minimumDays = 2,
  maximumDays = 3,
} = {}) {
  const received = receivedAt instanceof Date ? receivedAt : new Date(receivedAt || Date.now());
  if (!Number.isFinite(received.getTime())) throw new TypeError('receivedAt must be a valid date.');
  const minimum = Math.max(1, Number(minimumDays) || 2);
  const maximum = Math.max(minimum, Number(maximumDays) || minimum);
  const span = maximum - minimum + 1;
  const delayDays = minimum + (stableNumber(seed || received.toISOString(), 'days') % span);
  const origin = zonedParts(received, timeZone);
  const rawTargetDate = localDatePlusDays({ year: origin.year, month: origin.month, day: origin.day }, delayDays);
  const targetDate = rollLocalDateToWeekday(rawTargetDate);
  const windowMinutes = Math.max(1, (endHour - startHour) * 60);
  const minuteOffset = stableNumber(seed || received.toISOString(), 'time') % windowMinutes;
  const hour = startHour + Math.floor(minuteOffset / 60);
  const minute = minuteOffset % 60;
  return localDateTimeToUtc({ ...targetDate, hour, minute, second: 0 }, timeZone);
}


export function ensureFutureBusinessTime(target, {
  timeZone = 'Europe/London', startHour = 9, endHour = 17,
} = {}, nowValue = new Date()) {
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  const candidate = target instanceof Date ? target : new Date(target);
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(candidate.getTime())) throw new TypeError('Valid dates are required.');
  if (candidate.getTime() > now.getTime() + 30_000) return candidate;
  if (isWithinBusinessHours(now, { timeZone, startHour, endHour })) {
    const soon = new Date(now.getTime() + 60_000);
    if (isWithinBusinessHours(soon, { timeZone, startHour, endHour })) return soon;
  }
  return nextBusinessOpening(now, { timeZone, startHour, endHour });
}

export function businessHoursPolicy(config = {}) {
  return Object.freeze({
    timeZone: config.businessTimeZone || 'Europe/London',
    startHour: Number(config.businessStartHour ?? 9),
    endHour: Number(config.businessEndHour ?? 17),
  });
}

export function conversationFirstInboundAt(conversation) {
  const inbound = (conversation?.messages || []).filter((message) => message?.direction !== 'outbound');
  return inbound[0]?.received_at || inbound[0]?.receivedAt || conversation?.created_at || conversation?.createdAt || new Date().toISOString();
}

export function hasOutboundMessages(conversation) {
  return (conversation?.messages || []).some((message) => message?.direction === 'outbound');
}
