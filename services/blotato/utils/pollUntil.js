function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  maxDurationMs = Number.POSITIVE_INFINITY,
  now = Date.now,
  wait = sleep,
  onPending,
  onWaiting,
}) {
  let latest = null;
  let latestPendingError = null;
  const startedAt = now();
  const hasDurationLimit = Number.isFinite(maxDurationMs) && maxDurationMs > 0;

  const elapsedMs = () => Math.max(0, now() - startedAt);
  const durationError = () => {
    const elapsed = elapsedMs();
    const err = new Error(`${label} did not complete before ${maxDurationMs}ms polling duration limit`);
    err.statusCode = 504;
    err.code = "blotato-poll-duration-exceeded";
    err.details = latest || latestPendingError?.details || null;
    err.polling = { elapsedMs: elapsed, maxDurationMs, maxAttempts, intervalMs };
    if (latestPendingError) err.cause = latestPendingError;
    return err;
  };

  const ensureWithinDuration = () => {
    if (hasDurationLimit && elapsedMs() >= maxDurationMs) throw durationError();
  };

  const waitForNextPoll = async (requestedMs) => {
    if (!hasDurationLimit) {
      await wait(requestedMs);
      return;
    }

    const remainingMs = maxDurationMs - elapsedMs();
    if (remainingMs <= 0) throw durationError();
    await wait(Math.min(requestedMs, remainingMs));
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    ensureWithinDuration();
    try {
      latest = await run();
      latestPendingError = null;
    } catch (error) {
      if (!isPendingError?.(error)) throw error;
      latestPendingError = error;
      latest = error?.details || null;
      if (progressEvery > 0 && attempt % progressEvery === 0) {
        onPending?.({
          label,
          attempt,
          maxAttempts,
          error,
          elapsedMs: elapsedMs(),
          maxDurationMs: hasDurationLimit ? maxDurationMs : null,
        });
      }
      await waitForNextPoll(intervalMs);
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
      onWaiting?.({
        label,
        attempt,
        maxAttempts,
        status: status || "unknown",
        elapsedMs: elapsedMs(),
        maxDurationMs: hasDurationLimit ? maxDurationMs : null,
      });
    }
    await waitForNextPoll(intervalMs);
  }

  if (finalGraceMs > 0) {
    ensureWithinDuration();
    await waitForNextPoll(finalGraceMs);
    ensureWithinDuration();
    try {
      latest = await run();
      latestPendingError = null;
    } catch (error) {
      if (!isPendingError?.(error)) throw error;
      latestPendingError = error;
      latest = error?.details || latest;
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

  const err = new Error(`${label} did not complete before polling limit`);
  err.statusCode = 504;
  err.details = latest || latestPendingError?.details || null;
  if (latestPendingError) err.cause = latestPendingError;
  throw err;
}

export default { pollUntil };
