function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function latestIso(rows, field) {
  let latest = null;
  let latestMs = -Infinity;
  for (const row of rows) {
    const value = iso(row?.[field]);
    if (!value) continue;
    const ms = Date.parse(value);
    if (ms > latestMs) {
      latest = value;
      latestMs = ms;
    }
  }
  return latest;
}

export function heartbeatThresholds(pollIntervalMs) {
  const poll = Math.max(30_000, Number(pollIntervalMs) || 30_000);
  return {
    degradedAfterMs: Math.max(poll * 2, poll + 60_000),
    staleAfterMs: Math.max(poll * 3, poll + 120_000),
  };
}

export function evaluateWorkerHeartbeat({ descriptor, rows = [], now = new Date() }) {
  const enabled = descriptor.enabled === true;
  const thresholds = heartbeatThresholds(descriptor.pollIntervalMs);
  if (!enabled) {
    return {
      category: descriptor.category,
      key: descriptor.key,
      enabled: false,
      status: "disabled",
      freshness: "disabled",
      pollIntervalMs: descriptor.pollIntervalMs,
      ...thresholds,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      ageMs: null,
      instancesSeen: 0,
    };
  }

  const lastAttemptAt = latestIso(rows, "last_attempt_at");
  const lastSuccessAt = latestIso(rows, "last_success_at");
  const lastFailureAt = latestIso(rows, "last_failure_at");
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const successMs = lastSuccessAt ? Date.parse(lastSuccessAt) : NaN;
  const ageMs = Number.isFinite(nowMs) && Number.isFinite(successMs) ? Math.max(0, nowMs - successMs) : null;

  let status = "stale";
  let freshness = "missing";
  if (ageMs !== null) {
    if (ageMs <= thresholds.degradedAfterMs) {
      status = "healthy";
      freshness = "fresh";
    } else if (ageMs <= thresholds.staleAfterMs) {
      status = "degraded";
      freshness = "aging";
    } else {
      status = "stale";
      freshness = "stale";
    }
  }

  return {
    category: descriptor.category,
    key: descriptor.key,
    enabled: true,
    status,
    freshness,
    pollIntervalMs: descriptor.pollIntervalMs,
    ...thresholds,
    lastAttemptAt,
    lastSuccessAt,
    lastFailureAt,
    ageMs,
    instancesSeen: new Set(rows.map((row) => row.instance_id).filter(Boolean)).size,
  };
}

export function workerRunAdvanced(result) {
  if (!result?.skipped) return true;
  if (!result.reason) return false;
  return !["already_running", "stopping"].includes(result.reason);
}

export function buildWorkerHeartbeatHealth({ descriptors, rows, now = new Date() }) {
  const workers = descriptors.map((descriptor) => evaluateWorkerHeartbeat({
    descriptor,
    rows: rows.filter((row) => row.worker_category === descriptor.category && row.worker_key === descriptor.key),
    now,
  }));
  const enabled = workers.filter((worker) => worker.enabled);
  const overall = enabled.some((worker) => worker.status === "stale")
    ? "stale"
    : enabled.some((worker) => worker.status === "degraded")
      ? "degraded"
      : "healthy";
  return {
    overall,
    checkedAt: iso(now),
    enabledWorkers: enabled.length,
    workers,
  };
}
