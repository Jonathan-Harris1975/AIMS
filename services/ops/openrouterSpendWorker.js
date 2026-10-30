import { collectOpenRouterDailySpend, londonDate, shiftDate, managementKey, convertSpendToGbp } from "./openrouterSpend.js";
import { fetchSpendFx } from "./spendFx.js";
import { info, warn } from "../../logger.js";

const prefix = "reports/openrouter-daily";
let timer;
let inFlight = null;

async function readPrivate(key) {
  const { getObjectAsText } = await import("../shared/utils/r2-client.js");
  try { return JSON.parse(await getObjectAsText("metaSystem", key)); }
  catch (error) {
    if (Number(error?.$metadata?.httpStatusCode || error?.status) === 404 || /NoSuchKey|not found/i.test(error?.message || "")) return null;
    throw error;
  }
}

async function storePrivate(key, report) {
  const { putPrivateJson } = await import("../shared/utils/r2-client.js");
  await putPrivateJson("metaSystem", key, report, { cacheControl: "no-store, max-age=0" });
}

export async function readOpenRouterSpendReport(date, { read = readPrivate } = {}) {
  if (date) shiftDate(date, 0);
  return read(`${prefix}/${date || "latest"}.json`);
}

export async function refreshOpenRouterSpendReports({ now = new Date(), lookback = 2 } = {}, {
  collect = collectOpenRouterDailySpend, store = storePrivate, fetchFx = fetchSpendFx,
} = {}) {
  if (!Number.isInteger(lookback) || lookback < 1 || lookback > 7) throw new Error("Spend lookback must be 1-7 days");
  const dates = Array.from({ length: lookback }, (_, index) => shiftDate(londonDate(now), index - lookback));
  const reports = [];
  for (const date of dates) {
    const report = await collect({ date, now });
    if (!report.ok) return report;
    try {
      report.gbp = convertSpendToGbp(report.recordedSpendUsd, await fetchFx(date));
    } catch {
      // FX failure must never discard verified provider USD evidence. Retry next tick.
      report.gbp = null;
      warn("openrouter.spend.fx_unavailable", { date });
    }
    await store(`${prefix}/${date}.json`, report);
    reports.push(report);
  }
  const latest = reports.at(-1);
  // Publish the latest pointer only after every requested reconciliation succeeds.
  await store(`${prefix}/latest.json`, latest);
  return { ok: true, dates, latest };
}

export async function runOpenRouterSpendTick({ now = new Date(), env = process.env } = {}, {
  read = readPrivate, refresh = refreshOpenRouterSpendReports,
} = {}) {
  if (!/^(true|1)$/i.test(String(env.OPENROUTER_DAILY_SPEND_ENABLED || ""))) return { ok: true, skipped: "disabled" };
  if (!managementKey(env)) return { ok: false, status: "not_configured", missing: ["OPENROUTER_MASTER_KEY", "OPENROUTER_MANAGEMENT_API_KEY"] };
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(now));
  if (hour < 7) return { ok: true, skipped: "before-report-window" };
  const latest = await read(`${prefix}/latest.json`);
  const expected = shiftDate(londonDate(now), -1);
  if (latest?.ok && latest.gbp && latest.period?.date === expected && londonDate(new Date(latest.collectedAt)) === londonDate(now)) {
    return { ok: true, skipped: "already-collected", date: expected };
  }
  return refresh({ now, lookback: latest?.ok && !latest.gbp ? 7 : 2 });
}

export function startOpenRouterSpendWorker() {
  if (timer) return;
  const tick = () => {
    if (inFlight) return;
    inFlight = runOpenRouterSpendTick()
      .then(result => { if (result.dates) info("openrouter.spend.collected", { dates: result.dates }); })
      .catch(() => warn("openrouter.spend.unavailable", { detail: "Analytics or private report storage unavailable; no spend inferred" }))
      .finally(() => { inFlight = null; });
  };
  timer = setInterval(tick, 30 * 60_000);
  timer.unref?.();
  tick();
}

export function stopOpenRouterSpendWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
