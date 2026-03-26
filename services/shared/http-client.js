import fetch from "node-fetch";

export function withTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

export async function fetchWithTimeout(url, options = {}) {
  const { timeout = 15000, signal: upstreamSignal, ...rest } = options;
  const { signal, clear } = withTimeoutSignal(timeout);

  const abortHandler = () => {
    try {
      signal.throwIfAborted?.();
    } catch {}
  };

  if (upstreamSignal?.addEventListener) {
    upstreamSignal.addEventListener("abort", abortHandler, { once: true });
  }

  try {
    const response = await fetch(url, {
      ...rest,
      signal: upstreamSignal || signal,
    });
    return response;
  } catch (err) {
    const aborted = err?.name === "AbortError" || err?.code === "ABORT_ERR";
    if (aborted) {
      throw new Error(`Request timed out after ${timeout}ms: ${url}`);
    }
    throw err;
  } finally {
    clear();
    if (upstreamSignal?.removeEventListener) {
      upstreamSignal.removeEventListener("abort", abortHandler);
    }
  }
}

export async function fetchTextSafe(url, options = {}) {
  try {
    const resp = await fetchWithTimeout(url, options);
    const text = await resp.text();
    return { ok: resp.ok, status: resp.status, text };
  } catch (err) {
    return { ok: false, status: 0, text: null, error: err.message };
  }
}
