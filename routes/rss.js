import express from "express";
import { getObjectAsText } from "../services/shared/utils/r2-client.js";
import { endToEndRewrite } from "../services/rss-feed-creator/rewrite-pipeline.js";
import { error } from "../logger.js";
import { requestDedupe } from "../services/shared/utils/requestDedupe.js";
import {
  getAsyncServiceRouteJobFresh,
  shouldRunAsyncServiceRoute,
  startAsyncServiceRouteJob,
} from "../services/shared/utils/asyncServiceRouteJobs.js";

const router = express.Router();
const RSS_OBJECT_KEY = process.env.RSS_OBJECT_KEY || "feed.xml";
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function requestIdFor(req) {
  return req?.id || req?.headers?.["x-request-id"] || null;
}

function rssRewritePayload(req) {
  const body = req?.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  return {
    ...body,
    sessionId: body.sessionId || req?.idempotencyKey || req?.headers?.["x-request-id"] || req?.id,
  };
}

async function startRssRewriteJob(req) {
  return startAsyncServiceRouteJob({
    service: "rss",
    lane: "rewrite",
    payload: rssRewritePayload(req),
    req,
    runner: () => endToEndRewrite(),
    metadata: { route: req?.originalUrl || "/rss" },
  });
}

router.get("/", asyncRoute(async (req, res) => {
  try {
    const xml = await getObjectAsText("rss", RSS_OBJECT_KEY);
    res.set("Content-Type", "application/rss+xml");
    res.send(xml || "<rss><channel><title>No RSS Found</title></channel></rss>");
  } catch (err) {
    const requestId = requestIdFor(req);
    error("rss.fetch.fail", {
      requestId,
      error: err?.stack || err?.message || String(err),
      rssObjectKey: RSS_OBJECT_KEY,
    });

    res.status(500).json({
      ok: false,
      route: "rss",
      message: "Failed to fetch RSS feed.",
      requestId,
    });
  }
}));

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

router.post("/", requestDedupe("rss:rebuild"), asyncRoute(async (req, res) => {
  if (shouldRunAsyncServiceRoute(req)) {
    const job = await startRssRewriteJob(req);
    return res.status(202).json({
      ...job,
      route: "rss",
      message: "RSS feed rebuild accepted. Poll the status URL for completion.",
    });
  }

  try {
    const result = await endToEndRewrite();
    return res.status(200).json({
      ok: true,
      route: "rss",
      message: "RSS feed rebuild completed successfully.",
      result,
    });
  } catch (err) {
    const requestId = requestIdFor(req);
    error("rss.rebuild.fail", {
      requestId,
      error: err?.stack || err?.message || String(err),
    });

    return res.status(500).json({
      ok: false,
      route: "rss",
      message: "RSS feed rebuild failed.",
      requestId,
    });
  }
}));

export default router;
