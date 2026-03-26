import express from "express";
import { getObject } from "../services/shared/utils/r2-client.js";
import { endToEndRewrite } from "../services/rss-feed-creator/rewrite-pipeline.js";

const router = express.Router();

/**
 * Handles both GET (fetch RSS) and POST (rebuild RSS feed)
 */
router.all("/", async (req, res) => {
  const isPost = req.method === "POST";

  if (!isPost) {
    try {
      const xml = await getObject("rss", "feed.xml");
      res.set("Content-Type", "application/rss+xml");
      res.send(xml || "<rss><channel><title>No RSS Found</title></channel></rss>");
    } catch (err) {
      res.status(500).json({
        ok: false,
        route: "rss",
        message: "Failed to fetch RSS feed.",
        error: err.message,
      });
    }
  } else {
    try {
      const result = await endToEndRewrite();
      res.status(200).json({
        ok: true,
        route: "rss",
        message: "RSS feed rebuild completed successfully.",
        result,
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        route: "rss",
        message: "RSS feed rebuild failed.",
        error: error.message,
      });
    }
  }
});

export default router;
