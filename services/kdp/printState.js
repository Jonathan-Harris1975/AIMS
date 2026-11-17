// Durable print-edition state and independently metered KDP weekly creation /
// first-submission reservations. D1 conditional updates are the quota authority;
// an interrupted remote KDP write remains uncertain, never silently reissued.
import { queryKdpD1 } from "./catalogue.js";
import { PRINT_KDP_WEEKLY_LIMIT_PER_FORMAT } from "./printPreflight.js";

const FORMAT = new Set(["paperback", "hardcover"]);
const STATES = new Set(["queued", "assets_ready", "creating", "draft", "submitting",
  "submitted", "uncertain", "blocked", "live_verified"]);
const ACTIVE = new Set(["creating", "submitting", "uncertain"]);

export function utcPrintWeek(at = new Date()) {
  if (!(at instanceof Date) || !Number.isFinite(+at)) throw new TypeError("Invalid UTC week.");
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() - at.getUTCDay()));
  return d.toISOString().slice(0, 10);
}

/** D1 datetime('now') is UTC but omits the ISO 8601 Z suffix. */
export function parsePrintDatabaseTime(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    return Date.parse(raw.replace(" ", "T") + "Z");
  }
  return Date.parse(raw);
}

export function canAttemptPrintJob(job, at = new Date()) {
  if (!job) return true;
  if (["creating", "submitting", "uncertain", "submitted", "live_verified"].includes(job.state)) return false;
  if (job.state !== "blocked") return true;
  // A broken source or AI questionnaire may be repaired externally. Retry
  // periodically without letting that book occupy every night's two slots.
  const blockedAt = parsePrintDatabaseTime(job.updatedAt);
  return Number.isFinite(blockedAt) && (+at - blockedAt >= 48 * 60 * 60_000);
}

export function requirePrintFormat(format) {
  if (!FORMAT.has(format)) throw new TypeError("Print format must be paperback or hardcover.");
}

let readyPromise;
export async function ensurePrintStateTables() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    // Mirror the existing website-backed print-editions migration for new
    // environments, preserving its live_verified identity constraints.
    await queryKdpD1("CREATE TABLE IF NOT EXISTS kdp_print_editions (" +
      "ebook_id INTEGER NOT NULL REFERENCES ebooks(ebook_id)," +
      "format TEXT NOT NULL CHECK(format IN ('paperback','hardcover'))," +
      "state TEXT NOT NULL DEFAULT 'prepared' CHECK(state IN (" +
      "'prepared','qa_passed','draft','submitted','uncertain','blocked','live_verified','unavailable'))," +
      "isbn TEXT,print_asin TEXT,purchase_url TEXT,verified_at TEXT," +
      "updated_at TEXT NOT NULL DEFAULT (datetime('now'))," +
      "PRIMARY KEY(ebook_id,format)," +
      "CHECK(state <> 'live_verified' OR " +
      "(isbn IS NOT NULL AND print_asin IS NOT NULL AND purchase_url IS NOT NULL AND verified_at IS NOT NULL)))");
    await queryKdpD1("CREATE TABLE IF NOT EXISTS kdp_print_automation (" +
      "ebook_id INTEGER NOT NULL, format TEXT NOT NULL CHECK(format IN ('paperback','hardcover'))," +
      "state TEXT NOT NULL DEFAULT 'queued', title_id TEXT, manifest_key TEXT," +
      "isbn TEXT, error_code TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))," +
      "updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(ebook_id,format))");
    await queryKdpD1("CREATE TABLE IF NOT EXISTS kdp_print_quota_counters (" +
      "week_utc TEXT NOT NULL, format TEXT NOT NULL CHECK(format IN ('paperback','hardcover'))," +
      "action TEXT NOT NULL CHECK(action IN ('create','submit'))," +
      "reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved BETWEEN 0 AND 2)," +
      "PRIMARY KEY(week_utc,format,action))");
    // The legacy counter carries a 0..2 CHECK which SQLite cannot relax in
    // place. Keep it intact, create a 0..10 ledger and import earlier claims.
    // Never reset or overwrite v2 reservations on subsequent worker starts.
    await queryKdpD1("CREATE TABLE IF NOT EXISTS kdp_print_quota_counters_v2 (" +
      "week_utc TEXT NOT NULL, format TEXT NOT NULL CHECK(format IN ('paperback','hardcover'))," +
      "action TEXT NOT NULL CHECK(action IN ('create','submit'))," +
      "reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved BETWEEN 0 AND 10)," +
      "PRIMARY KEY(week_utc,format,action))");
    await queryKdpD1("INSERT OR IGNORE INTO kdp_print_quota_counters_v2" +
      " (week_utc,format,action,reserved)" +
      " SELECT week_utc,format,action,reserved FROM kdp_print_quota_counters");
    await queryKdpD1("CREATE TABLE IF NOT EXISTS kdp_print_quota_events (" +
      "week_utc TEXT NOT NULL, format TEXT NOT NULL CHECK(format IN ('paperback','hardcover'))," +
      "action TEXT NOT NULL CHECK(action IN ('create','submit'))," +
      "ebook_id INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'reserved'," +
      "created_at TEXT NOT NULL DEFAULT (datetime('now'))," +
      "updated_at TEXT NOT NULL DEFAULT (datetime('now'))," +
      "PRIMARY KEY(week_utc,format,action,ebook_id))");
  })().catch(error => { readyPromise = undefined; throw error; });
  return readyPromise;
}

export async function getPrintJob(ebookId, format) {
  requirePrintFormat(format);
  await ensurePrintStateTables();
  const r = await queryKdpD1(
    "SELECT * FROM kdp_print_automation WHERE ebook_id = ? AND format = ? LIMIT 1",
    [ebookId, format],
  );
  const row = r.results?.[0];
  return row ? {
    ebookId: Number(row.ebook_id), format: row.format, state: row.state,
    titleId: row.title_id || null, manifestKey: row.manifest_key || null,
    isbn: row.isbn || null, errorCode: row.error_code || null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  } : null;
}

export async function savePrintJob(ebookId, format, updates = {}) {
  requirePrintFormat(format);
  if (!Number.isSafeInteger(Number(ebookId)) || Number(ebookId) < 1) throw new TypeError("Invalid ebook ID.");
  if (!STATES.has(updates.state)) throw new TypeError("Unrecognised print job state.");
  await ensurePrintStateTables();
  const prior = await getPrintJob(ebookId, format);
  if (prior && ACTIVE.has(prior.state) && updates.state !== prior.state &&
      updates.state !== "uncertain" && updates.state !== "draft" && updates.state !== "submitted") {
    throw new Error("Uncertain KDP remote operation must be reconciled before changing state.");
  }
  if (prior?.state === "live_verified" && updates.state !== "live_verified") {
    throw new Error("Verified print listing cannot be downgraded by the rollout worker.");
  }
  const titleId = updates.titleId === undefined ? prior?.titleId || null : updates.titleId;
  if (prior?.titleId && titleId !== prior.titleId) throw new Error("Cannot replace a known KDP title ID.");
  const manifestKey = updates.manifestKey === undefined ? prior?.manifestKey || null : updates.manifestKey;
  const isbn = updates.isbn === undefined ? prior?.isbn || null : updates.isbn;
  const err = updates.errorCode || null;
  await queryKdpD1("INSERT INTO kdp_print_automation (ebook_id,format,state,title_id,manifest_key,isbn,error_code)" +
    " VALUES (?,?,?,?,?,?,?) ON CONFLICT(ebook_id,format) DO UPDATE SET" +
    " state=excluded.state,title_id=excluded.title_id,manifest_key=excluded.manifest_key," +
    " isbn=excluded.isbn,error_code=excluded.error_code,updated_at=datetime('now')",
    [ebookId, format, updates.state, titleId, manifestKey, isbn, err]);
  return getPrintJob(ebookId, format);
}

export async function reservePrintQuota(ebookId, format, action, { week = utcPrintWeek(), limit = PRINT_KDP_WEEKLY_LIMIT_PER_FORMAT } = {}) {
  requirePrintFormat(format);
  if (!["create", "submit"].includes(action) || !/^\d{4}-\d{2}-\d{2}$/.test(week) ||
      !Number.isInteger(limit) || limit < 1 || limit > PRINT_KDP_WEEKLY_LIMIT_PER_FORMAT) throw new TypeError("Invalid KDP print quota reservation.");
  await ensurePrintStateTables();
  // Claim the unique edition+format+week event FIRST. If two workers race
  // for the same title, only one can proceed to increment the counter.
  const event = await queryKdpD1("INSERT OR IGNORE INTO kdp_print_quota_events" +
    " (week_utc,format,action,ebook_id) VALUES (?,?,?,?)", [week,format,action,ebookId]);
  if (Number(event.meta?.changes) !== 1) return { reserved: false, reason: "already_reserved" };
  // Crash between event claim and counter increment burns this edition slot
  // conservatively; it never authorises an additional KDP write.
  await queryKdpD1("INSERT OR IGNORE INTO kdp_print_quota_counters_v2" +
    " (week_utc,format,action,reserved) VALUES (?,?,?,0)", [week,format,action]);
  const update = await queryKdpD1("UPDATE kdp_print_quota_counters_v2 SET reserved=reserved+1" +
    " WHERE week_utc=? AND format=? AND action=? AND reserved<?", [week,format,action,limit]);
  if (Number(update.meta?.changes) !== 1) {
    await markPrintQuota(ebookId,format,action,"blocked",week);
    return { reserved: false, reason: "weekly_quota_exhausted" };
  }
  return { reserved: true, week, action, format };
}

export async function getPrintQuotaUsage(week = utcPrintWeek()) {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(week)) throw new TypeError("Invalid print quota week.");
  await ensurePrintStateTables();
  const response = await queryKdpD1(
    "SELECT format,action,reserved FROM kdp_print_quota_counters_v2 WHERE week_utc=?", [week]);
  const perFormat = {
    paperback: { create: 0, submit: 0 },
    hardcover: { create: 0, submit: 0 },
  };
  for (const row of response.results || []) {
    requirePrintFormat(row.format);
    if (!["create","submit"].includes(row.action)) throw new Error("Unrecognised print quota action.");
    perFormat[row.format][row.action] = Number(row.reserved);
  }
  return { weekUtc: week, weeklyLimitPerFormat: PRINT_KDP_WEEKLY_LIMIT_PER_FORMAT, perFormat };
}

export async function markPrintQuota(ebookId, format, action, state, week = utcPrintWeek()) {
  requirePrintFormat(format);
  if (!["create","submit"].includes(action) ||
      !["done","uncertain","blocked"].includes(state)) throw new TypeError("Invalid KDP print quota event.");
  await ensurePrintStateTables();
  await queryKdpD1("UPDATE kdp_print_quota_events SET state=?,updated_at=datetime('now')" +
    " WHERE week_utc=? AND format=? AND action=? AND ebook_id=?",
    [state,week,format,action,ebookId]);
}

export async function writePrintEditionState(ebookId, format, state, isbn = null) {
  requirePrintFormat(format);
  await ensurePrintStateTables();
  if (!["qa_passed","draft","submitted","uncertain","blocked"].includes(state)) {
    throw new TypeError("Only independently verified public listings may be marked live_verified.");
  }
  await queryKdpD1("INSERT INTO kdp_print_editions (ebook_id,format,state,isbn) VALUES (?,?,?,?)" +
    " ON CONFLICT(ebook_id,format) DO UPDATE SET state=excluded.state," +
    " isbn=COALESCE(excluded.isbn,kdp_print_editions.isbn), updated_at=datetime('now')" +
    " WHERE kdp_print_editions.state <> 'live_verified'", [ebookId,format,state,isbn]);
}

export async function listKnownPrintJobs() {
  await ensurePrintStateTables();
  const result = await queryKdpD1("SELECT ebook_id, format, title_id FROM kdp_print_automation WHERE title_id IS NOT NULL");
  return (result.results || []).map(row => ({
    ebookId: Number(row.ebook_id), format: String(row.format), titleId: String(row.title_id),
  }));
}

/** Unknown remote KDP outcomes must be reconciled against signed-in Bookshelf
 * state before allowing any additional creation or first submission. */
export async function listPrintJobsForReconciliation() {
  await ensurePrintStateTables();
  const response = await queryKdpD1(
    "SELECT ebook_id,format,state,title_id,manifest_key,isbn,error_code,created_at,updated_at" +
    " FROM kdp_print_automation WHERE state IN ('creating','submitting','uncertain')" +
    " ORDER BY updated_at ASC,ebook_id ASC,format ASC"
  );
  return (response.results || []).map(row => ({
    ebookId: Number(row.ebook_id), format: String(row.format), state: String(row.state),
    titleId: row.title_id || null, manifestKey: row.manifest_key || null,
    isbn: row.isbn || null, errorCode: row.error_code || null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }));
}
