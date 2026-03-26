import express from "express";
import { info, error } from "../../../logger.js";
import { sanitizeSessionId } from "../../shared/utils/sessionId.js";
import { hookdeckDedupe } from "../../shared/utils/hookdeckDedupe.js";
import { getJob, beginJob, completeJob, failJob } from "../../shared/utils/jobStore.js";
import { validateBody, ttsOrchestrateBodySchema } from "../../shared/utils/requestSchemas.js";
import { orchestrateTTS } from "../index.js";

const router = express.Router();

router.get("/health", (_req, res) => res.json({ ok: true, service: "tts" }));

router.get("/status/:sessionId", (req, res) => {
  const sessionId = sanitizeSessionId(req.params.sessionId, "TT");
  const job = getJob("tts", sessionId);

  if (!job) {
    return res.status(404).json({ ok: false, error: "No TTS job found", sessionId });
  }

  return res.json({ ok: true, job });
});

router.post("/orchestrate", hookdeckDedupe("tts:orchestrate"), async (req, res) => {
  const parsed = validateBody(ttsOrchestrateBodySchema, req.body);
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const sessionId = sanitizeSessionId(parsed.data.sessionId || `TT-${Date.now()}`, "TT");
  const eventId = req.hookdeckEventId || null;

  if (typeof req.setTimeout === "function") {
    req.setTimeout(0);
  }

  const { started, job } = beginJob("tts", sessionId, {
    eventId,
    route: "tts.orchestrate",
  });

  if (!started) {
    return res.status(202).json({
      ok: true,
      duplicateJob: true,
      message: "TTS orchestration already running for this session",
      sessionId,
      status: job?.status || "running",
      statusUrl: `/tts/status/${encodeURIComponent(sessionId)}`,
      job,
    });
  }

  res.status(202).json({
    ok: true,
    message: "TTS orchestration started",
    sessionId,
    status: "running",
    statusUrl: `/tts/status/${encodeURIComponent(sessionId)}`,
  });

  void (async () => {
    try {
      info("tts.job.start", { sessionId, eventId });
      const result = await orchestrateTTS(sessionId);
      if (!result?.ok) {
        throw new Error(result?.error || "TTS orchestration failed");
      }
      completeJob("tts", sessionId, {
        eventId,
        result,
      });
      info("tts.job.complete", { sessionId, eventId });
    } catch (err) {
      failJob("tts", sessionId, err, { eventId });
      error("tts.job.fail", { sessionId, eventId, error: err?.stack || err?.message });
    }
  })();
});

export default router;
