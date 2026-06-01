import express from "express";
import { hookdeckDedupe } from "../../services/shared/utils/hookdeckDedupe.js";
import {
  getSeoAeoGeoCouncilStatus,
  runSeoAeoGeoCouncilReport,
} from "../utils/seoAeoGeoCouncil.js";

const router = express.Router();
const AUDIT_TYPE = "seo-aeo-geo-council";
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/health", (_req, res) => {
  res.json({
    ...getSeoAeoGeoCouncilStatus(),
    routes: ["GET /audits/seo-aeo-geo-council/health", "POST /audits/seo-aeo-geo-council/run"],
    time: new Date().toISOString(),
  });
});

router.post("/run", hookdeckDedupe("audits:seo-aeo-geo-council:run"), asyncRoute(async (req, res) => {
  try {
    const result = await runSeoAeoGeoCouncilReport(req.body || {});
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      auditType: AUDIT_TYPE,
      error: error?.message || String(error),
    });
  }
}));

export default router;
