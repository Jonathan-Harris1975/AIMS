import express from "express";
import { hookdeckDedupe } from "../../services/shared/utils/hookdeckDedupe.js";
import {
  getMobileUxCouncilStatus,
  runMobileUxCouncilReport,
} from "../utils/mobileUxCouncil.js";

const router = express.Router();
const AUDIT_TYPE = "mobile-ux-council";
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/health", (_req, res) => {
  res.json({
    ...getMobileUxCouncilStatus(),
    routes: ["GET /audits/mobile-ux-council/health", "POST /audits/mobile-ux-council/run"],
    time: new Date().toISOString(),
  });
});

router.post("/run", hookdeckDedupe("audits:mobile-ux-council:run"), asyncRoute(async (req, res) => {
  try {
    const result = await runMobileUxCouncilReport(req.body || {});
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
