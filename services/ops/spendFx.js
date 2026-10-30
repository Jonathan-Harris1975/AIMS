import { shiftDate } from "./openrouterSpend.js";

// Reference conversion only. Never send provider credentials to the FX service.
export async function fetchSpendFx(date, { fetchImpl = fetch } = {}) {
  shiftDate(date, 0);
  const url = `https://api.frankfurter.dev/v2/rate/USD/GBP?date=${date}`;
  const response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Exchange-rate service HTTP ${response.status}`);
  const row = await response.json();
  shiftDate(row?.date, 0);
  if (row.base !== "USD" || row.quote !== "GBP" || typeof row.rate !== "number" ||
      !Number.isFinite(row.rate) || row.rate <= 0 || row.date > date || row.date < shiftDate(date, -7)) {
    throw new Error("Invalid or stale USD/GBP reference rate");
  }
  return { rate: row.rate, date: row.date, source: `Frankfurter (${url})` };
}
