// Serialise paid audit synthesis in this process. Other services and replicas
// still share OpenRouter's account allowance, so only its explicit temporary
// in-flight refusal gets one delayed retry. Credit shortages are not retried.
export function isAuditInFlightRefusal(error) {
  return Number(error?.status) === 402 &&
    [error?.message, error?.bodySnippet].some(value => String(value || "").includes("in_flight_budget_exhausted"));
}

export function createAuditCapacityQueue() {
  let tail = Promise.resolve();
  return function queued(work, { wait, signal } = {}) {
    const task = tail.then(async () => {
      if (signal?.aborted) throw signal.reason || new Error("Audit request aborted");
      try { return await work(); }
      catch (error) {
        if (!isAuditInFlightRefusal(error)) throw error;
        const advertised = Number(error.retryAfterMs);
        const delay = Number.isFinite(advertised) && advertised > 0 ? Math.min(advertised, 120000) : 120000;
        await wait(delay);
        if (signal?.aborted) throw signal.reason || new Error("Audit request aborted");
        return work();
      }
    });
    tail = task.catch(() => {});
    return task;
  };
}
