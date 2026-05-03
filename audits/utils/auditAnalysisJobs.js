import { beginJob, completeJob, failJob, getPublicJob } from "../../services/shared/utils/jobStore.js";
import { runSeoAeoGeoAnalysis } from "./seoAeoGeoAnalysis.js";
import { error as logError, info } from "../../logger.js";

const JOB_TYPE = "audit:seo-aeo-geo:analysis";

function sessionFromPayload(payload) {
  return String(payload?.sessionId || "").trim();
}

function publicShape(job) {
  if (!job) return null;
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
    analysis: job.result?.analysis,
    error: job.error,
  };
}

async function executeAnalysisJob(payload) {
  const sessionId = sessionFromPayload(payload);
  try {
    const analysis = await runSeoAeoGeoAnalysis(payload);
    const completed = completeJob(JOB_TYPE, sessionId, {
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

export default { startSeoAeoGeoAnalysisJob, getSeoAeoGeoAnalysisJob };
