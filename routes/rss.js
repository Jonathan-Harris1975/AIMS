import express from "express";
import { getObjectAsText } from "../services/shared/utils/r2-client.js";
import { endToEndRewrite } from "../services/rss-feed-creator/rewrite-pipeline.js";

const router = express.Router();
const RSS_OBJECT_KEY = process.env.RSS_OBJECT_KEY || "rss.xml";

router.get("/", async (_req, res) => {
  try {
    const xml = await getObjectAsText("rss", RSS_OBJECT_KEY);
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
});

router.post("/", async (_req, res) => {
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
});

export default router;
