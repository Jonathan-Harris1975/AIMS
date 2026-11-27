import { createHash } from "node:crypto";

export const MODES = Object.freeze(["disabled", "assessment", "controlled_test", "pilot", "suspended"]);
export const RUBRIC_VERSION = "book-feature-v1";
const WEIGHTS = Object.freeze({ depth: 25, positiveContext: 20, mutualBenefit: 20, currentRelevance: 15, audienceAlignment: 10, relationshipPotential: 10 });

export function effectiveMode(configured, persisted) {
  // Environment kill switch always takes precedence over durable configuration.
  if (configured === "disabled" || configured === "suspended") return configured;
  if (!MODES.includes(persisted)) return "assessment";
  return persisted;
}

export function isoWeek(date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const year = day.getUTCFullYear();
  const first = new Date(Date.UTC(year, 0, 1));
  return `${year}-W${String(Math.ceil((((day - first) / 86400000) + 1) / 7)).padStart(2, "0")}`;
}

export function londonOccurrence(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  if (!Number.isFinite(date.getTime()) || !["Tue", "Thu"].includes(parts.weekday) || parts.hour !== "09" || parts.minute !== "00") return null;
  return { id: `book-feature:${localDate}`, day: parts.weekday, localDate, week: isoWeek(new Date(`${localDate}T12:00:00Z`)) };
}

export function scheduledLondonOccurrence(date, catchUpMinutes = 120) {
  if (!Number.isFinite(date.getTime()) || !Number.isInteger(catchUpMinutes) || catchUpMinutes < 0 || catchUpMinutes > 120) return null;
  const format = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", year: "numeric",
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = Object.fromEntries(format.formatToParts(date).map(({ type, value }) => [type, value]));
  const minuteOfDay = Number(parts.hour) * 60 + Number(parts.minute);
  if (!["Tue", "Thu"].includes(parts.weekday) || minuteOfDay < 540 || minuteOfDay > 540 + catchUpMinutes) return null;
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  return { id: `book-feature:${localDate}`, day: parts.weekday, localDate,
    week: isoWeek(new Date(`${localDate}T12:00:00Z`)) };
}

export function selectSample(books, seed, count = 3) {
  const eligible = books.filter((book) => Number.isSafeInteger(book.ebookId) && book.ebookId > 0 &&
    book.storageBucket === "kdp" && /^Manuscripts pdf format\/.+\.pdf$/i.test(book.manuscriptR2Key) && book.publicationDate);
  const ids = [...new Set(eligible.map((book) => book.ebookId))].sort((a, b) => a - b);
  if (ids.length < count) throw new Error(`Only ${ids.length} eligible published manuscripts; ${count} required.`);
  const selected = ids.map((id) => ({ id, order: createHash("sha256").update(`${seed}:${id}`).digest("hex") }))
    .sort((a, b) => a.order.localeCompare(b.order)).slice(0, count).map(({ id }) => id);
  return { seed, population: ids, selected, exclusions: books.length - ids.length };
}

export function verifyBook(featured, book) {
  if (!book || !featured?.title || !book.title ||
      featured.title.trim().toLocaleLowerCase() !== book.title.trim().toLocaleLowerCase()) {
    throw new Error("Featured title does not uniquely match the KDP catalogue.");
  }
  if (book.storageBucket !== "kdp" || !/^Manuscripts pdf format\/.+\.pdf$/i.test(book.manuscriptR2Key)) throw new Error("Catalogue manuscript reference is not a private KDP PDF.");
  const publishedAt = Date.parse(book.publicationDate || "");
  if (!Number.isFinite(publishedAt) || publishedAt > Date.now() || !book.bookUrl) {
    throw new Error("Published metadata or canonical link is missing or not yet live.");
  }
  const alignmentStatus = String(book.titleAlignmentStatus || "").trim().toLowerCase();
  if (alignmentStatus && alignmentStatus !== "aligned") {
    const observedTitle = String(book.manuscriptTitleObserved || "").normalize("NFKC").trim().toLowerCase();
    const canonicalTitle = book.title.normalize("NFKC").trim().toLowerCase();
    const documentedCaseDrift = alignmentStatus === "minor punctuation/casing drift; workbook retained as canonical" &&
      observedTitle === canonicalTitle;
    if (!documentedCaseDrift) throw new Error("Catalogue manuscript title alignment is unresolved.");
  }
  if (book.manuscriptTitleObserved &&
      book.manuscriptTitleObserved.trim().toLowerCase() !== book.title.trim().toLowerCase()) {
    throw new Error("Observed manuscript title conflicts with catalogue title.");
  }
  if (featured.bookUrl && featured.bookUrl !== book.bookUrl && featured.bookUrl !== book.buyNowUrl && featured.bookUrl !== book.redirectUrl) throw new Error("Featured URL conflicts with catalogue.");
  return book;
}

export function matchedPassage(pageText, passage) {
  const normalise = (text) => String(text).normalize("NFKC").replace(/[\u00ad\u2010-\u2015]/g, "-").replace(/\s+/g, " ").trim();
  const source = normalise(pageText);
  const quote = normalise(passage);
  return quote.length >= 20 && source.includes(quote);
}

export function scoreOpportunity(components, gates) {
  const points = Object.entries(WEIGHTS).map(([name, maximum]) => {
    const value = components?.[name];
    if (!Number.isInteger(value) || value < 0 || value > maximum) throw new Error(`Invalid ${name} score.`);
    return value;
  });
  const score = points.reduce((a, b) => a + b, 0);
  const required = ["evidence", "identity", "contact", "lawfulBasis", "suppression", "duplicate", "qa", "campaign", "authorisation"];
  const commonGatesPass = required.every((key) => gates?.[key] === true);
  const conditional = score >= 55 && score < 70;
  const eligible = (score >= 70 && commonGatesPass) ||
    (conditional && commonGatesPass && gates?.enhancedValidation === true);
  const failedGates = required.filter((key) => gates?.[key] !== true);
  if (conditional && gates?.enhancedValidation !== true) failedGates.push("enhancedValidation");
  return { score, rubric: RUBRIC_VERSION, tier: score >= 85 ? "priority" : score >= 70 ? "strong" : score >= 55 ? "conditional" : "exclude",
    eligible, failedGates };
}
