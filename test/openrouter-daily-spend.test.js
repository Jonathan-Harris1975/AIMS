import test from "node:test";
import assert from "node:assert/strict";
import { collectOpenRouterDailySpend, londonDayWindow, convertSpendToGbp, shiftDate, managementKey } from "../services/ops/openrouterSpend.js";
import { refreshOpenRouterSpendReports, runOpenRouterSpendTick } from "../services/ops/openrouterSpendWorker.js";

const now = new Date("2026-10-28T08:00:00Z");
const env = { OPENROUTER_MANAGEMENT_API_KEY: "test-management-secret" };
const result = rows => ({ data: { data: rows, metadata: { truncated: false, row_count: rows.length } } });
function fakeProvider({ total = 1.25, details = 1.25, truncated = false, missingMetric = false } = {}) {
  const calls = [];
  return { calls, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/meta")) return { ok: true, json: async () => ({ data: {
      metrics: (missingMetric ? ["request_count"] : ["total_usage", "request_count"]).map(name => ({ name })),
      dimensions: ["model", "app"].map(name => ({ name })),
    } }) };
    const query = JSON.parse(options.body);
    const data = result([{ total_usage: query.dimensions.length ? details : total, request_count: 2,
      ...(query.dimensions.length ? { model: "configured-model", app: "AIMS" } : {}) }]);
    if (query.dimensions.length) data.data.metadata.truncated = truncated;
    return { ok: true, json: async () => data };
  } };
}

test("London reporting preserves DST boundaries and rejects partial/future/invalid days", () => {
  const spring = londonDayWindow("2026-03-29", now);
  const autumn = londonDayWindow("2026-10-25", now);
  assert.equal((Date.parse(spring.end) - Date.parse(spring.start)) / 3600000, 23);
  assert.equal((Date.parse(autumn.end) - Date.parse(autumn.start)) / 3600000, 25);
  assert.equal(spring.start, "2026-03-29T00:00:00.000Z");
  assert.equal(spring.end, "2026-03-29T23:00:00.000Z");
  assert.throws(() => londonDayWindow("2026-10-28", now), /complete/);
  assert.throws(() => shiftDate("2026-02-30", 0), /Invalid/);
  assert.throws(() => shiftDate("../../secrets", 0), /YYYY/);
});

test("recorded totals and breakdown reconcile without estimating from prices", async () => {
  const provider = fakeProvider();
  const report = await collectOpenRouterDailySpend({ date: "2026-10-27", now }, { env, fetchImpl: provider.fetchImpl });
  assert.equal(report.recordedSpendUsd, 1.25);
  assert.equal(report.gbp, null);
  assert.equal(report.reconciled, true);
  assert.equal(report.provider, "OpenRouter");
  assert.deepEqual(report.dimensions, ["model", "app"]);
  assert.equal(provider.calls.length, 3);
  for (const call of provider.calls) {
    assert.equal(call.options.redirect, "error");
    assert.equal(call.options.headers.Authorization, "Bearer test-management-secret");
    if (call.options.body) assert.equal(JSON.parse(call.options.body).granularity, undefined);
  }
  assert.ok(!JSON.stringify(report).includes("test-management-secret"));
});

test("missing management key never falls back to an inference key or infers zero", async () => {
  for (const key of [undefined, "{{ secret.OPENROUTER_MANAGEMENT_API_KEY }}"]) {
    const report = await collectOpenRouterDailySpend({ now }, {
      env: { OPENROUTER_API_KEY: "inference-only", OPENROUTER_MANAGEMENT_API_KEY: key },
      fetchImpl() { throw new Error("must not request with inference credentials"); },
    });
    assert.equal(report.ok, false);
    assert.equal(report.status, "not_configured");
    assert.equal(report.recordedSpendUsd, undefined);
  }
});

test("truncation, missing charge metric, malformed rows and mismatch reject incomplete totals", async () => {
  for (const options of [{ truncated: true }, { missingMetric: true }, { details: 0.5 }, { total: null }]) {
    const provider = fakeProvider(options);
    await assert.rejects(collectOpenRouterDailySpend({ now }, { env, fetchImpl: provider.fetchImpl }));
  }
  const report = await collectOpenRouterDailySpend({ now }, { env, fetchImpl: async url => url.endsWith("/meta")
    ? fakeProvider().fetchImpl(url, { headers: {} }) : { ok: true, json: async () => result([]) } });
  assert.equal(report.recordedSpendUsd, 0, "only explicit complete empty provider results can establish zero");
});

test("provider failures are sanitized and conversion requires explicit dated FX evidence", async () => {
  await assert.rejects(collectOpenRouterDailySpend({ now }, { env, fetchImpl: async () => ({ ok: false, status: 403,
    text() { throw new Error("must not expose provider body"); } }) }), /HTTP 403/);
  assert.equal(convertSpendToGbp(2, null), null);
  assert.throws(() => convertSpendToGbp(2, { rate: 0.75 }), /source and date/);
  const converted = convertSpendToGbp(2, { rate: 0.75, date: "2026-10-27", source: "test-reference-only" });
  assert.equal(converted.estimate, 1.5);
  assert.match(converted.basis, /not card settlement/);
});

test("private refresh reconciles two days and cannot publish a partial latest pointer", async () => {
  const writes = [];
  const collect = async ({ date }) => ({ ok: true, period: { date }, collectedAt: now.toISOString(), recordedSpendUsd: 2 });
  const refresh = await refreshOpenRouterSpendReports({ now }, { collect,
    fetchFx: async () => ({ rate: 0.75, date: "2026-10-27", source: "test" }), store: async (key, report) => writes.push({ key, report }) });
  assert.deepEqual(refresh.dates, ["2026-10-26", "2026-10-27"]);
  assert.equal(writes.at(-1).key, "reports/openrouter-daily/latest.json");
  const failedWrites = [];
  await assert.rejects(refreshOpenRouterSpendReports({ now }, { fetchFx: async () => ({ rate: 0.75, date: "2026-10-27", source: "test" }), collect: async ({ date }) => {
    if (date === "2026-10-27") throw new Error("late provider failure"); return collect({ date });
  }, store: async key => failedWrites.push(key) }));
  assert.ok(!failedWrites.some(key => key.endsWith("latest.json")));
});

test("collector skips disabled/unconfigured/early/already-collected periods", async () => {
  const deps = { read: async () => ({ ok: true, gbp: { estimate: 1 }, period: { date: "2026-10-27" }, collectedAt: now.toISOString() }),
    refresh() { throw new Error("unexpected refresh"); } };
  assert.equal((await runOpenRouterSpendTick({ now, env: {} }, deps)).skipped, "disabled");
  assert.equal((await runOpenRouterSpendTick({ now, env: { OPENROUTER_DAILY_SPEND_ENABLED: "true" } }, deps)).status, "not_configured");
  const enabled = { ...env, OPENROUTER_DAILY_SPEND_ENABLED: "true" };
  assert.equal((await runOpenRouterSpendTick({ now: new Date("2026-10-28T05:00:00Z"), env: enabled }, deps)).skipped, "before-report-window");
  assert.equal((await runOpenRouterSpendTick({ now, env: enabled }, deps)).skipped, "already-collected");
});


test("master key is Analytics-only, takes precedence and ignores unresolved secret references", async () => {
  assert.equal(managementKey({ OPENROUTER_MASTER_KEY: "master", OPENROUTER_MANAGEMENT_API_KEY: "legacy" }), "master");
  assert.equal(managementKey({ OPENROUTER_MASTER_KEY: "{{secret.OPENROUTER_MASTER_KEY}}", OPENROUTER_MANAGEMENT_API_KEY: "legacy" }), "legacy");
  assert.equal(managementKey({ OPENROUTER_MASTER_KEY: "{{ secret.OPENROUTER_MASTER_KEY }}", OPENROUTER_API_KEY: "inference" }), "");
  const provider = fakeProvider();
  const report = await collectOpenRouterDailySpend({ now }, { env: { OPENROUTER_MASTER_KEY: "master-only" }, fetchImpl: provider.fetchImpl });
  assert.equal(report.ok, true);
  assert.ok(provider.calls.every(call => call.options.headers.Authorization === "Bearer master-only"));
  assert.ok(!JSON.stringify(report).includes("master-only"));
});

test("failed analytics validation retains diagnostic stages without credentials or charge values", async () => {
  const provider = fakeProvider({ total: null });
  await assert.rejects(collectOpenRouterDailySpend({ now }, { env, fetchImpl: provider.fetchImpl }), error => {
    assert.equal(error.analyticsDiagnostics.stage, "account-total");
    assert.ok(error.analyticsDiagnostics.availableMetrics.includes("total_usage"));
    assert.equal(error.analyticsDiagnostics.totalShape.rowMetricTypes[0].total_usage, "object");
    assert.ok(!JSON.stringify(error.analyticsDiagnostics).includes("test-management-secret"));
    return true;
  });
});

test("observed Analytics numeric strings and native reasoning/cache fields normalize before reconciliation", async () => {
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/meta")) return { ok: true, json: async () => ({ data: {
      metrics: ["total_usage", "request_count", "tokens_total", "tokens_prompt", "tokens_completion", "reasoning_tokens", "cached_tokens", "tokens_reasoning", "tokens_cached"].map(name => ({ name })),
      dimensions: ["model", "app"].map(name => ({ name })),
    } }) };
    const query = JSON.parse(options.body);
    assert.ok(!query.metrics.includes("tokens_reasoning"), "native fields take precedence over legacy names");
    assert.ok(!query.metrics.includes("tokens_cached"));
    return { ok: true, json: async () => result([{ total_usage: "1.25", request_count: "2", tokens_total: "150",
      tokens_prompt: "100", tokens_completion: "50", reasoning_tokens: "10", cached_tokens: "0",
      ...(query.dimensions.length ? { model: "Luna", app: "test" } : {}) }]) };
  };
  const report = await collectOpenRouterDailySpend({ now }, { env, fetchImpl });
  assert.equal(report.recordedSpendUsd, 1.25);
  assert.equal(report.totals.request_count, 2);
  assert.equal(report.breakdown[0].request_count, 2);
  assert.equal(report.totals.tokens_reasoning, 10);
  assert.equal(report.totals.tokens_cached, 0);
  assert.equal(report.breakdown[0].tokens_reasoning, report.totals.tokens_reasoning);
  assert.equal(report.breakdown[0].tokens_cached, report.totals.tokens_cached);
  assert.equal(report.metricAliases.tokens_reasoning, "reasoning_tokens");
  assert.ok(report.availableMetrics.includes("cached_tokens"));
});

test("numeric coercion rejects empty, malformed, nonfinite and unsafe or fractional counters", async () => {
  for (const count of ["", "  ", "2 tasks", "NaN", "Infinity", "-1", "2.5", "9007199254740992", null, true]) {
    const provider = fakeProvider();
    const fetchImpl = async (url, options) => {
      const response = await provider.fetchImpl(url, options);
      if (url.endsWith("/meta")) return response;
      const payload = await response.json();
      payload.data.data[0].request_count = count;
      return { ok: true, json: async () => payload };
    };
    await assert.rejects(collectOpenRouterDailySpend({ now }, { env, fetchImpl }));
  }
});
