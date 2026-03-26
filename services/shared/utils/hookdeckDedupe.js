const seenEvents = new Map();
const DEFAULT_TTL_MS = Number(process.env.HOOKDECK_DEDUPE_TTL_MS) || 6 * 60 * 60 * 1000;

function cleanupExpired(now = Date.now()) {
  for (const [key, expiresAt] of seenEvents.entries()) {
    if (expiresAt <= now) {
      seenEvents.delete(key);
    }
  }
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
    return { eventId: null, isDuplicate: false };
  }

  const key = `${scope}:${eventId}`;
  if (seenEvents.has(key)) {
    return { eventId, isDuplicate: true };
  }

  seenEvents.set(key, Date.now() + DEFAULT_TTL_MS);
  return { eventId, isDuplicate: false };
}

export function hookdeckDedupe(scope) {
  return (req, res, next) => {
    const { eventId, isDuplicate } = claimHookdeckEvent(req, scope);

    if (eventId) {
      req.hookdeckEventId = eventId;
    }

    if (isDuplicate) {
      return res.status(202).json({
        ok: true,
        duplicate: true,
        eventId,
        message: "Duplicate Hookdeck delivery ignored",
      });
    }

    return next();
  };
}
