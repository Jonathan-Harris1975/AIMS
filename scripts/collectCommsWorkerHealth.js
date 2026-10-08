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

  if (!response.ok) {
    console.error(`worker health HTTP ${response.status}`);
    process.exit(3);
  }

  const body = await response.text();
  JSON.parse(body);
  console.log(`WORKER_HEALTH_B64=${Buffer.from(body).toString("base64")}`);
} catch (error) {
  console.error(`worker health probe failed: ${error?.name || "Error"}`);
  process.exit(4);
} finally {
  clearTimeout(timer);
}
