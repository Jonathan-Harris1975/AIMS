import express from "express";
import { requestDedupe } from "../../services/shared/utils/requestDedupe.js";
import { validateBody, auditRunBodySchema } from "../../services/shared/utils/requestSchemas.js";
import { getWebsiteAuditReadiness } from "../utils/websiteAuditReadiness.js";
import {
  getWebsiteAuditPipelineJobFresh,
  retryWebsiteAuditRamsDispatch,
  startWebsiteAuditPipeline,
} from "../utils/websiteAuditPipeline.js";

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/health", (_req, res) => {
  const readiness = getWebsiteAuditReadiness();
  res.status(readiness.ready ? 200 : 503).json({
    ok: readiness.ready,
    auditType: "website",
    orchestration: "AIMS",
    stages: ["digital-growth", "seo-aeo-geo", "mobile-ux", "expert-council", "final-report-set", "rams-website", "temporary-cleanup"],
    retentionPolicy: "final-pdf-html-json-only-after-rams-acceptance; retain-source-evidence-on-failure",
    readiness,
    time: new Date().toISOString(),
  });
});

router.post("/run", requestDedupe("audits:website:run"), asyncRoute(async (req, res) => {
  const readiness = getWebsiteAuditReadiness();
  if (!readiness.ready) {
    return res.status(503).json({ ok: false, error: "website-audit-not-ready", readiness });
  }
  const parsed = validateBody(auditRunBodySchema, req.body);
  if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error });
  const result = await startWebsiteAuditPipeline(parsed.data);
  return res.status(202).json(result);
}));


router.post("/jobs/:sessionId/rams/retry", requestDedupe("audits:website:rams:retry"), asyncRoute(async (req, res) => {
  const job = await retryWebsiteAuditRamsDispatch(req.params.sessionId);
  return res.status(202).json({ ok: true, auditType: "website", job });
}));

router.get("/jobs/:sessionId", asyncRoute(async (req, res) => {
  const job = await getWebsiteAuditPipelineJobFresh(req.params.sessionId);
  if (!job) return res.status(404).json({ ok: false, error: "Website audit pipeline job not found" });
  return res.json({ ok: job.status !== "failed", auditType: "website", job });
}));

export default router;
