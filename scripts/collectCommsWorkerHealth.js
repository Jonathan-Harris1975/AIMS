const key = process.env.AIMS_API_KEY || process.env.AI_SUITE_API_KEY || "";
if (!key) {
  console.error("runtime suite bearer unavailable");
  process.exit(2);
}

const url = `http://127.0.0.1:${process.env.PORT || "3000"}/comms-hub/workers/health`;
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 10_000);

try {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
    redirect: "error",
    signal: controller.signal,
  });

  if (response.status !== 200 && response.status !== 503) {
    console.error(`worker health HTTP ${response.status}`);
    process.exit(3);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 256_000) {
      await reader.cancel();
      throw new Error("HealthPayloadTooLarge");
    }
    chunks.push(Buffer.from(value));
  }
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (payload?.service !== "comms-hub" || !payload.health || !Array.isArray(payload.health.workers)) {
    throw new Error("HealthPayloadInvalid");
  }
  // Retain only the health contract, never arbitrary response/error fields.
  const fields = [
    "category", "key", "enabled", "status", "freshness", "pollIntervalMs",
    "degradedAfterMs", "staleAfterMs", "lastAttemptAt", "lastSuccessAt",
    "lastFailureAt", "ageMs", "instancesSeen",
  ];
  const body = JSON.stringify({
    ok: payload.ok === true,
    service: payload.service,
    probeHttpStatus: response.status,
    health: {
      overall: payload.health.overall,
      revision: payload.health.revision,
      checkedAt: payload.health.checkedAt,
      enabledWorkers: payload.health.enabledWorkers,
      workers: payload.health.workers.map((worker) =>
        Object.fromEntries(fields.map((field) => [field, worker?.[field]]))),
    },
  });
  console.log(`WORKER_HEALTH_B64=${Buffer.from(body).toString("base64")}`);
  if (!response.ok) {
    console.error(`worker health HTTP ${response.status}`);
    process.exitCode = 3;
  }
} catch (error) {
  console.error(`worker health probe failed: ${error?.name || "Error"}`);
  process.exit(4);
} finally {
  clearTimeout(timer);
}
