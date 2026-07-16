// services/newsletter/routes/generate.js
import express from "express";
import { buildNewsletter } from "../engine/buildNewsletter.js";
import { hookdeckDedupe } from "../../shared/utils/hookdeckDedupe.js";
import { validateBody, newsletterGenerateBodySchema } from "../../shared/utils/requestSchemas.js";
import {
  getAsyncServiceRouteJobFresh,
  shouldRunAsyncServiceRoute,
  startAsyncServiceRouteJob,
} from "../../shared/utils/asyncServiceRouteJobs.js";

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// GET /newsletter/jobs/:lane/:sessionId — poll an async build job. MAST (in
// its own repository) is expected to call POST /generate on a schedule and
// poll this endpoint until the job completes.
router.get("/jobs/:lane/:sessionId", asyncRoute(async (req, res) => {
  const job = await getAsyncServiceRouteJobFresh("newsletter", req.params.lane, req.params.sessionId, req);
  if (!job) {
    return res.status(404).json({
      ok: false, service: "newsletter", error: "Newsletter async job not found",
      lane: req.params.lane, sessionId: req.params.sessionId,
    });
  }
  return res.json(job);
}));

// POST /newsletter/generate — build one issue for a profile (default: ai-edge).
router.post("/generate", hookdeckDedupe("newsletter:generate"), asyncRoute(async (req, res) => {
  const parsed = validateBody(newsletterGenerateBodySchema, req.body);
  if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error });

  const { profileId, sessionId } = parsed.data;

  if (shouldRunAsyncServiceRoute(req)) {
    const job = await startAsyncServiceRouteJob({
      service: "newsletter",
      lane: "generate",
      payload: { profileId, sessionId },
      req,
      runner: (payload) => buildNewsletter({ profileId: payload.profileId, sessionId: payload.sessionId }),
      metadata: { route: "/newsletter/generate" },
    });
    return res.status(202).json(job);
  }

  const result = await buildNewsletter({ profileId, sessionId });
  if (!result?.ok) return res.status(result?.quarantined ? 422 : 500).json(result);
  return res.json(result);
}));

export default router;
