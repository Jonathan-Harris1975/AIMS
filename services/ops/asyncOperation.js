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

export async function waitForAsyncOperation({
  baseUrl,
  statusUrl,
  token,
  fetchImpl = fetch,
  pollIntervalMs = 15_000,
  timeoutMs = 6 * 60 * 60 * 1000,
  requestTimeoutMs = 60_000,
  onPoll = null,
} = {}) {
  const resolvedStatusUrl = new URL(statusUrl, `${normalise(baseUrl).replace(/\/+$/, "")}/`).toString();
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const deadline = Date.now() + Math.max(1_000, Number(timeoutMs || 0));
  let polls = 0;

  while (Date.now() < deadline) {
    const payload = await fetchStatus(resolvedStatusUrl, { fetchImpl, headers, requestTimeoutMs });
    polls += 1;
    const assessment = assessAsyncOperationPayload(payload);
    onPoll?.({ polls, statusUrl: resolvedStatusUrl, payload, assessment });

    if (assessment.terminal) {
      return {
        ...assessment,
        polls,
        statusUrl: resolvedStatusUrl,
        payload,
      };
    }

    if (assessment.unknown) {
      const error = new Error("Async operation status response omitted a recognised job status");
      error.payload = payload;
      throw error;
    }

    await sleep(pollIntervalMs);
  }

  const error = new Error(`Async operation exceeded ${timeoutMs}ms timeout`);
  error.code = "AIMS_OPERATION_ASYNC_TIMEOUT";
  error.statusUrl = resolvedStatusUrl;
  throw error;
}

export default {
  extractAsyncStatusUrl,
  assessAsyncOperationPayload,
  waitForAsyncOperation,
};
