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
  getSeoAeoGeoAnalysisJob,
  startSeoAeoGeoAnalysisJob,
} from "../utils/auditAnalysisJobs.js";
import { runSeoAeoGeoAnalysis } from "../utils/seoAeoGeoAnalysis.js";
import { error as logError, info } from "../../logger.js";

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

function externalBaseUrl(req) {
  const proto = String(req.get("x-forwarded-proto") || req.protocol || "https")
    .split(",")[0]
    .trim();
  const host = req.get("x-forwarded-host") || req.get("host") || "";
  return host ? `${proto}://${host}` : "";
}

function analysisStatusPaths(req, sessionId) {
  const relative = `${req.baseUrl}/analysis/${encodeURIComponent(sessionId)}`;
  const base = externalBaseUrl(req);
  return {
    statusUrl: relative,
    absoluteStatusUrl: base ? `${base}${relative}` : relative,
  };
}

function shouldRunAnalysisInline() {
  return (
    process.env.AUDIT_ANALYSIS_INLINE === "true" ||
    Boolean(process.env.NODE_TEST_CONTEXT)
  );
}

router.post("/analysis", requireAuditCallbackAuth, asyncRoute(async (req, res) => {
  const parsed = validateBody(auditAnalysisBodySchema, req.body);
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  if (shouldRunAnalysisInline()) {
    const analysis = await runSeoAeoGeoAnalysis(parsed.data);
    const job = {
      auditType: AUDIT_TYPE,
      sessionId: parsed.data.sessionId,
      status: "completed",
      result: { analysis },
      analysis,
    };

    info("audit.seo-aeo-geo.analysis.completed.inline", {
      sessionId: parsed.data.sessionId,
      routeCount: parsed.data.allRoutes?.length ?? 0,
      coverageCount: parsed.data.coverage?.length ?? 0,
      issueCount: Array.isArray(analysis?.issues) ? analysis.issues.length : 0,
    });

    return res.json({
      ok: true,
      auditType: AUDIT_TYPE,
      sessionId: parsed.data.sessionId,
      status: "completed",
      analysis,
      job,
    });
  }

  const { started, job } = startSeoAeoGeoAnalysisJob(parsed.data);
  const paths = analysisStatusPaths(req, parsed.data.sessionId);

  info("audit.seo-aeo-geo.analysis.accepted", {
    sessionId: parsed.data.sessionId,
    started,
    status: job?.status || "queued",
    routeCount: parsed.data.allRoutes?.length ?? 0,
    coverageCount: parsed.data.coverage?.length ?? 0,
  });

  if (job?.status === "completed") {
    return res.json({
      ok: true,
      auditType: AUDIT_TYPE,
      sessionId: parsed.data.sessionId,
      status: "completed",
      analysis: job?.result?.analysis || job?.analysis,
      job,
    });
  }

  if (job?.status === "failed") {
    return res.status(500).json({
      ok: false,
      auditType: AUDIT_TYPE,
      sessionId: parsed.data.sessionId,
      status: "failed",
      error: job.error?.message || "Analysis job failed",
      job,
    });
  }

  return res.status(202).json({
    ok: true,
    auditType: AUDIT_TYPE,
    sessionId: parsed.data.sessionId,
    status: job?.status || "queued",
    started,
    ...paths,
    job,
  });
}));

router.get("/analysis/:sessionId", requireAuditCallbackAuth, asyncRoute(async (req, res) => {
  const sessionId = String(req.params.sessionId || "").trim();
  const job = getSeoAeoGeoAnalysisJob(sessionId);
  if (!job) {
    return res.status(404).json({
      ok: false,
      auditType: AUDIT_TYPE,
      sessionId,
      status: "not-found",
      error: "Analysis job not found",
    });
  }

  if (job.status === "completed") {
    return res.json({
      ok: true,
      auditType: AUDIT_TYPE,
      sessionId,
      status: "completed",
      analysis: job?.result?.analysis || job?.analysis,
      job,
    });
  }

  if (job.status === "failed") {
    return res.status(500).json({
      ok: false,
      auditType: AUDIT_TYPE,
      sessionId,
      status: "failed",
      error: job.error?.message || "Analysis job failed",
      job,
    });
  }

  return res.status(202).json({
    ok: true,
    auditType: AUDIT_TYPE,
    sessionId,
    status: job.status || "queued",
    job,
  });
}));

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
