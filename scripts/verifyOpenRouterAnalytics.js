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
      dimensions: report.dimensions, gbpAvailable: Boolean(report.gbp), fxRateDate: report.gbp?.rateDate || null,
      reconciled: report.reconciled, provisional: report.provisional, privateReportStored: true }));
  }
} catch (error) {
  try {
    const { putPrivateJson } = await import("../services/shared/utils/r2-client.js");
    await putPrivateJson("metaSystem", "reports/openrouter-daily/diagnostics.json", {
      ok: false, collectedAt: new Date().toISOString(),
      diagnostics: error.analyticsDiagnostics || { stage: "private-storage", error: "Report storage unavailable" },
    }, { cacheControl: "no-store, max-age=0" });
  } catch { /* Keep storage/credential details out of public workflow logs. */ }
  console.error(JSON.stringify({ event: "openrouter.analytics.unavailable", status: "analytics-or-private-storage-failed",
    httpStatus: Number.isInteger(error?.status) ? error.status : null }));
  process.exitCode = 1;
}
