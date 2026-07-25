import express from "express";
import { hookdeckDedupe } from "../../services/shared/utils/hookdeckDedupe.js";
import { validateBody, auditRunBodySchema } from "../../services/shared/utils/requestSchemas.js";
import {
  getWebsiteAuditPipelineJobFresh,
  startWebsiteAuditPipeline,
} from "../utils/websiteAuditPipeline.js";

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    auditType: "website",
    orchestration: "AIMS",
    stages: ["digital-growth", "seo-aeo-geo", "mobile-ux", "expert-council", "final-pdf", "temporary-cleanup"],
    retentionPolicy: "final-pdf-only",
    time: new Date().toISOString(),
  });
});

router.post("/run", hookdeckDedupe("audits:website:run"), asyncRoute(async (req, res) => {
  const parsed = validateBody(auditRunBodySchema, req.body);
  if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error });
  const result = await startWebsiteAuditPipeline(parsed.data);
  return res.status(202).json(result);
}));

router.get("/jobs/:sessionId", asyncRoute(async (req, res) => {
  const job = await getWebsiteAuditPipelineJobFresh(req.params.sessionId);
  if (!job) return res.status(404).json({ ok: false, error: "Website audit pipeline job not found" });
  return res.json({ ok: job.status !== "failed", auditType: "website", job });
}));

export default router;
