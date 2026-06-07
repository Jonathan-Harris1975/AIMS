import express from "express";
import { hookdeckDedupe } from "../../services/shared/utils/hookdeckDedupe.js";
import { validateBody, onBrandAuditRunBodySchema } from "../../services/shared/utils/requestSchemas.js";
import {
  getPodcastWebsiteReportStatus,
  runPodcastWebsiteReports,
} from "../utils/podcastWebsiteReports.js";

const router = express.Router();
const AUDIT_TYPE = "podcast-website";
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/health", (_req, res) => {
  res.json({
    ...getPodcastWebsiteReportStatus(),
    time: new Date().toISOString(),
  });
});

router.post("/run", hookdeckDedupe("audits:podcast-website:run"), asyncRoute(async (req, res) => {
  const parsed = validateBody(onBrandAuditRunBodySchema, req.body);
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, auditType: AUDIT_TYPE, error: parsed.error });
  }

  try {
    const result = await runPodcastWebsiteReports(parsed.data);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      auditType: AUDIT_TYPE,
      sessionId: parsed.data?.sessionId || null,
      error: error?.message || String(error),
    });
  }
}));

export default router;
