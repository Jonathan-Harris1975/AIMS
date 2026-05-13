import { readJsonState, writeJsonState } from "./stateFile.js";

const STATE_FILE = "hookdeck-dedupe.json";
const DEFAULT_TTL_MS = Number(process.env.HOOKDECK_DEDUPE_TTL_MS) || 6 * 60 * 60 * 1000;

function loadSeenEvents() {
  const persisted = readJsonState(STATE_FILE, { entries: [] });
  const entries = Array.isArray(persisted?.entries) ? persisted.entries : [];

  return new Map(
    entries
      .filter((entry) => entry && typeof entry.key === "string")
      .map((entry) => [
        entry.key,
        {
          state: entry.state === "completed" ? "completed" : "pending",
          expiresAt: Number(entry.expiresAt) || 0,
        },
      ])
  );
}

const seenEvents = loadSeenEvents();

function persistSeenEvents() {
  const entries = [...seenEvents.entries()].map(([key, value]) => ({
    key,
    state: value?.state === "completed" ? "completed" : "pending",
    expiresAt: Number(value?.expiresAt) || 0,
  }));

  writeJsonState(STATE_FILE, { entries });
}

function cleanupExpired(now = Date.now()) {
  let changed = false;

  for (const [key, record] of seenEvents.entries()) {
    if (!record?.expiresAt || record.expiresAt <= now) {
      seenEvents.delete(key);
      changed = true;
    }
  }

  if (changed) {
    persistSeenEvents();
  }
}

function makeRecord(state, ttlMs = DEFAULT_TTL_MS) {
  return {
    state,
    expiresAt: Date.now() + ttlMs,
  };
}

function makeKey(scope, eventId) {
  return `${scope}:${eventId}`;
}

export function getHookdeckEventId(req) {
  const raw =
    req.get?.("x-hookdeck-eventid") ||
    req.get?.("x-hookdeck-event-id") ||
    req.headers?.["x-hookdeck-eventid"] ||
    req.headers?.["x-hookdeck-event-id"];

  if (typeof raw !== "string") return null;
  const eventId = raw.trim();
  return eventId || null;
}

export function claimHookdeckEvent(req, scope = "global") {
  cleanupExpired();

  const eventId = getHookdeckEventId(req);
  if (!eventId) {
    return { eventId: null, isDuplicate: false, key: null, state: null };
  }

  const key = makeKey(scope, eventId);
  const existing = seenEvents.get(key);
  if (existing) {
    return {
      eventId,
      key,
      isDuplicate: true,
      state: existing.state,
    };
  }

  seenEvents.set(key, makeRecord("pending"));
  persistSeenEvents();

  return {
    eventId,
    key,
    isDuplicate: false,
    state: "pending",
  };
}

export function completeHookdeckEvent(scope, eventId) {
  if (!eventId) return;
  const key = makeKey(scope, eventId);
  if (!seenEvents.has(key)) return;
  seenEvents.set(key, makeRecord("completed"));
  persistSeenEvents();
}

export function releaseHookdeckEvent(scope, eventId) {
  if (!eventId) return;
  const key = makeKey(scope, eventId);
  if (!seenEvents.delete(key)) return;
  persistSeenEvents();
}

export function hookdeckDedupe(scope) {
  return (req, res, next) => {
    const { eventId, isDuplicate, state } = claimHookdeckEvent(req, scope);

    if (eventId) {
      req.hookdeckEventId = eventId;
    }

    if (isDuplicate) {
      return res.status(202).json({
        ok: true,
        duplicate: true,
        eventId,
        state,
        message: "Duplicate Hookdeck delivery ignored",
      });
    }

    if (!eventId) {
      return next();
    }

    let settled = false;

    const finalize = () => {
      if (settled) return;
      settled = true;

      if (res.statusCode >= 400) {
        releaseHookdeckEvent(scope, eventId);
      } else {
        completeHookdeckEvent(scope, eventId);
      }
    };

    const onClose = () => {
      if (settled) return;
      settled = true;
      releaseHookdeckEvent(scope, eventId);
    };

    res.once("finish", finalize);
    res.once("close", onClose);

    return next();
  };
}
