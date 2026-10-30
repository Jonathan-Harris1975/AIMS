import test from "node:test";
import assert from "node:assert/strict";
import { fetchSpendFx } from "../services/ops/spendFx.js";
import { refreshOpenRouterSpendReports, runOpenRouterSpendTick } from "../services/ops/openrouterSpendWorker.js";
const now = new Date("2026-10-30T09:00:00Z");
const fx = { rate: 0.75, date: "2026-10-29", source: "test reference" };

test("FX validates pair, date, age and rate without sending credentials", async () => {
  const row = { base: "USD", quote: "GBP", date: "2026-10-23", rate: 0.75 };
  const valid = await fetchSpendFx("2026-10-25", { fetchImpl: async (url, options) => {
    assert.match(url, /date=2026-10-25$/);
    assert.equal(options.headers, undefined);
    assert.equal(options.redirect, "error");
    return { ok: true, json: async () => row };
  } });
  assert.equal(valid.date, "2026-10-23");
  for (const change of [{ date: "2026-10-26" }, { date: "2026-10-01" }, { date: "2026-02-30" },
    { base: "EUR" }, { quote: "USD" }, { rate: 0 }, { rate: "0.75" }, { rate: Infinity }]) {
    await assert.rejects(fetchSpendFx("2026-10-25", { fetchImpl: async () => ({ ok: true, json: async () => ({ ...row, ...change }) }) }));
  }
  await assert.rejects(fetchSpendFx("2026-10-25", { fetchImpl: async () => ({ ok: false, status: 503 }) }), /503/);
});

test("refresh publishes sourced GBP and preserves USD on FX failure", async () => {
  for (const failure of [false, true]) {
    const writes = [];
    await refreshOpenRouterSpendReports({ now, lookback: 1 }, {
      collect: async ({ date }) => ({ ok: true, period: { date }, recordedSpendUsd: 2 }),
      fetchFx: async () => { if (failure) throw new Error("offline"); return fx; },
      store: async (key, report) => writes.push({ key, report }),
    });
    assert.equal(writes.at(-1).key, "reports/openrouter-daily/latest.json");
    assert.equal(writes.at(-1).report.recordedSpendUsd, 2);
    assert.equal(writes.at(-1).report.gbp?.estimate ?? null, failure ? null : 1.5);
  }
});

test("same-day GBP-less reports trigger backfill rather than being skipped", async () => {
  let requested;
  await runOpenRouterSpendTick({ now, env: { OPENROUTER_DAILY_SPEND_ENABLED: "true", OPENROUTER_MASTER_KEY: "test" } }, {
    read: async () => ({ ok: true, period: { date: "2026-10-29" }, collectedAt: now.toISOString(), gbp: null }),
    refresh: async options => { requested = options; return { ok: true }; },
  });
  assert.equal(requested.lookback, 7);
});
