import express from "express";
import { hookdeckDedupe } from "../../services/shared/utils/hookdeckDedupe.js";
import { validateBody, onBrandAuditRunBodySchema } from "../../services/shared/utils/requestSchemas.js";
import { runOnBrandAudit } from "../utils/onBrandAudit.js";

const router = express.Router();
const AUDIT_TYPE = "on-brand";
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    auditType: AUDIT_TYPE,
    routes: ["GET /audits/on-brand/health", "POST /audits/on-brand/run"],
    time: new Date().toISOString(),
  });
});

router.post("/run", hookdeckDedupe("audits:on-brand:run"), asyncRoute(async (req, res) => {
  const parsed = validateBody(onBrandAuditRunBodySchema, req.body);
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, auditType: AUDIT_TYPE, error: parsed.error });
  }

  try {
    const result = await runOnBrandAudit(parsed.data);
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
