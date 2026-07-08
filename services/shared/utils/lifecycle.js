/**
 * Service lifecycle state model for AIMS.
 *
 * AIMS cannot know it is about to be paused (Koyeb suspends the instance outright), so
 * "standby" is authoritatively tracked by MAST, the actor that pauses/resumes AIMS via
 * the Koyeb API. This module only owns the states AIMS *can* observe about itself while
 * its process is actually running: starting (boot grace period), online (idle and
 * ready), busy (requests in flight above a small threshold), and maintenance
 * (operator/MAST-toggled).
 */

export const VALID_STATES = ["starting", "online", "busy", "standby", "offline", "maintenance"];

const STARTUP_GRACE_MS = Number(process.env.AIMS_STARTUP_GRACE_MS || 20_000);
const BUSY_CONCURRENCY_THRESHOLD = Number(process.env.AIMS_BUSY_CONCURRENCY_THRESHOLD || 4);

const processStartedAt = Date.now();
let inFlightRequests = 0;

const current = {
  state: "starting",
  since: new Date().toISOString(),
  reason: "process-boot",
};

const maintenance = { on: false, reason: null, since: null };

function set(value, reason) {
  if (current.state === value) return;
  current.state = value;
  current.since = new Date().toISOString();
  current.reason = reason;
}

export function requestStarted() {
  inFlightRequests += 1;
}

export function requestFinished() {
  inFlightRequests = Math.max(0, inFlightRequests - 1);
}

export function enterMaintenance(reason = "operator-requested") {
  maintenance.on = true;
  maintenance.reason = reason;
  maintenance.since = new Date().toISOString();
  set("maintenance", reason);
  return snapshot();
}

export function exitMaintenance(reason = "operator-cleared") {
  maintenance.on = false;
  maintenance.reason = null;
  maintenance.since = null;
  set("starting", reason);
  return snapshot();
}

export function isInMaintenance() {
  return Boolean(maintenance.on);
}

/**
 * Recompute the lifecycle snapshot from live signals. Should be called by health/status
 * routes (cheap) rather than on every request, since it also updates the ledger.
 */
export function computeState({ dependenciesReady = true } = {}) {
  let value;
  if (maintenance.on) {
    value = "maintenance";
  } else if (inFlightRequests >= BUSY_CONCURRENCY_THRESHOLD) {
    value = "busy";
  } else if (!dependenciesReady) {
    value = "starting";
  } else if (Date.now() - processStartedAt < STARTUP_GRACE_MS) {
    value = "starting";
  } else {
    value = "online";
  }

  const reason = {
    maintenance: maintenance.reason || "operator-requested",
    busy: "request-concurrency-threshold-exceeded",
    starting: !dependenciesReady ? "dependencies-not-ready" : "startup-grace-period",
    online: "ready",
  }[value];

  set(value, reason);
  return snapshot();
}

export function snapshot() {
  return {
    state: current.state,
    since: current.since,
    reason: current.reason,
    uptimeSeconds: Math.round((Date.now() - processStartedAt) / 1000),
    inFlightRequests,
    maintenance: { ...maintenance },
  };
}
