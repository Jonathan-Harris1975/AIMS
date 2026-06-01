import express from "express";
import { hookdeckDedupe } from "../../services/shared/utils/hookdeckDedupe.js";
import {
  getZernioConfigStatus,
  runZernioSocialPerformanceReport,
} from "../utils/zernioSocialPerformance.js";

const router = express.Router();
const AUDIT_TYPE = "social-performance";
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    auditType: AUDIT_TYPE,
    routes: ["GET /audits/social-performance/health", "POST /audits/social-performance/run"],
    zernio: getZernioConfigStatus(),
    time: new Date().toISOString(),
  });
});

router.post("/run", hookdeckDedupe("audits:social-performance:run"), asyncRoute(async (req, res) => {
  try {
    const result = await runZernioSocialPerformanceReport(req.body || {});
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
