import express from "express";
import { hookdeckDedupe } from "../../services/shared/utils/hookdeckDedupe.js";
import {
  getBrandSocialCouncilStatus,
  runBrandSocialCouncilReport,
} from "../utils/brandSocialCouncil.js";

const router = express.Router();
const AUDIT_TYPE = "brand-social-council";
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/health", (_req, res) => {
  res.json({
    ...getBrandSocialCouncilStatus(),
    routes: ["GET /audits/brand-social-council/health", "POST /audits/brand-social-council/run"],
    time: new Date().toISOString(),
  });
});

router.post("/run", hookdeckDedupe("audits:brand-social-council:run"), asyncRoute(async (req, res) => {
  try {
    const result = await runBrandSocialCouncilReport(req.body || {});
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
