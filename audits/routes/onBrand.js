import express from "express";
import { hookdeckDedupe } from "../../services/shared/utils/hookdeckDedupe.js";
import { validateBody, onBrandAuditRunBodySchema } from "../../services/shared/utils/requestSchemas.js";
import { runOnBrandAudit } from "../utils/onBrandAudit.js";
import { getAsyncAuditRouteJobFresh, startAsyncAuditRouteJob } from "../utils/asyncAuditRouteJobs.js";

const router = express.Router();
const AUDIT_TYPE = "on-brand";
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    auditType: AUDIT_TYPE,
    routes: ["GET /audits/on-brand/health", "POST /audits/on-brand/run"],
    time: new Date().toISOString(),
  });
});

router.post("/run", hookdeckDedupe("audits:on-brand:run"), asyncRoute(async (req, res) => {
  const parsed = validateBody(onBrandAuditRunBodySchema, req.body);
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, auditType: AUDIT_TYPE, error: parsed.error });
  }

  const job = await startAsyncAuditRouteJob({
    auditType: AUDIT_TYPE,
    payload: parsed.data,
    req,
    runner: runOnBrandAudit,
    metadata: { route: "audits.on-brand.run" },
  });
  return res.status(202).json(job);
}));

router.get("/jobs/:sessionId", asyncRoute(async (req, res) => {
  const job = await getAsyncAuditRouteJobFresh(AUDIT_TYPE, req.params.sessionId, req);
  if (!job) return res.status(404).json({ ok: false, auditType: AUDIT_TYPE, error: "Audit job not found" });
  return res.json(job);
}));

export default router;
