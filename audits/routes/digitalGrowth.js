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
import {
  flushDigitalGrowthAnalysisJobs,
  getDigitalGrowthAnalysisJobFresh,
  startDigitalGrowthAnalysisJob,
} from "../utils/digitalGrowthAnalysisJobs.js";
import { resumeWebsiteAuditPipelineFromChild } from "../utils/websiteAuditPipeline.js";
import { info } from "../../logger.js";

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const AUDIT_TYPE = "digital-growth";
const WORKFLOW_ID = "digital-growth-audit.yml";

router.get("/health", (_req, res) => {
  res.json({ ok: true, auditType: AUDIT_TYPE, workflowId: WORKFLOW_ID, time: new Date().toISOString() });
});

router.post("/run", hookdeckDedupe("audits:digital-growth:run"), asyncRoute(async (req, res) => {
  const parsed = validateBody(auditRunBodySchema, req.body);
  if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error });
  const result = await startAuditRun({
    auditType: AUDIT_TYPE,
    workflowId: WORKFLOW_ID,
    body: parsed.data,
    callbackPath: "/audits/digital-growth/callback",
  });
  return res.status(202).json(result);
}));

router.post("/analysis", requireAuditCallbackAuth, asyncRoute(async (req, res) => {
  const parsed = validateBody(auditAnalysisBodySchema, req.body);
  if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error });
  const job = await startDigitalGrowthAnalysisJob({ ...parsed.data, auditType: AUDIT_TYPE });
  const durableState = await flushDigitalGrowthAnalysisJobs();
  const statusUrl = `${req.protocol}://${req.get("host")}/audits/digital-growth/analysis/${encodeURIComponent(parsed.data.sessionId)}`;
  info("audit.digital-growth.analysis.accepted", { sessionId: parsed.data.sessionId, status: job.status, statusUrl });
  return res.status(202).json({ ok: true, auditType: AUDIT_TYPE, sessionId: parsed.data.sessionId, status: job.status, statusUrl, durableState, job });
}));

router.get("/analysis/:sessionId", requireAuditCallbackAuth, asyncRoute(async (req, res) => {
  const sessionId = String(req.params.sessionId || "").trim();
  const job = await getDigitalGrowthAnalysisJobFresh(sessionId);
  if (!job) return res.status(202).json({ ok: true, auditType: AUDIT_TYPE, sessionId, status: "queued", hasAnalysis: false, notFoundYet: true });
  if (job.status === "queued" || job.status === "running") return res.status(202).json(job);
  if (job.status === "completed" && job.analysis) return res.status(200).json({ ...job, ok: true, hasAnalysis: true, analysis: job.analysis, result: { analysis: job.analysis } });
  return res.status(409).json({ ...job, ok: false, hasAnalysis: false });
}));

router.post("/callback", requireAuditCallbackAuth, asyncRoute(async (req, res) => {
  const parsed = validateBody(auditCallbackBodySchema, req.body);
  if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error });
  const result = await completeAuditRun({ auditType: AUDIT_TYPE, payload: parsed.data });
  const pipeline = await resumeWebsiteAuditPipelineFromChild({ auditType: AUDIT_TYPE, result });
  return res.json(pipeline ? { ...result, pipeline } : result);
}));

router.get("/jobs/:sessionId", (req, res) => {
  const job = getAuditJob(AUDIT_TYPE, req.params.sessionId);
  if (!job) return res.status(404).json({ ok: false, error: "Audit job not found" });
  return res.json({ ok: true, auditType: AUDIT_TYPE, job });
});

export default router;
