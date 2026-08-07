function defaultWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPollingError(message, code, {
  latest = null,
  latestPendingError = null,
  startedAt = 0,
  now = Date.now,
  maxDurationMs = 0,
  attempts = 0,
  maxAttempts = 0,
  consecutivePendingErrors = 0,
} = {}) {
  const err = new Error(message);
  err.statusCode = 504;
  err.code = code;
  err.details = latest || latestPendingError?.details || null;
  if (latestPendingError) err.cause = latestPendingError;
  err.polling = {
    attempts,
    maxAttempts,
    elapsedMs: Math.max(0, now() - startedAt),
    maxDurationMs: Math.max(0, Number(maxDurationMs) || 0),
    consecutivePendingErrors,
  };
  return err;
}

export async function pollUntil({
  label,
  run,
  isDone,
  isDonePayload,
  isFailed,
  isPendingError,
  extractStatus,
  maxAttempts,
  intervalMs,
  progressEvery = 30,
  finalGraceMs = 0,
  maxDurationMs = 0,
  maxConsecutivePendingErrors = Number.POSITIVE_INFINITY,
  now = Date.now,
  wait = defaultWait,
  onProgress,
} = {}) {
  const safeMaxAttempts = Math.max(1, Number(maxAttempts) || 1);
  const safeIntervalMs = Math.max(0, Number(intervalMs) || 0);
  const safeMaxDurationMs = Math.max(0, Number(maxDurationMs) || 0);
  const pendingLimitValue = Number(maxConsecutivePendingErrors);
  const safePendingLimit = Number.isFinite(pendingLimitValue)
    ? Math.max(1, pendingLimitValue)
    : Number.POSITIVE_INFINITY;
  const startedAt = now();
  let latest = null;
  let latestPendingError = null;
  let consecutivePendingErrors = 0;
  let attemptsUsed = 0;

  const throwIfDurationExceeded = () => {
    const elapsedMs = Math.max(0, now() - startedAt);
    if (safeMaxDurationMs > 0 && elapsedMs >= safeMaxDurationMs) {
      throw buildPollingError(`${label} exceeded the polling wall-clock limit`, "blotato-poll-duration-exceeded", {
        latest,
        latestPendingError,
        startedAt,
        now,
        maxDurationMs: safeMaxDurationMs,
        attempts: attemptsUsed,
        maxAttempts: safeMaxAttempts,
        consecutivePendingErrors,
      });
    }
  };

  for (let attempt = 1; attempt <= safeMaxAttempts; attempt += 1) {
    throwIfDurationExceeded();
    attemptsUsed = attempt;
    try {
      latest = await run();
      latestPendingError = null;
      consecutivePendingErrors = 0;
    } catch (error) {
      if (!isPendingError?.(error)) throw error;
      latestPendingError = error;
      latest = error?.details || latest;
      consecutivePendingErrors += 1;

      if (progressEvery > 0 && attempt % progressEvery === 0) {
        onProgress?.("provider_pending", {
          label,
          attempt,
          maxAttempts: safeMaxAttempts,
          statusCode: error?.statusCode || null,
          message: String(error?.message || "").trim().slice(0, 500),
        });
      }

      if (consecutivePendingErrors >= safePendingLimit) {
        throw buildPollingError(`${label} exceeded the consecutive provider-pending error limit`, "blotato-poll-provider-error-limit", {
          latest,
          latestPendingError,
          startedAt,
          now,
          maxDurationMs: safeMaxDurationMs,
          attempts: attemptsUsed,
          maxAttempts: safeMaxAttempts,
          consecutivePendingErrors,
        });
      }

      await wait(safeIntervalMs);
      continue;
    }

    const status = extractStatus(latest);
    if (isDone(status) || isDonePayload?.(latest, status)) return latest;
    if (isFailed(status)) {
      const err = new Error(`${label} failed with status: ${status || "unknown"}`);
      err.statusCode = 502;
      err.details = latest;
      throw err;
    }
    if (progressEvery > 0 && attempt % progressEvery === 0) {
      onProgress?.("still_waiting", { label, attempt, maxAttempts: safeMaxAttempts, status: status || "unknown" });
    }
    await wait(safeIntervalMs);
  }

  throwIfDurationExceeded();

  if (finalGraceMs > 0) {
    const elapsed = Math.max(0, now() - startedAt);
    const remaining = safeMaxDurationMs > 0 ? Math.max(0, safeMaxDurationMs - elapsed) : finalGraceMs;
    const grace = Math.min(Math.max(0, Number(finalGraceMs) || 0), remaining);
    if (grace > 0) await wait(grace);
    throwIfDurationExceeded();

    try {
      latest = await run();
      latestPendingError = null;
      consecutivePendingErrors = 0;
    } catch (error) {
      if (!isPendingError?.(error)) throw error;
      latestPendingError = error;
      latest = error?.details || latest;
      consecutivePendingErrors += 1;
    }
    const status = extractStatus(latest || {});
    if (isDone(status) || isDonePayload?.(latest, status)) return latest;
    if (isFailed(status)) {
      const err = new Error(`${label} failed with status: ${status || "unknown"}`);
      err.statusCode = 502;
      err.details = latest;
      throw err;
    }
  }

  throw buildPollingError(`${label} did not complete before polling limit`, "blotato-poll-attempt-limit", {
    latest,
    latestPendingError,
    startedAt,
    now,
    maxDurationMs: safeMaxDurationMs,
    attempts: attemptsUsed,
    maxAttempts: safeMaxAttempts,
    consecutivePendingErrors,
  });
}

export default { pollUntil };
