import express from "express";
import { hookdeckDedupe } from "../../services/shared/utils/hookdeckDedupe.js";
import { validateBody, auditCallbackBodySchema, auditRunBodySchema } from "../../services/shared/utils/requestSchemas.js";
import { completeAuditRun, getAuditJob, startAuditRun } from "../utils/orchestrator.js";
import { requireAuditCallbackAuth } from "../utils/callbackAuth.js";
import { runMobileUxCouncilReport } from "../utils/mobileUxCouncil.js";
import { info } from "../../logger.js";

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const AUDIT_TYPE = "mobile-ux";
const WORKFLOW_ID = "mobile-ux-hard-gate.yml";

router.get("/health", (_req, res) => {
  res.json({ ok: true, auditType: AUDIT_TYPE, workflowId: WORKFLOW_ID, time: new Date().toISOString() });
});

router.post("/run", hookdeckDedupe("audits:mobile-ux:run"), asyncRoute(async (req, res) => {
  const parsed = validateBody(auditRunBodySchema, req.body);
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const result = await startAuditRun({
    auditType: AUDIT_TYPE,
    workflowId: WORKFLOW_ID,
    body: parsed.data,
    callbackPath: "/audits/mobile-ux/callback",
  });

  return res.status(202).json(result);
}));

function shouldRunMobileUxCouncil(body = {}) {
  if (body.runCouncil === true || body.runMobileUxCouncil === true) return true;
  if (body.runCouncil === false || body.runMobileUxCouncil === false) return false;
  return String(process.env.MOBILE_UX_COUNCIL_RUN_AFTER_AUDIT || "true").trim().toLowerCase() !== "false";
}

async function maybeRunMobileUxCouncil({ result, payload }) {
  if (!result?.ok || result.status === "failed" || !shouldRunMobileUxCouncil(payload)) return null;
  try {
    return await runMobileUxCouncilReport({
      sessionId: `mobile-ux-council-after-${result.sessionId}`,
      sourceTrigger: "mobile-ux-callback",
    });
  } catch (error) {
    info("audit.mobile-ux.council.failed", {
      sessionId: result.sessionId,
      error: error?.message || String(error),
    });
    return { ok: false, auditType: "mobile-ux-council", error: error?.message || String(error) };
  }
}

router.post("/callback", requireAuditCallbackAuth, asyncRoute(async (req, res) => {
  const parsed = validateBody(auditCallbackBodySchema, req.body);
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const result = await completeAuditRun({ auditType: AUDIT_TYPE, payload: parsed.data });
  const council = await maybeRunMobileUxCouncil({ result, payload: parsed.data });
  return res.json(council ? { ...result, council } : result);
}));

router.get("/jobs/:sessionId", (req, res) => {
  const job = getAuditJob(AUDIT_TYPE, req.params.sessionId);
  if (!job) {
    return res.status(404).json({ ok: false, error: "Audit job not found" });
  }
  return res.json({ ok: true, auditType: AUDIT_TYPE, job });
});

export default router;
