import crypto from "node:crypto";
import { readJsonState, readJsonStateFresh, writeJsonState } from "../shared/utils/stateFile.js";

const STATE_FILE = "social-editorial-ledger.json";
const MAX_EVENTS = 260;
const MAX_RESERVATIONS = 180;
const DEFAULT_RESERVATION_TTL_HOURS = Number(process.env.SOCIAL_LEDGER_RESERVATION_TTL_HOURS || 72);
const DEFAULT_INTENT_LOOKBACK_DAYS = Number(process.env.SOCIAL_LEDGER_INTENT_LOOKBACK_DAYS || 7);

function nowMs() {
  return Date.now();
}

function isoNow() {
  return new Date().toISOString();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clean(value = "") {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseKey(value = "") {
  return clean(value)
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/www\./g, "")
    .replace(/\/$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shortHash(value = "") {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 14);
}

export function buildEditorialSourceKey(source = {}) {
  const link = clean(source.link || source.url || source.guid || "").replace(/\/$/, "").toLowerCase();
  const title = clean(source.title || source.headline || source.topic || "");
  return link || normaliseKey(title).slice(0, 180);
}

export function buildAudienceIntentKey(value = "") {
  return normaliseKey(value).slice(0, 120);
}

function emptyState() {
  return {
    schemaVersion: "2026-05-30.social-editorial-ledger",
    reservations: [],
    events: [],
  };
}

function normaliseState(raw) {
  const state = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : emptyState();
  return {
    schemaVersion: state.schemaVersion || "2026-05-30.social-editorial-ledger",
    reservations: asArray(state.reservations),
    events: asArray(state.events),
  };
}

function cleanExpiredReservations(reservations = [], atMs = nowMs()) {
  return asArray(reservations)
    .filter((entry) => entry && typeof entry.key === "string")
    .filter((entry) => Number(entry.expiresAtMs || 0) > atMs)
    .slice(-MAX_RESERVATIONS);
}

function normaliseEvent(input = {}) {
  const source = input.source || input.article || {};
  const sourceKey = input.sourceKey || buildEditorialSourceKey(source);
  const audienceIntent = clean(input.audienceIntent || input.intent || "");
  const audienceIntentKey = buildAudienceIntentKey(audienceIntent);
  const angle = clean(input.angle || input.topic || input.title || "");
  const pipeline = clean(input.pipeline || input.service || "social");
  const lane = clean(input.lane || input.channel || "general");
  const text = clean(input.text || input.content || input.caption || "");
  const scheduledDateTime = clean(input.scheduledDateTime || input.publishDate || input.publishedAt || "");
  const createdAt = input.createdAt || isoNow();

  return {
    id: input.id || shortHash([pipeline, lane, sourceKey, audienceIntentKey, angle, scheduledDateTime, createdAt].join("|")),
    pipeline,
    lane,
    sourceKey: sourceKey || null,
    sourceTitle: clean(source.title || input.sourceTitle || "") || null,
    sourceLink: clean(source.link || source.url || input.sourceLink || "") || null,
    audienceIntent: audienceIntent || null,
    audienceIntentKey: audienceIntentKey || null,
    angle: angle || null,
    topic: clean(input.topic || "") || null,
    platform: clean(input.platform || input.platforms || "") || null,
    scheduledDateTime: scheduledDateTime || null,
    textHash: text ? shortHash(text) : null,
    createdAt,
    meta: input.meta && typeof input.meta === "object" ? input.meta : {},
  };
}

export function readEditorialLedger() {
  return normaliseState(readJsonState(STATE_FILE, emptyState()));
}

export async function readEditorialLedgerFresh() {
  return normaliseState(await readJsonStateFresh(STATE_FILE, emptyState()));
}

export function writeEditorialLedger(state) {
  return writeJsonState(STATE_FILE, normaliseState(state));
}

export function recordEditorialEvent(input = {}) {
  const state = readEditorialLedger();
  const event = normaliseEvent(input);
  state.events = [
    ...asArray(state.events).filter((entry) => entry?.id !== event.id),
    event,
  ].slice(-MAX_EVENTS);
  writeEditorialLedger(state);
  return event;
}

export function hasRecentAudienceIntent(audienceIntent = "", { days = DEFAULT_INTENT_LOOKBACK_DAYS, excludePipeline = "" } = {}) {
  const key = buildAudienceIntentKey(audienceIntent);
  if (!key) return false;
  const cutoff = nowMs() - Number(days || DEFAULT_INTENT_LOOKBACK_DAYS) * 86400000;
  const state = readEditorialLedger();
  return asArray(state.events).some((event) => {
    if (excludePipeline && event.pipeline === excludePipeline) return false;
    if (event.audienceIntentKey !== key) return false;
    const created = Date.parse(event.createdAt || "");
    return Number.isFinite(created) ? created >= cutoff : true;
  });
}

export function hasRecentEditorialSource(source = {}, { days = DEFAULT_INTENT_LOOKBACK_DAYS } = {}) {
  const key = buildEditorialSourceKey(source);
  if (!key) return false;
  const cutoff = nowMs() - Number(days || DEFAULT_INTENT_LOOKBACK_DAYS) * 86400000;
  const state = readEditorialLedger();
  return asArray(state.events).some((event) => {
    if (event.sourceKey !== key) return false;
    const created = Date.parse(event.createdAt || "");
    return Number.isFinite(created) ? created >= cutoff : true;
  }) || cleanExpiredReservations(state.reservations).some((entry) => entry.key === key);
}

export async function reserveEditorialSource(input = {}) {
  const source = input.source || input.article || input;
  const key = input.sourceKey || buildEditorialSourceKey(source);
  if (!key) {
    return { reserved: false, skipped: true, reason: "no-source-key", reservation: null };
  }

  const at = nowMs();
  const state = await readEditorialLedgerFresh();
  const reservations = cleanExpiredReservations(state.reservations, at);
  const existing = reservations.find((entry) => entry.key === key);
  if (existing) {
    state.reservations = reservations;
    writeEditorialLedger(state);
    return {
      reserved: false,
      duplicatePrevented: true,
      reason: "source-already-reserved",
      reservation: existing,
    };
  }

  const ttlHours = Math.max(1, Number(input.ttlHours || DEFAULT_RESERVATION_TTL_HOURS));
  const reservation = {
    id: input.id || shortHash([key, input.pipeline, input.lane, at].join("|")),
    key,
    pipeline: clean(input.pipeline || input.service || "social"),
    lane: clean(input.lane || input.channel || "general"),
    audienceIntent: clean(input.audienceIntent || input.intent || "") || null,
    audienceIntentKey: buildAudienceIntentKey(input.audienceIntent || input.intent || "") || null,
    angle: clean(input.angle || input.topic || "") || null,
    sourceTitle: clean(source.title || source.headline || input.sourceTitle || "") || null,
    sourceLink: clean(source.link || source.url || input.sourceLink || "") || null,
    scheduledDateTime: clean(input.scheduledDateTime || input.publishDate || "") || null,
    state: "reserved",
    createdAt: new Date(at).toISOString(),
    expiresAtMs: at + ttlHours * 60 * 60 * 1000,
  };

  state.reservations = [...reservations, reservation].slice(-MAX_RESERVATIONS);
  writeEditorialLedger(state);
  return { reserved: true, duplicatePrevented: false, reservation };
}

export function completeEditorialReservation(reservation, eventInput = {}) {
  if (!reservation?.key && !reservation?.id) return null;
  const state = readEditorialLedger();
  state.reservations = cleanExpiredReservations(state.reservations).filter((entry) => {
    if (reservation.id && entry.id === reservation.id) return false;
    if (reservation.key && entry.key === reservation.key) return false;
    return true;
  });
  const event = normaliseEvent({
    pipeline: reservation.pipeline,
    lane: reservation.lane,
    audienceIntent: reservation.audienceIntent,
    source: {
      title: reservation.sourceTitle,
      link: reservation.sourceLink,
    },
    sourceKey: reservation.key,
    angle: reservation.angle,
    scheduledDateTime: reservation.scheduledDateTime,
    ...eventInput,
  });
  state.events = [...asArray(state.events).filter((entry) => entry?.id !== event.id), event].slice(-MAX_EVENTS);
  writeEditorialLedger(state);
  return event;
}

export function releaseEditorialReservation(reservation) {
  if (!reservation?.key && !reservation?.id) return false;
  const state = readEditorialLedger();
  const before = asArray(state.reservations).length;
  state.reservations = cleanExpiredReservations(state.reservations).filter((entry) => {
    if (reservation.id && entry.id === reservation.id) return false;
    if (reservation.key && entry.key === reservation.key) return false;
    return true;
  });
  writeEditorialLedger(state);
  return state.reservations.length !== before;
}

export function buildIntentHash(input = {}) {
  const sourceKey = input.sourceKey || buildEditorialSourceKey(input.source || input.article || {});
  const intentKey = buildAudienceIntentKey(input.audienceIntent || input.intent || "");
  const angle = normaliseKey(input.angle || input.topic || input.title || "");
  return shortHash([sourceKey, intentKey, angle].filter(Boolean).join("|"));
}

/**
 * Gap 4 — Cross-lane daily source lock.
 *
 * Returns true if the given source article has already been used by ANY lane
 * today (UTC calendar day). This prevents two different lanes on the same day
 * from picking adjacent articles on the same shared feed and covering the same
 * story from different angles — which would undermine lane differentiation
 * without triggering the existing per-session dedup check.
 *
 * The check uses the same sourceKey logic as hasRecentEditorialSource but
 * restricts the lookback window to the current UTC calendar day rather than
 * the configured intent lookback period.
 */
export function hasBeenUsedCrossLaneToday(source = {}) {
  const key = buildEditorialSourceKey(source);
  if (!key) return false;

  // Start of today in UTC (midnight)
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const cutoffMs = todayStart.getTime();

  const state = readEditorialLedger();

  // Check committed events for today
  const inEvents = asArray(state.events).some((event) => {
    if (event.sourceKey !== key) return false;
    const created = Date.parse(event.createdAt || "");
    return Number.isFinite(created) && created >= cutoffMs;
  });
  if (inEvents) return true;

  // Check active (non-expired) reservations — any lane may have reserved it
  const activeReservations = cleanExpiredReservations(state.reservations);
  return activeReservations.some((entry) => entry.key === key);
}
