/**
 * rewrite.js
 * Handles POST /rss/rewrite — fetches, rewrites, and regenerates the RSS feed.
 */

import express from "express";
import { endToEndRewrite } from "../rewrite-pipeline.js";
import { info, error, debug } from "../../../logger.js";

const router = express.Router();

router.post("/rewrite", async (req, res) => {
  try {
    info("rewrite.route.start");

    // Execute rewrite pipeline
    const result = await endToEndRewrite();

    info("rewrite.route.complete", { result });

    res.json({
      status: "ok",
      message: "RSS rewrite process triggered successfully",
      totalItems: result?.totalItems || 0,
      rewrittenItems: result?.rewrittenItems || 0,
    });
  } catch (err) {
    error("rewrite.route.error", err);
    res.status(500).json({ error: err.message || "Rewrite route failed" });
  }
});

// ✅ Default export for Express loader compatibility
export default router;
