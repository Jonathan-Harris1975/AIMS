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
import { flushSeoAeoGeoAnalysisJobs, getSeoAeoGeoAnalysisJobFresh, startSeoAeoGeoAnalysisJob } from "../utils/auditAnalysisJobs.js";
import { info } from "../../logger.js";
import { runSeoAeoGeoCouncilReport } from "../utils/seoAeoGeoCouncil.js";
import { startAsyncAuditRouteJob } from "../utils/asyncAuditRouteJobs.js";
import { resumeWebsiteAuditPipelineFromChild } from "../utils/websiteAuditPipeline.js";

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

  const job = await startSeoAeoGeoAnalysisJob(parsed.data);
  const durableState = await flushSeoAeoGeoAnalysisJobs();
  const statusUrl = `${req.protocol}://${req.get("host")}/audits/seo-aeo-geo/analysis/${encodeURIComponent(parsed.data.sessionId)}`;

  info("audit.seo-aeo-geo.analysis.accepted", {
    sessionId: parsed.data.sessionId,
    status: job.status,
    statusUrl,
    durableStateOk: durableState?.ok !== false,
  });

  return res.status(202).json({
    ok: true,
    auditType: AUDIT_TYPE,
    sessionId: parsed.data.sessionId,
    status: job.status,
    statusUrl,
    durableState,
    job,
  });
}));

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
      return res.status(200).json({
        ...job,
        ok: true,
        auditType: AUDIT_TYPE,
        sessionId,
        status: "completed",
        hasAnalysis: true,
        analysis,
        result: {
          ...(job.result && typeof job.result === "object" ? job.result : {}),
          analysis,
        },
        job: {
          ...job,
          analysis,
          result: {
            ...(job.result && typeof job.result === "object" ? job.result : {}),
            analysis,
          },
        },
      });
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

function shouldRunSeoAeoGeoCouncil(body = {}) {
  if (body.runCouncil === true || body.runSeoAeoGeoCouncil === true) return true;
  if (body.runCouncil === false || body.runSeoAeoGeoCouncil === false) return false;
  return String(process.env.SEO_AEO_GEO_COUNCIL_RUN_AFTER_AUDIT || "true").trim().toLowerCase() !== "false";
}

async function maybeRunSeoAeoGeoCouncil({ result, payload, req }) {
  if (result?.job?.pipelineSessionId) return null;
  if (!result?.ok || result.status === "failed" || !shouldRunSeoAeoGeoCouncil(payload)) return null;
  const councilJob = await startAsyncAuditRouteJob({
    auditType: "seo-aeo-geo-council",
    payload: {
      sessionId: `seo-aeo-geo-council-after-${result.sessionId}`,
      sourceTrigger: "seo-aeo-geo-callback",
    },
    req,
    runner: runSeoAeoGeoCouncilReport,
    metadata: { route: "audits.seo-aeo-geo.callback.council" },
  });
  info("audit.seo-aeo-geo.council.accepted", {
    sessionId: result.sessionId,
    councilSessionId: councilJob.sessionId,
    statusUrl: councilJob.statusUrl,
  });
  return councilJob;
}

router.post("/callback", requireAuditCallbackAuth, asyncRoute(async (req, res) => {
  const parsed = validateBody(auditCallbackBodySchema, req.body);
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const result = await completeAuditRun({ auditType: AUDIT_TYPE, payload: parsed.data });
  const pipeline = await resumeWebsiteAuditPipelineFromChild({ auditType: AUDIT_TYPE, result });
  const councilJob = await maybeRunSeoAeoGeoCouncil({ result, payload: parsed.data, req });
  return res.json({ ...result, ...(pipeline ? { pipeline } : {}), ...(councilJob ? { councilJob } : {}) });
}));

router.get("/jobs/:sessionId", (req, res) => {
  const job = getAuditJob(AUDIT_TYPE, req.params.sessionId);
  if (!job) {
    return res.status(404).json({ ok: false, error: "Audit job not found" });
  }
  return res.json({ ok: true, auditType: AUDIT_TYPE, job });
});

export default router;
