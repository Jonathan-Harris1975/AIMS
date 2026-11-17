// services/podcast-growth/bookSalesEvidence.js
// Read-only proof of available KDP royalty workbooks, not a sales estimator.
import { listObjects, getObjectAsText } from "../shared/utils/r2-client.js";
import { warn } from "../../logger.js";

const PREFIX = "reports/royalties/";
const iso = (value) => {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

export async function getBookSalesEvidence({
  list = listObjects,
  readText = getObjectAsText,
} = {}) {
  try {
    const objects = await list("kdp", PREFIX);
    const reports = (Array.isArray(objects) ? objects : [])
      .filter((item) => {
        const key = String(item.key || item.Key || "");
        return key.startsWith(PREFIX) && key.endsWith(".xlsx");
      })
      .map((item) => ({
        key: String(item.key || item.Key),
        observedAt: iso(item.lastModified || item.LastModified),
      }))
      .sort((a, b) => String(b.observedAt || "").localeCompare(String(a.observedAt || "")));
    if (!reports.length) {
      return {
        status: "unavailable",
        evidenceMethod: "private-R2-kdp-royalty-report-inventory",
        workbookCount: 0,
        workbookCountKnown: true,
        latest: null,
        royaltiesGBP: null,
        soldUnits: null,
        attributableBookSales: null,
        limitation: "No downloaded KDP royalty workbook is available. No sales or ROI can be inferred from clicks.",
      };
    }
    const latest = reports[0];
    let metadata = null;
    try {
      const raw = JSON.parse(await readText("kdp", latest.key + ".json"));
      metadata = {
        startDate: typeof raw.startDate === "string" ? raw.startDate : null,
        endDate: typeof raw.endDate === "string" ? raw.endDate : null,
        createdAt: typeof raw.createdAt === "string" ? raw.createdAt : null,
      };
    } catch (error) {
      // The sidecar path follows services/kdp/storage.js: key + ".json".
      warn("podcast_growth.kdp_royalty_sidecar_unavailable", {
        code: String(error?.code || error?.name || "unknown").slice(0, 60),
      });
    }
    return {
      status: metadata ? "workbook-present" : "partial",
      evidenceMethod: "private-R2-kdp-royalty-report-inventory",
      workbookCount: reports.length,
      workbookCountKnown: true,
      latest: { key: latest.key, observedAt: latest.observedAt, metadata },
      royaltiesGBP: null,
      soldUnits: null,
      attributableBookSales: null,
      limitation: "Workbook presence proves source availability, not royalties. Parse and reconcile the real KDP workbook before reporting sales or ROI.",
    };
  } catch (error) {
    warn("podcast_growth.kdp_royalty_inventory_unavailable", {
      code: String(error?.code || error?.name || "unknown").slice(0, 60),
    });
    return {
      status: "unavailable",
      evidenceMethod: "private-R2-kdp-royalty-report-inventory",
      workbookCount: null,
      workbookCountKnown: false,
      latest: null,
      royaltiesGBP: null,
      soldUnits: null,
      attributableBookSales: null,
      limitation: "Private KDP report storage unavailable; commercial figures remain unverified.",
    };
  }
}
