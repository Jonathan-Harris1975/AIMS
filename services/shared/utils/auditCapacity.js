// Serialise paid audit synthesis in this process. Other services and replicas
// still share OpenRouter's account allowance. Only explicit temporary in-flight
// or upstream shared-pool refusals get one delayed retry on the same route.
export function isAuditInFlightRefusal(error) {
  return Number(error?.status) === 402 &&
    [error?.message, error?.bodySnippet].some(value => String(value || "").includes("in_flight_budget_exhausted"));
}

export function isAuditSharedPoolRefusal(error) {
  return Number(error?.status) === 429 &&
    [error?.message, error?.bodySnippet].some(value =>
      /temporarily rate-limited upstream|upstream_provider_shared_pool/i.test(String(value || "")));
}

export function createAuditCapacityQueue() {
  let tail = Promise.resolve();
  return function queued(work, { wait, signal } = {}) {
    const task = tail.then(async () => {
      if (signal?.aborted) throw signal.reason || new Error("Audit request aborted");
      try { return await work(); }
      catch (error) {
        if (!isAuditInFlightRefusal(error) && !isAuditSharedPoolRefusal(error)) throw error;
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
