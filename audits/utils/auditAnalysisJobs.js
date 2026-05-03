import { error as logError, info } from "../../logger.js";
import {
  beginJob,
  completeJob,
  failJob,
  getPublicJob,
} from "../../services/shared/utils/jobStore.js";
import { runSeoAeoGeoAnalysis } from "./seoAeoGeoAnalysis.js";

const JOB_TYPE = "audit-analysis:seo-aeo-geo";
const activeJobs = new Set();

function safeSessionId(payload) {
  return String(payload?.sessionId || "").trim();
}

function publicJob(sessionId) {
  return getPublicJob(JOB_TYPE, sessionId);
}

async function runInBackground(payload) {
  const sessionId = safeSessionId(payload);
  activeJobs.add(sessionId);

  try {
    info("audit.seo-aeo-geo.analysis.job.started", {
      sessionId,
      routeCount: Array.isArray(payload?.allRoutes) ? payload.allRoutes.length : 0,
      coverageCount: Array.isArray(payload?.coverage) ? payload.coverage.length : 0,
    });

    const analysis = await runSeoAeoGeoAnalysis(payload);

    completeJob(JOB_TYPE, sessionId, {
      auditType: "seo-aeo-geo",
      result: { analysis },
      analysis,
      issueCount: Array.isArray(analysis?.issues) ? analysis.issues.length : 0,
    });

    info("audit.seo-aeo-geo.analysis.job.completed", {
      sessionId,
      issueCount: Array.isArray(analysis?.issues) ? analysis.issues.length : 0,
    });
  } catch (err) {
    failJob(JOB_TYPE, sessionId, err, {
      auditType: "seo-aeo-geo",
      routeCount: Array.isArray(payload?.allRoutes) ? payload.allRoutes.length : 0,
      coverageCount: Array.isArray(payload?.coverage) ? payload.coverage.length : 0,
    });

    logError("audit.seo-aeo-geo.analysis.job.failed", {
      sessionId,
      routeCount: Array.isArray(payload?.allRoutes) ? payload.allRoutes.length : 0,
      coverageCount: Array.isArray(payload?.coverage) ? payload.coverage.length : 0,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    activeJobs.delete(sessionId);
  }
}

export function startSeoAeoGeoAnalysisJob(payload) {
  const sessionId = safeSessionId(payload);
  if (!sessionId) {
    throw new Error("sessionId is required to start SEO/AEO/GEO analysis");
  }

  const existing = publicJob(sessionId);
  if (existing?.status === "completed" || existing?.status === "failed") {
    return { started: false, job: existing };
  }

  const { started, job } = beginJob(JOB_TYPE, sessionId, {
    auditType: "seo-aeo-geo",
    routeCount: Array.isArray(payload?.allRoutes) ? payload.allRoutes.length : 0,
    coverageCount: Array.isArray(payload?.coverage) ? payload.coverage.length : 0,
  });

  if ((started || ["queued", "running"].includes(job?.status)) && !activeJobs.has(sessionId)) {
    setImmediate(() => {
      runInBackground(payload).catch((err) => {
        logError("audit.seo-aeo-geo.analysis.job.unhandled", {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });
  }

  return { started, job: publicJob(sessionId) || job };
}

export function getSeoAeoGeoAnalysisJob(sessionId) {
  return publicJob(String(sessionId || "").trim());
}

export default {
  startSeoAeoGeoAnalysisJob,
  getSeoAeoGeoAnalysisJob,
};
