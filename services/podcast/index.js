// services/podcast/index.js
import express from "express";
import { runPodcastPipeline } from "./runPodcastPipeline.js";
import { sanitizeSessionId } from "../shared/utils/sessionId.js";
import { hookdeckDedupe } from "../shared/utils/hookdeckDedupe.js";
import { getJob, beginJob, completeJob, failJob } from "../shared/utils/jobStore.js";
import { validateBody, podcastRunBodySchema } from "../shared/utils/requestSchemas.js";
import { info, error } from "../../logger.js";

const router = express.Router();

router.post("/run", hookdeckDedupe("podcast:run"), async (req, res) => {
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const parsed = validateBody(podcastRunBodySchema, body);
    if (!parsed.ok) {
      return res.status(400).json({ ok: false, error: parsed.error });
    }

    const payload = parsed.data;
    const sessionId = sanitizeSessionId(
      payload.sessionId || payload.data?.sessionId || `TT-${new Date().toISOString().slice(0, 10)}`,
      "TT"
    );
    const eventId = req.hookdeckEventId || null;

    info("api.podcast.start", { sessionId, eventId });

    const { started, job } = beginJob("podcast", sessionId, {
      eventId,
      route: "podcast.run",
    });

    if (!started) {
      return res.status(202).json({
        ok: true,
        duplicateJob: true,
        sessionId,
        status: job?.status || "running",
        statusUrl: `/podcast/status/${encodeURIComponent(sessionId)}`,
        message: "Podcast pipeline already running for this session.",
        job,
      });
    }

    void runPodcastPipeline(sessionId)
      .then((result) => {
        completeJob("podcast", sessionId, { eventId, result });
        info("api.podcast.complete", { sessionId, eventId });
      })
      .catch((err) => {
        failJob("podcast", sessionId, err, { eventId });
        error("api.podcast.error", { sessionId, eventId, error: err.message });
      });

    res.json({
      ok: true,
      sessionId,
      status: "running",
      statusUrl: `/podcast/status/${encodeURIComponent(sessionId)}`,
      message: "Pipeline started. Use the status endpoint or logs to track progress.",
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get("/status/:sessionId", (req, res) => {
  const sessionId = sanitizeSessionId(req.params.sessionId, "TT");
  const job = getJob("podcast", sessionId);

  if (!job) {
    return res.status(404).json({ ok: false, error: "No podcast job found", sessionId });
  }

  return res.json({ ok: true, job });
});

router.get("/health", (_req, res) =>
  res.json({ ok: true, service: "podcast", time: new Date().toISOString() })
);

export default router;
