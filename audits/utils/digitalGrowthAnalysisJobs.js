import {
  beginJob,
  completeJob,
  failJob,
  flushJobStoreWrites,
  getPublicJobFresh,
} from "../../services/shared/utils/jobStore.js";
import { runDigitalGrowthAnalysis } from "./digitalGrowthAnalysis.js";
import { error as logError, info } from "../../logger.js";

const JOB_TYPE = "audit:digital-growth:analysis";

function sessionFromPayload(payload) {
  return String(payload?.sessionId || "").trim();
}

function resolveAnalysisPayload(job) {
  if (!job) return undefined;
  if (job.analysis && typeof job.analysis === "object") return job.analysis;
  if (job.result?.analysis && typeof job.result.analysis === "object") return job.result.analysis;
  return undefined;
}

function publicShape(job) {
  if (!job) return null;
  const analysis = resolveAnalysisPayload(job);
  return {
    ok: job.status !== "failed",
    auditType: "digital-growth",
    sessionId: job.sessionId,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    attempt: job.attempt,
    analysis,
    hasAnalysis: Boolean(analysis && Object.keys(analysis).length),
    error: job.error,
  };
}

async function executeAnalysisJob(payload) {
  const sessionId = sessionFromPayload(payload);
  try {
    const analysis = await runDigitalGrowthAnalysis(payload);
    const completed = completeJob(JOB_TYPE, sessionId, {
      analysis,
      result: { analysis },
      routeCount: payload?.allRoutes?.length ?? 0,
      priorityPageCount: payload?.priorityPages?.length ?? 0,
      auditCompletionState: analysis?.auditCompletionState || null,
      fallbackUsed: Boolean(analysis?.diagnostics?.fallbackUsed),
      repairUsed: Boolean(analysis?.diagnostics?.repairUsed),
      inputCharacters: analysis?.diagnostics?.inputCharacters ?? null,
      rawResponseCharacters: analysis?.diagnostics?.rawResponseCharacters ?? null,
    });
    await flushJobStoreWrites({ throwOnError: false });
    info("audit.digital-growth.analysis.completed", {
      sessionId,
      auditCompletionState: analysis?.auditCompletionState || null,
      findingCount: Array.isArray(analysis?.findings) ? analysis.findings.length : 0,
      fallbackUsed: Boolean(analysis?.diagnostics?.fallbackUsed),
      repairUsed: Boolean(analysis?.diagnostics?.repairUsed),
      inputCharacters: analysis?.diagnostics?.inputCharacters ?? null,
      rawResponseCharacters: analysis?.diagnostics?.rawResponseCharacters ?? null,
    });
    return completed;
  } catch (err) {
    const failed = failJob(JOB_TYPE, sessionId, err, {
      routeCount: payload?.allRoutes?.length ?? 0,
      priorityPageCount: payload?.priorityPages?.length ?? 0,
    });
    await flushJobStoreWrites({ throwOnError: false });
    logError("audit.digital-growth.analysis.failed", {
      sessionId,
      message: err?.message || String(err),
      status: err?.status,
      code: err?.code,
      attemptedProviders: err?.attemptedProviders,
    });
    return failed;
  }
}

export async function startDigitalGrowthAnalysisJob(payload) {
  const sessionId = sessionFromPayload(payload);
  if (!sessionId) throw new Error("Cannot start digital growth analysis job without sessionId");

  const existing = await getPublicJobFresh(JOB_TYPE, sessionId);
  if (existing?.status === "completed" && resolveAnalysisPayload(existing)) {
    return publicShape(existing);
  }

  const { started, job } = beginJob(JOB_TYPE, sessionId, {
    routeCount: payload?.allRoutes?.length ?? 0,
    priorityPageCount: payload?.priorityPages?.length ?? 0,
  });
  if (started) {
    Promise.resolve()
      .then(() => executeAnalysisJob(payload))
      .catch((err) => {
        logError("audit.digital-growth.analysis.unhandled", {
          sessionId,
          message: err?.message || String(err),
        });
      });
  }
  return publicShape(job);
}

export async function getDigitalGrowthAnalysisJobFresh(sessionId) {
  return publicShape(await getPublicJobFresh(JOB_TYPE, sessionId));
}

export async function flushDigitalGrowthAnalysisJobs(options = {}) {
  return flushJobStoreWrites(options);
}

export default {
  startDigitalGrowthAnalysisJob,
  getDigitalGrowthAnalysisJobFresh,
  flushDigitalGrowthAnalysisJobs,
};
