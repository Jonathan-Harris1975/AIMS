import "../config/loadEnv.js";
import { refreshOpenRouterSpendReports } from "../services/ops/openrouterSpendWorker.js";

try {
  const result = await refreshOpenRouterSpendReports();
  if (!result.ok) {
    console.error(JSON.stringify({ event: "openrouter.analytics.unavailable", status: result.status, missing: result.missing }));
    process.exitCode = 2;
  } else {
    const report = result.latest;
    console.log(JSON.stringify({ event: "openrouter.analytics.verified", provider: report.provider,
      datesRefreshed: result.dates, date: report.period.date, timezone: report.period.timezone,
      collectedAt: report.collectedAt, currency: report.currency, metrics: Object.keys(report.totals),
      dimensions: report.dimensions,
      reconciled: report.reconciled, provisional: report.provisional, privateReportStored: true }));
  }
} catch (error) {
  console.error(JSON.stringify({ event: "openrouter.analytics.unavailable", status: "analytics-or-private-storage-failed",
    httpStatus: Number.isInteger(error?.status) ? error.status : null }));
  process.exitCode = 1;
}
