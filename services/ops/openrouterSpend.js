const API = "https://openrouter.ai/api/v1/analytics";
const zone = "Europe/London";

export function managementKey(env = process.env) {
  for (const name of ["OPENROUTER_MASTER_KEY", "OPENROUTER_MANAGEMENT_API_KEY"]) {
    const key = String(env[name] || "").trim();
    if (key && !/^\{\{\s*secret\./i.test(key)) return key;
  }
  return "";
}

export function londonDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function shiftDate(date, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error("Expected YYYY-MM-DD");
  const value = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date) throw new Error("Invalid report date");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function midnight(date) {
  const target = Date.parse(`${date}T00:00:00Z`);
  let guess = target;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(guess)).map(part => [part.type, part.value]));
    const localAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    guess = target - (localAsUtc - guess);
  }
  return new Date(guess).toISOString();
}

export function londonDayWindow(date, now = new Date()) {
  const next = shiftDate(date, 1);
  const window = { date, timezone: zone, start: midnight(date), end: midnight(next), endExclusive: true };
  if (Date.parse(window.end) > now.getTime()) throw new Error("Only complete London calendar days can be reported");
  return window;
}

async function queryApi(path, { key, fetchImpl, body }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  timer.unref?.();
  try {
    const response = await fetchImpl(`${API}/${path}`, {
      method: body ? "POST" : "GET", redirect: "error", signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      // Never reflect provider response bodies, credentials or request headers into logs/reports.
      const error = new Error(`OpenRouter Analytics HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return await response.json();
  } catch (error) {
    if (error?.status) throw error;
    throw new Error(controller.signal.aborted ? "OpenRouter Analytics timed out" : "OpenRouter Analytics request failed");
  } finally { clearTimeout(timer); }
}

function amount(value, field) {
  // Analytics serializes some integer/Decimal aggregates as strings.
  const parsed = typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)
    ? Number(value) : value;
  const counter = field === "request_count" || field.includes("tokens");
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed < 0 || (counter && !Number.isSafeInteger(parsed))) {
    throw new Error(`Missing or invalid analytics metric: ${field}`);
  }
  return parsed;
}

function checkedRows(response, metrics) {
  const data = response?.data;
  if (!Array.isArray(data?.data) || data.metadata?.truncated !== false || data.metadata?.row_count !== data.data.length) {
    throw new Error("Analytics coverage is incomplete or truncated");
  }
  return data.data.map(row => {
    return { ...row, ...Object.fromEntries(metrics.map(metric => [metric, amount(row[metric], metric)])) };
  });
}

export function convertSpendToGbp(usd, fx) {
  if (!fx) return null;
  if (!(Number.isFinite(fx.rate) && fx.rate > 0) || !fx.source || !fx.date) throw new Error("GBP conversion requires a rate, source and date");
  shiftDate(fx.date, 0);
  return { estimate: usd * fx.rate, rate: fx.rate, rateDate: fx.date, source: fx.source, basis: "reference-rate conversion, not card settlement" };
}

export async function collectOpenRouterDailySpend({ date, now = new Date(), fx = null } = {}, {
  env = process.env, fetchImpl = fetch,
} = {}) {
  const key = managementKey(env);
  if (!key) return { ok: false, status: "not_configured", missing: ["OPENROUTER_MASTER_KEY", "OPENROUTER_MANAGEMENT_API_KEY"], provider: "OpenRouter" };
  if (fx) convertSpendToGbp(0, fx);
  const window = londonDayWindow(date || shiftDate(londonDate(now), -1), now);
  const diagnostics = { stage: "metadata" };
  try {
  const meta = (await queryApi("meta", { key, fetchImpl }))?.data;
  const names = new Set((meta?.metrics || []).map(item => item.name));
  const dimensions = new Set((meta?.dimensions || []).map(item => item.name));
  diagnostics.availableMetrics = [...names];
  diagnostics.availableDimensions = [...dimensions];
  if (!names.has("total_usage") || !names.has("request_count") || !dimensions.has("model")) {
    throw new Error("OpenRouter metadata does not expose the required recorded-spend metrics");
  }
  const optionalTokens = ["tokens_total", "tokens_prompt", "tokens_completion",
    names.has("reasoning_tokens") ? "reasoning_tokens" : "tokens_reasoning",
    names.has("cached_tokens") ? "cached_tokens" : "tokens_cached"];
  const metrics = ["total_usage", "request_count", ...optionalTokens.filter(name => names.has(name))];
  diagnostics.stage = "account-total";
  const query = { metrics, time_range: { start: window.start, end: window.end }, limit: 1000 };
  // No granularity: aggregate the exact UK-day range, rather than summing UTC day buckets.
  const totalResponse = await queryApi("query", { key, fetchImpl, body: { ...query, dimensions: [] } });
  const shape = response => ({ metadata: response?.data?.metadata,
    rowMetricTypes: response?.data?.data?.slice(0, 1).map(row => Object.fromEntries(metrics.map(metric => [metric, typeof row[metric]]))) });
  diagnostics.totalShape = shape(totalResponse);
  const totalRows = checkedRows(totalResponse, metrics);
  if (totalRows.length > 1) throw new Error("Unexpected ungrouped analytics totals");
  const attribution = ["app", "api_key_id", "api_key"].find(name => dimensions.has(name)) || null;
  const groupBy = ["model", ...(attribution ? [attribution] : [])];
  diagnostics.stage = "model-breakdown";
  const breakdownResponse = await queryApi("query", { key, fetchImpl, body: { ...query, dimensions: groupBy } });
  diagnostics.breakdownShape = shape(breakdownResponse);
  const breakdown = checkedRows(breakdownResponse, metrics);
  diagnostics.stage = "reconciliation";
  const totals = Object.fromEntries(metrics.map(metric => [metric, totalRows.length ? amount(totalRows[0][metric], metric) : 0]));
  for (const metric of metrics) {
    const sum = breakdown.reduce((total, row) => total + row[metric], 0);
    if (Math.abs(sum - totals[metric]) > Math.max(1e-8, totals[metric] * 1e-8)) {
      throw new Error(`Analytics breakdown does not reconcile with account total: ${metric}`);
    }
  }
  // Stable report aliases preserve UI compatibility while retaining native metrics.
  const metricAliases = {};
  for (const [alias, native] of [["tokens_reasoning", "reasoning_tokens"], ["tokens_cached", "cached_tokens"]]) {
    if (Object.hasOwn(totals, native)) {
      totals[alias] = totals[native];
      for (const row of breakdown) row[alias] = row[native];
      metricAliases[alias] = native;
    }
  }
  return {
    ok: true, provider: "OpenRouter", scope: "authenticated-management-key-account", source: "OpenRouter Analytics API",
    collectedAt: now.toISOString(), period: window, currency: "USD", recordedSpendUsd: totals.total_usage,
    gbp: convertSpendToGbp(totals.total_usage, fx), totals, metricAliases, dimensions: groupBy, breakdown,
    availableMetrics: [...names], availableDimensions: [...dimensions],
    reconciled: true, provisional: true, attribution: attribution || "model-only; repository attribution unavailable",
    notes: ["Provider-recorded usage, not model-price estimates. Later provider adjustments may change totals.",
      "Application task/QA logs must be joined separately; model or API request counts are not completed-task counts.",
      "All account traffic is included. Do not assume all rows belong to AIMS, HIVE or RAMS without attribution evidence.",
      "No other model providers configured by the user. Credit purchases, VAT and card FX are not inferred from usage."],
  };
  } catch (error) {
    error.analyticsDiagnostics = { ...diagnostics, error: error.message, httpStatus: error.status || null };
    throw error;
  }
}
