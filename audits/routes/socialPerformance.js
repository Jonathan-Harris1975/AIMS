import express from "express";
import { hookdeckDedupe } from "../../services/shared/utils/hookdeckDedupe.js";
import {
  getZernioConfigStatus,
  runZernioSocialPerformanceReport,
} from "../utils/zernioSocialPerformance.js";
import { getAsyncAuditRouteJobFresh, startAsyncAuditRouteJob } from "../utils/asyncAuditRouteJobs.js";

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
  const job = await startAsyncAuditRouteJob({
    auditType: AUDIT_TYPE,
    payload: req.body || {},
    req,
    runner: runZernioSocialPerformanceReport,
    metadata: { route: "audits.social-performance.run" },
  });
  return res.status(202).json(job);
}));

router.get("/jobs/:sessionId", asyncRoute(async (req, res) => {
  const job = await getAsyncAuditRouteJobFresh(AUDIT_TYPE, req.params.sessionId, req);
  if (!job) return res.status(404).json({ ok: false, auditType: AUDIT_TYPE, error: "Audit job not found" });
  return res.json(job);
}));

export default router;
