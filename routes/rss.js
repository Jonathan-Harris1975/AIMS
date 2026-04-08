import express from "express";
import { getObjectAsText } from "../services/shared/utils/r2-client.js";
import { endToEndRewrite } from "../services/rss-feed-creator/rewrite-pipeline.js";
import { error } from "../logger.js";

const router = express.Router();
const RSS_OBJECT_KEY = process.env.RSS_OBJECT_KEY || "feed.xml";

function requestIdFor(req) {
  return req?.id || req?.headers?.["x-request-id"] || null;
}

router.get("/", async (req, res) => {
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
});

router.post("/", async (req, res) => {
  try {
    const result = await endToEndRewrite();
    res.status(200).json({
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

    res.status(500).json({
      ok: false,
      route: "rss",
      message: "RSS feed rebuild failed.",
      requestId,
    });
  }
});

export default router;
