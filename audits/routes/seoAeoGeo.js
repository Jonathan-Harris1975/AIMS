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
  flushSeoAeoGeoAnalysisJobs,
  getSeoAeoGeoAnalysisJobFresh,
  runSeoAeoGeoAnalysisJob,
  startSeoAeoGeoAnalysisJob,
} from "../utils/auditAnalysisJobs.js";
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

function truthy(value) {
  return ["1", "true", "yes", "on", "y"].includes(String(value || "").trim().toLowerCase());
}

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

function analysisPayloadFromJob(job) {
  if (!job || typeof job !== "object") return undefined;
  if (job.analysis && typeof job.analysis === "object") return job.analysis;
  if (job.result?.analysis && typeof job.result.analysis === "object") return job.result.analysis;
  if (job.result && typeof job.result === "object" && !Array.isArray(job.result)) {
    const looksLikeAnalysis = Boolean(
      job.result.auditCompletionState ||
        job.result.aiAnalysisStatus ||
        job.result.rankedIssueLedger ||
        job.result.issues ||
        job.result.executiveSummary
    );
    if (looksLikeAnalysis) return job.result;
  }
  return undefined;
}

function completedAnalysisBody(job, sessionId) {
  const analysis = analysisPayloadFromJob(job);
  return {
    ...job,
    ok: true,
    auditType: AUDIT_TYPE,
    sessionId,
    status: "completed",
    hasAnalysis: Boolean(analysis),
    analysis,
    result: {
      ...(job?.result && typeof job.result === "object" ? job.result : {}),
      analysis,
    },
    job: {
      ...job,
      analysis,
      result: {
        ...(job?.result && typeof job.result === "object" ? job.result : {}),
        analysis,
      },
    },
  };
}

router.post("/analysis", requireAuditCallbackAuth, asyncRoute(async (req, res) => {
  const parsed = validateBody(auditAnalysisBodySchema, req.body);
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const runAsync = truthy(process.env.AUDIT_ANALYSIS_ASYNC);

  if (!runAsync) {
    const job = await runSeoAeoGeoAnalysisJob(parsed.data);
    const analysis = analysisPayloadFromJob(job);

    info("audit.seo-aeo-geo.analysis.sync.result", {
      sessionId: parsed.data.sessionId,
      status: job?.status,
      hasAnalysis: Boolean(analysis),
      routeCount: parsed.data.allRoutes?.length ?? 0,
      coverageCount: parsed.data.coverage?.length ?? 0,
    });

    if (job?.status === "completed" && analysis) {
      return res.status(200).json(completedAnalysisBody(job, parsed.data.sessionId));
    }

    if (job?.status === "completed") {
      return res.status(409).json({
        ...job,
        ok: false,
        auditType: AUDIT_TYPE,
        sessionId: parsed.data.sessionId,
        status: "completed-without-analysis",
        hasAnalysis: false,
        error: "Analysis job completed without a forensic analysis payload",
      });
    }

    if (job?.status === "failed") {
      return res.status(502).json({
        ...job,
        ok: false,
        auditType: AUDIT_TYPE,
        sessionId: parsed.data.sessionId,
        status: "failed",
        hasAnalysis: false,
        error: job.error || { message: "Analysis job failed before producing a forensic analysis payload" },
      });
    }
  }

  const job = startSeoAeoGeoAnalysisJob(parsed.data);
  const durableState = await flushSeoAeoGeoAnalysisJobs();
  const paths = analysisStatusPaths(req, parsed.data.sessionId);

  info("audit.seo-aeo-geo.analysis.accepted", {
    sessionId: parsed.data.sessionId,
    status: job?.status || "queued",
    statusUrl: paths.absoluteStatusUrl,
    durableStateOk: durableState?.ok !== false,
  });

  return res.status(202).json({
    ok: true,
    auditType: AUDIT_TYPE,
    sessionId: parsed.data.sessionId,
    status: job?.status || "queued",
    hasAnalysis: false,
    ...paths,
    durableState,
    job,
  });
}));

router.get("/analysis/:sessionId", requireAuditCallbackAuth, asyncRoute(async (req, res) => {
  const sessionId = String(req.params.sessionId || "").trim();
  const job = await getSeoAeoGeoAnalysisJobFresh(sessionId);

  if (!job) {
    return res.status(202).json({
      ok: true,
      auditType: AUDIT_TYPE,
      sessionId,
      status: "queued",
      hasAnalysis: false,
      notFoundYet: true,
      message: "Analysis job has not reached this worker or durable state yet",
    });
  }

  const analysis = analysisPayloadFromJob(job);

  if (job.status === "queued" || job.status === "running") {
    return res.status(202).json({
      ...job,
      ok: true,
      auditType: AUDIT_TYPE,
      sessionId,
      status: job.status,
      hasAnalysis: false,
    });
  }

  if (job.status === "completed") {
    if (analysis) {
      return res.status(200).json(completedAnalysisBody(job, sessionId));
    }

    return res.status(409).json({
      ...job,
      ok: false,
      auditType: AUDIT_TYPE,
      sessionId,
      status: "completed-without-analysis",
      hasAnalysis: false,
      error: "Analysis job completed without a forensic analysis payload",
    });
  }

  return res.status(409).json({
    ...job,
    ok: false,
    auditType: AUDIT_TYPE,
    sessionId,
    status: job.status || "failed",
    hasAnalysis: false,
    error: job.error || { message: "Analysis job failed before producing a forensic analysis payload" },
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
