import express from "express";
import { endToEndRewrite } from "../rewrite-pipeline.js";
import { info, error } from "../../../logger.js";
import { hookdeckDedupe } from "../../shared/utils/hookdeckDedupe.js";
import {
  getAsyncServiceRouteJobFresh,
  shouldRunAsyncServiceRoute,
  startAsyncServiceRouteJob,
} from "../../shared/utils/asyncServiceRouteJobs.js";

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function sendRouteError(req, res, fallbackMessage = "Internal error") {
  const requestId = req?.id || req?.headers?.["x-request-id"] || null;
  return res.status(500).json({ ok: false, error: fallbackMessage, requestId });
}


function rssRewritePayload(req) {
  const body = req?.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  return {
    ...body,
    sessionId: body.sessionId || req?.hookdeckEventId || req?.headers?.["x-request-id"] || req?.id,
  };
}

async function startRssRewriteJob(req) {
  return startAsyncServiceRouteJob({
    service: "rss",
    lane: "rewrite",
    payload: rssRewritePayload(req),
    req,
    runner: () => endToEndRewrite(),
    metadata: { route: "/rss/rewrite" },
  });
}

router.get("/jobs/:lane/:sessionId", asyncRoute(async (req, res) => {
  const job = await getAsyncServiceRouteJobFresh("rss", req.params.lane, req.params.sessionId, req);
  if (!job) {
    return res.status(404).json({
      ok: false,
      service: "rss",
      lane: req.params.lane,
      sessionId: req.params.sessionId,
      error: "RSS async job not found",
    });
  }

  return res.json(job);
}));

router.post("/rewrite", hookdeckDedupe("rss:rewrite"), asyncRoute(async (req, res) => {
  try {
    info("rewrite.route.start");

    if (shouldRunAsyncServiceRoute(req)) {
      const job = await startRssRewriteJob(req);
      info("rewrite.route.accepted", { sessionId: job.sessionId, statusUrl: job.statusUrl });
      return res.status(202).json({
        ...job,
        totalItems: 0,
        rewrittenItems: 0,
        message: "RSS rewrite process accepted. Poll the status URL for completion.",
      });
    }

    const result = await endToEndRewrite();

    info("rewrite.route.complete", { result });

    return res.json({
      ok: true,
      totalItems: result?.totalItems || 0,
      rewrittenItems: result?.rewrittenItems || 0,
      message: "RSS rewrite process completed successfully",
    });
  } catch (err) {
    error("rewrite.route.error", {
      requestId: req?.id || req?.headers?.["x-request-id"] || null,
      error: err?.stack || err?.message || String(err),
    });
    return sendRouteError(req, res, "Rewrite route failed");
  }
}));

export default router;
