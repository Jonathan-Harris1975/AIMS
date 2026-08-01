import express from "express";
import { requestDedupe } from "../../services/shared/utils/requestDedupe.js";
import {
  getBrandSocialCouncilStatus,
  runBrandSocialCouncilReport,
} from "../utils/brandSocialCouncil.js";
import { getAsyncAuditRouteJobFresh, startAsyncAuditRouteJob } from "../utils/asyncAuditRouteJobs.js";

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

router.post("/run", requestDedupe("audits:brand-social-council:run"), asyncRoute(async (req, res) => {
  const job = await startAsyncAuditRouteJob({
    auditType: AUDIT_TYPE,
    payload: req.body || {},
    req,
    runner: runBrandSocialCouncilReport,
    metadata: { route: "audits.brand-social-council.run" },
  });
  return res.status(202).json(job);
}));

router.get("/jobs/:sessionId", asyncRoute(async (req, res) => {
  const job = await getAsyncAuditRouteJobFresh(AUDIT_TYPE, req.params.sessionId, req);
  if (!job) return res.status(404).json({ ok: false, auditType: AUDIT_TYPE, error: "Audit job not found" });
  return res.json(job);
}));

export default router;
