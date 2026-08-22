#!/usr/bin/env node
import { performance } from "node:perf_hooks";

// Pin a dependency-free test runtime before production defaults are loaded.
process.env.NODE_ENV = "test";
process.env.APP_ENV = "test";
process.env.COMMS_HUB_ENABLED = "false";
process.env.RSS_INIT_ON_BOOT = "false";
process.env.STARTUP_CHECK_REQUIRED_POST_START = "false";
process.env.ALLOW_EPHEMERAL_STATE = process.env.ALLOW_EPHEMERAL_STATE || "true";

const REQUESTS = Math.max(20, Number(process.env.PERF_HEALTH_REQUESTS || 120));
const CONCURRENCY = Math.max(1, Number(process.env.PERF_HEALTH_CONCURRENCY || 12));
const MAX_P95_MS = Math.max(1, Number(process.env.PERF_HEALTH_P95_MS || 300));
const MAX_MEAN_MS = Math.max(1, Number(process.env.PERF_HEALTH_MEAN_MS || 150));
const MAX_ERROR_RATE = Math.max(0, Number(process.env.PERF_HEALTH_MAX_ERROR_RATE || 0));

function percentile(values, quantile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index];
}

async function request(url) {
  const started = performance.now();
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    await response.arrayBuffer();
    return { ok: response.ok, ms: performance.now() - started, status: response.status };
  } catch (error) {
    return { ok: false, ms: performance.now() - started, error: error?.message || String(error) };
  }
}

async function runPool(url) {
  let cursor = 0;
  const results = new Array(REQUESTS);
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= REQUESTS) return;
      results[index] = await request(url);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, REQUESTS) }, () => worker()));
  return results;
}

await import("../config/loadEnv.js");
const { app } = await import("../server.js");
let server;
try {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("AIMS performance gate listen timeout")), 15_000);
    server.once("listening", () => { clearTimeout(timer); resolve(); });
    server.once("error", reject);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}/health`;

  for (let i = 0; i < 10; i += 1) {
    const warm = await request(url);
    if (!warm.ok) throw new Error(`AIMS health warm-up failed with ${warm.status || warm.error}`);
  }

  const results = await runPool(url);
  const latencies = results.map((item) => item.ms);
  const failures = results.filter((item) => !item.ok);
  const meanMs = latencies.reduce((sum, value) => sum + value, 0) / latencies.length;
  const p95Ms = percentile(latencies, 0.95);
  const p99Ms = percentile(latencies, 0.99);
  const errorRate = failures.length / results.length;
  const report = {
    ok: failures.length === 0 && p95Ms <= MAX_P95_MS && meanMs <= MAX_MEAN_MS && errorRate <= MAX_ERROR_RATE,
    endpoint: "/health",
    requests: REQUESTS,
    concurrency: CONCURRENCY,
    meanMs: Number(meanMs.toFixed(2)),
    p95Ms: Number(p95Ms.toFixed(2)),
    p99Ms: Number(p99Ms.toFixed(2)),
    errors: failures.length,
    errorRate: Number(errorRate.toFixed(4)),
    slo: { maxP95Ms: MAX_P95_MS, maxMeanMs: MAX_MEAN_MS, maxErrorRate: MAX_ERROR_RATE },
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
