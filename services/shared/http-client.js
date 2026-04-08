import fetch from "node-fetch";

export function withTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("request timed out")), timeoutMs);
  timer.unref?.();

  return {
    controller,
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

export async function fetchWithTimeout(url, options = {}) {
  const { timeout = 15000, signal: upstreamSignal, ...rest } = options;
  const { controller, signal, clear } = withTimeoutSignal(timeout);

  const abortHandler = () => {
    if (!signal.aborted) {
      controller.abort(upstreamSignal?.reason || new Error("request aborted"));
    }
  };

  if (upstreamSignal?.aborted) {
    abortHandler();
  } else if (upstreamSignal?.addEventListener) {
    upstreamSignal.addEventListener("abort", abortHandler, { once: true });
  }

  try {
    const response = await fetch(url, {
      ...rest,
      signal,
    });
    return response;
  } catch (err) {
    const aborted = err?.name === "AbortError" || err?.code === "ABORT_ERR";
    if (aborted) {
      if (upstreamSignal?.aborted) {
        throw upstreamSignal.reason instanceof Error
          ? upstreamSignal.reason
          : new Error(`Request aborted: ${url}`);
      }
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
