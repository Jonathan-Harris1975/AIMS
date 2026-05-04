import { beginJob, completeJob, failJob, flushJobStoreWrites, getPublicJob, getPublicJobFresh } from "../../services/shared/utils/jobStore.js";
import { runSeoAeoGeoAnalysis } from "./seoAeoGeoAnalysis.js";
import { error as logError, info } from "../../logger.js";

const JOB_TYPE = "audit:seo-aeo-geo:analysis";

function sessionFromPayload(payload) {
  return String(payload?.sessionId || "").trim();
}

function resolveAnalysisPayload(job) {
  if (!job) return undefined;
  if (job.analysis && typeof job.analysis === "object") return job.analysis;
  if (job.result?.analysis && typeof job.result.analysis === "object") return job.result.analysis;
  if (job.result && typeof job.result === "object" && !Array.isArray(job.result)) {
    const looksLikeAnalysis = Boolean(job.result.auditCompletionState || job.result.aiAnalysisStatus || job.result.rankedIssueLedger || job.result.issues);
    if (looksLikeAnalysis) return job.result;
  }
  return undefined;
}

function publicShape(job) {
  if (!job) return null;
  const analysis = resolveAnalysisPayload(job);
  return {
    ok: true,
    auditType: "seo-aeo-geo",
    sessionId: job.sessionId,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    attempt: job.attempt,
    analysis,
    result: job.result,
    hasAnalysis: Boolean(analysis && Object.keys(analysis).length),
    error: job.error,
  };
}

async function executeAnalysisJob(payload) {
  const sessionId = sessionFromPayload(payload);
  try {
    const analysis = await runSeoAeoGeoAnalysis(payload);
    const completed = completeJob(JOB_TYPE, sessionId, {
      analysis,
      result: { analysis },
      routeCount: payload?.allRoutes?.length ?? 0,
      coverageCount: payload?.coverage?.length ?? 0,
    });
    info("audit.seo-aeo-geo.analysis.completed", {
      sessionId,
      issueCount: Array.isArray(analysis?.issues) ? analysis.issues.length : 0,
    });
    return completed;
  } catch (err) {
    const failed = failJob(JOB_TYPE, sessionId, err, {
      routeCount: payload?.allRoutes?.length ?? 0,
      coverageCount: payload?.coverage?.length ?? 0,
    });
    logError("audit.seo-aeo-geo.analysis.failed", {
      sessionId,
      routeCount: payload?.allRoutes?.length ?? 0,
      coverageCount: payload?.coverage?.length ?? 0,
      message: err?.message || String(err),
      status: err?.status,
      code: err?.code,
      attemptedProviders: err?.attemptedProviders,
    });
    return failed;
  }
}

export async function runSeoAeoGeoAnalysisJob(payload) {
  const sessionId = sessionFromPayload(payload);
  if (!sessionId) throw new Error("Cannot run SEO/AEO/GEO analysis job without sessionId");

  const { started, job } = beginJob(JOB_TYPE, sessionId, {
    routeCount: payload?.allRoutes?.length ?? 0,
    coverageCount: payload?.coverage?.length ?? 0,
  });

  if (!started) {
    return publicShape(job);
  }

  const finished = await executeAnalysisJob(payload);
  await flushSeoAeoGeoAnalysisJobs();
  return publicShape(finished);
}

export function startSeoAeoGeoAnalysisJob(payload) {
  const sessionId = sessionFromPayload(payload);
  if (!sessionId) throw new Error("Cannot start SEO/AEO/GEO analysis job without sessionId");
  const { started, job } = beginJob(JOB_TYPE, sessionId, {
    routeCount: payload?.allRoutes?.length ?? 0,
    coverageCount: payload?.coverage?.length ?? 0,
  });
  if (started) {
    Promise.resolve()
      .then(() => executeAnalysisJob(payload))
      .catch((err) => {
        logError("audit.seo-aeo-geo.analysis.unhandled", {
          sessionId,
          message: err?.message || String(err),
        });
      });
  }
  return publicShape(job);
}

export function getSeoAeoGeoAnalysisJob(sessionId) {
  return publicShape(getPublicJob(JOB_TYPE, sessionId));
}

export async function getSeoAeoGeoAnalysisJobFresh(sessionId) {
  return publicShape(await getPublicJobFresh(JOB_TYPE, sessionId));
}

export async function flushSeoAeoGeoAnalysisJobs(options = {}) {
  return flushJobStoreWrites(options);
}

export default {
  runSeoAeoGeoAnalysisJob,
  startSeoAeoGeoAnalysisJob,
  getSeoAeoGeoAnalysisJob,
  getSeoAeoGeoAnalysisJobFresh,
  flushSeoAeoGeoAnalysisJobs,
};
