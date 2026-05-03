import express from "express";
import { hookdeckDedupe } from "../../services/shared/utils/hookdeckDedupe.js";
import {
  validateBody,
  auditAnalysisBodySchema,
  auditCallbackBodySchema,
  auditRunBodySchema,
} from "../../services/shared/utils/requestSchemas.js";
import { completeAuditRun, getAuditJob, startAuditRun } from "../utils/orchestrator.js";
import { requireAuditCallbackAuth } from "../utils/callbackAuth.js";
import { getSeoAeoGeoAnalysisJob, startSeoAeoGeoAnalysisJob } from "../utils/auditAnalysisJobs.js";
import { info } from "../../logger.js";

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const AUDIT_TYPE = "seo-aeo-geo";
const WORKFLOW_ID = "seo-aeo-geo-forensic.yml";

router.get("/health", (_req, res) => {
  res.json({ ok: true, auditType: AUDIT_TYPE, workflowId: WORKFLOW_ID, time: new Date().toISOString() });
});

router.post("/run", hookdeckDedupe("audits:seo-aeo-geo:run"), asyncRoute(async (req, res) => {
  const parsed = validateBody(auditRunBodySchema, req.body);
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const result = await startAuditRun({
    auditType: AUDIT_TYPE,
    workflowId: WORKFLOW_ID,
    body: parsed.data,
    callbackPath: "/audits/seo-aeo-geo/callback",
  });

  return res.status(202).json(result);
}));

router.post("/analysis", requireAuditCallbackAuth, asyncRoute(async (req, res) => {
  const parsed = validateBody(auditAnalysisBodySchema, req.body);
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const job = startSeoAeoGeoAnalysisJob(parsed.data);
  const statusUrl = `${req.protocol}://${req.get("host")}/audits/seo-aeo-geo/analysis/${encodeURIComponent(parsed.data.sessionId)}`;

  info("audit.seo-aeo-geo.analysis.accepted", {
    sessionId: parsed.data.sessionId,
    status: job.status,
    statusUrl,
  });

  return res.status(202).json({
    ok: true,
    auditType: AUDIT_TYPE,
    sessionId: parsed.data.sessionId,
    status: job.status,
    statusUrl,
    job,
  });
}));

router.get("/analysis/:sessionId", requireAuditCallbackAuth, (req, res) => {
  const sessionId = String(req.params.sessionId || "").trim();
  const job = getSeoAeoGeoAnalysisJob(sessionId);

  if (!job) {
    return res.status(404).json({
      ok: false,
      auditType: AUDIT_TYPE,
      sessionId,
      status: "not_found",
      error: "Analysis job not found",
    });
  }

  return res.status(200).json(job);
});

router.post("/callback", requireAuditCallbackAuth, asyncRoute(async (req, res) => {
  const parsed = validateBody(auditCallbackBodySchema, req.body);
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const result = await completeAuditRun({ auditType: AUDIT_TYPE, payload: parsed.data });
  return res.json(result);
}));

router.get("/jobs/:sessionId", (req, res) => {
  const job = getAuditJob(AUDIT_TYPE, req.params.sessionId);
  if (!job) {
    return res.status(404).json({ ok: false, error: "Audit job not found" });
  }
  return res.json({ ok: true, auditType: AUDIT_TYPE, job });
});

export default router;
