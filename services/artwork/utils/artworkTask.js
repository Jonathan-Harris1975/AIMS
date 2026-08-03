export async function runArtworkTask(task, timeoutMs, label = "Artwork generation") {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    const error = new Error(`${label} timed out after ${timeoutMs}ms`);
    error.code = "ARTWORK_TASK_TIMEOUT";
    controller.abort(error);
  }, Math.max(1_000, Number(timeoutMs || 0)));
  timeout.unref?.();

  try {
    return await task(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw controller.signal.reason instanceof Error
        ? controller.signal.reason
        : new Error(`${label} aborted`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export default { runArtworkTask };
