function normalise(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

export function extractAsyncStatusUrl(payload) {
  return normalise(payload?.statusUrl || payload?.job?.statusUrl) || null;
}

export function assessAsyncOperationPayload(payload) {
  const job = payload?.job && typeof payload.job === "object" ? payload.job : payload;
  const status = normalise(job?.status || payload?.status).toLowerCase();
  const result = job?.result ?? payload?.result ?? null;
  const resultFailed = Boolean(
    job?.ok === false
    || result?.ok === false
    || result?.failed === true
    || result?.quarantined === true
    || result?.partialFailure === true
    || result?.partial === true
  );

  if (["completed", "succeeded", "success"].includes(status)) {
    return { terminal: true, ok: !resultFailed, status, result };
  }

  if (["failed", "cancelled", "canceled", "quarantined", "completed-with-failures"].includes(status)) {
    return { terminal: true, ok: false, status, result };
  }

  if (["queued", "accepted", "running", "pending", "processing", "rendering", "scheduled"].includes(status)) {
    return { terminal: false, ok: null, status, result };
  }

  return { terminal: false, ok: null, status, result, unknown: true };
}

async function fetchStatus(url, { fetchImpl, headers, requestTimeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, Number(requestTimeoutMs || 60_000)));
  timer.unref?.();
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text.slice(0, 1000) }; }
    if (!response.ok) {
      const error = new Error(`Async operation status returned HTTP ${response.status}`);
      error.statusCode = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function retryablePollError(error, { elapsedMs = 0, notFoundGraceMs = 120_000 } = {}) {
  const status = Number(error?.statusCode || error?.status || 0);
  if (!status) return true;
  if (status === 404) return elapsedMs <= notFoundGraceMs;
  return [408, 409, 425, 429].includes(status) || status >= 500;
}

export async function waitForAsyncOperation({
  baseUrl,
  statusUrl,
  token,
  fetchImpl = fetch,
  pollIntervalMs = 15_000,
  timeoutMs = 6 * 60 * 60 * 1000,
  requestTimeoutMs = 60_000,
  maxConsecutiveErrors = 8,
  notFoundGraceMs = 120_000,
  onPoll = null,
} = {}) {
  const resolvedStatusUrl = new URL(statusUrl, `${normalise(baseUrl).replace(/\/+$/, "")}/`).toString();
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const startedAt = Date.now();
  const deadline = startedAt + Math.max(1_000, Number(timeoutMs || 0));
  const errorBudget = Math.max(1, Number(maxConsecutiveErrors || 1));
  let polls = 0;
  let pollErrors = 0;
  let consecutiveErrors = 0;

  while (Date.now() < deadline) {
    let payload;
    try {
      payload = await fetchStatus(resolvedStatusUrl, { fetchImpl, headers, requestTimeoutMs });
      consecutiveErrors = 0;
    } catch (error) {
      pollErrors += 1;
      consecutiveErrors += 1;
      const elapsedMs = Date.now() - startedAt;
      const retryable = retryablePollError(error, { elapsedMs, notFoundGraceMs });
      onPoll?.({
        polls,
        pollErrors,
        consecutiveErrors,
        statusUrl: resolvedStatusUrl,
        error,
        retryable,
      });
      if (!retryable || consecutiveErrors > errorBudget) {
        error.statusUrl = resolvedStatusUrl;
        error.pollErrors = pollErrors;
        error.consecutiveErrors = consecutiveErrors;
        throw error;
      }
      const backoff = Math.min(
        Math.max(500, Number(pollIntervalMs || 0)) * Math.max(1, consecutiveErrors),
        60_000,
      );
      await sleep(backoff);
      continue;
    }

    polls += 1;
    const assessment = assessAsyncOperationPayload(payload);
    onPoll?.({ polls, pollErrors, statusUrl: resolvedStatusUrl, payload, assessment });

    if (assessment.terminal) {
      return {
        ...assessment,
        polls,
        pollErrors,
        statusUrl: resolvedStatusUrl,
        payload,
      };
    }

    if (assessment.unknown) {
      const error = new Error("Async operation status response omitted a recognised job status");
      error.payload = payload;
      error.statusUrl = resolvedStatusUrl;
      throw error;
    }

    await sleep(pollIntervalMs);
  }

  const error = new Error(`Async operation exceeded ${timeoutMs}ms timeout`);
  error.code = "AIMS_OPERATION_ASYNC_TIMEOUT";
  error.statusUrl = resolvedStatusUrl;
  error.pollErrors = pollErrors;
  throw error;
}

export default {
  extractAsyncStatusUrl,
  assessAsyncOperationPayload,
  waitForAsyncOperation,
};
