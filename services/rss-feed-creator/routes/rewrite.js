import express from "express";
import { endToEndRewrite } from "../rewrite-pipeline.js";
import { info, error } from "../../../logger.js";
import { hookdeckDedupe } from "../../shared/utils/hookdeckDedupe.js";

const router = express.Router();

function sendRouteError(req, res, fallbackMessage = "Internal error") {
  const requestId = req?.id || req?.headers?.["x-request-id"] || null;
  return res.status(500).json({ ok: false, error: fallbackMessage, requestId });
}

router.post("/rewrite", hookdeckDedupe("rss:rewrite"), async (req, res) => {
  try {
    info("rewrite.route.start");

    const result = await endToEndRewrite();

    info("rewrite.route.complete", { result });

    res.json({
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
});

export default router;
