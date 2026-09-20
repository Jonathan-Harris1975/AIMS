import "../config/loadEnv.js";

const port = Number(process.env.PORT || 0) || 0;
process.env.NODE_ENV = process.env.NODE_ENV || "production";
process.env.RSS_INIT_ON_BOOT = process.env.RSS_INIT_ON_BOOT || "false";
process.env.STARTUP_CHECK_REQUIRED_POST_START = process.env.STARTUP_CHECK_REQUIRED_POST_START || "false";

const readinessExpectation = String(process.env.DEPLOY_SMOKE_EXPECT_READY || "auto").trim().toLowerCase();
if (!["auto", "true", "false"].includes(readinessExpectation)) {
  throw new Error("DEPLOY_SMOKE_EXPECT_READY must be auto, true or false");
}

const { startServer, stopServer } = await import("../server.js");

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const body = await response.json();
  return { response, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const server = startServer(port);

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Smoke server listen timeout")), 15_000);
    server.once("listening", () => {
      clearTimeout(timer);
      resolve();
    });
    server.once("error", reject);
  });

  const address = server.address();
  const listenPort = typeof address === "object" && address ? address.port : port;
  const root = `http://127.0.0.1:${listenPort}`;

  const health = await fetchJson(`${root}/health`);
  assert(health.response.status === 200, `/health returned ${health.response.status}`);
  assert(health.body?.ok === true && health.body?.service === "AIMS", "/health contract is invalid");

  const live = await fetchJson(`${root}/livez`);
  assert(live.response.status === 200, `/livez returned ${live.response.status}`);
  assert(live.body?.ok === true && live.body?.status === "alive", "/livez contract is invalid");

  const ready = await fetchJson(`${root}/readyz`);
  assert([200, 503].includes(ready.response.status), `/readyz returned unexpected ${ready.response.status}`);
  assert(typeof ready.body?.ready === "boolean", "/readyz must expose a boolean ready field");
  assert(Array.isArray(ready.body?.checks) && ready.body.checks.length > 0, "/readyz must expose readiness checks");
  assert(
    (ready.response.status === 200) === ready.body.ready,
    `/readyz HTTP status ${ready.response.status} does not match ready=${ready.body.ready}`
  );

  if (readinessExpectation === "true") {
    assert(ready.body.ready === true, `Production readiness was expected but failed: ${JSON.stringify(ready.body.checks)}`);
  } else if (readinessExpectation === "false") {
    assert(ready.body.ready === false, "Production readiness unexpectedly passed when failure behaviour was under test");
  }

  await stopServer();
  assert(server.listening === false, "Server remained listening after graceful shutdown");

  let acceptedAfterShutdown = false;
  try {
    await fetch(`${root}/health`, { signal: AbortSignal.timeout(1_000) });
    acceptedAfterShutdown = true;
  } catch {
    // Expected: the listener has closed.
  }
  assert(!acceptedAfterShutdown, "Server still accepted requests after graceful shutdown");

  console.log(JSON.stringify({
    ok: true,
    health: health.response.status,
    livez: live.response.status,
    readyz: ready.response.status,
    ready: ready.body.ready,
    shutdown: "closed",
  }));
} finally {
  await stopServer();
}
