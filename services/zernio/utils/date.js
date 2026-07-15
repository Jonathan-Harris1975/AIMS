const WEEKDAY_TO_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function getFormatter(timeZone, options) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, ...options });
}

export function getWeekdayIndex(dayName) {
  const key = String(dayName || "").trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(WEEKDAY_TO_INDEX, key)) {
    throw new Error(`Unknown weekday '${dayName}'`);
  }
  return WEEKDAY_TO_INDEX[key];
}

export function zonedDateParts(date = new Date(), timeZone = "Europe/London") {
  const parts = getFormatter(timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    weekdayName: String(map.weekday || "").toLowerCase(),
  };
}

export function zonedDateString(date = new Date(), timeZone = "Europe/London") {
  const parts = zonedDateParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function nextWeekdayDateString(targetWeekday, timeZone = "Europe/London", fromDate = new Date()) {
  const targetIndex = getWeekdayIndex(targetWeekday);

  for (let offset = 0; offset <= 14; offset += 1) {
    const probe = new Date(fromDate.getTime() + offset * 86400000);
    const parts = zonedDateParts(probe, timeZone);
    const currentIndex = getWeekdayIndex(parts.weekdayName);
    if (currentIndex === targetIndex) {
      return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
    }
  }

  throw new Error(`Could not resolve next ${targetWeekday} for timezone ${timeZone}`);
}

export function addDays(dateString, days) {
  const match = String(dateString || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid date '${dateString}'. Expected YYYY-MM-DD.`);
  }

  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  utc.setUTCDate(utc.getUTCDate() + Number(days || 0));
  return utc.toISOString().slice(0, 10);
}

export function toScheduledDateTime(dateString, timeString) {
  if (!/^(\d{4})-(\d{2})-(\d{2})$/.test(String(dateString || ""))) {
    throw new Error(`Invalid publish date '${dateString}'. Expected YYYY-MM-DD.`);
  }
  if (!/^\d{2}:\d{2}$/.test(String(timeString || ""))) {
    throw new Error(`Invalid publish time '${timeString}'. Expected HH:MM.`);
  }
  return `${dateString} ${timeString}`;
}
