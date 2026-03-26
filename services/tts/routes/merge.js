// services/merge/routes/merge.js
// ============================================================
// 🎧 Merge Route (webhook-free version)
// POST /merge  { sessionId }
// ============================================================

import express from "express";
import { mergeChunks } from "../utils/audio.js";
import { log } from "../../../logger.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId) {
    return res.status(400).json({ ok: false, error: "sessionId is required" });
  }

  try {
    log.info(`🎧 Merge requested for session: ${sessionId}`);

    const result = await mergeChunks(sessionId);

    try {
      const { editingProcessor } = await import("../utils/editingProcessor.js");
      await editingProcessor(sessionId, result?.key || result?.localPath || result?.path);
      log.info(`🎬 Local edit pipeline triggered for ${sessionId}`);
    } catch (err) {
      log.warn(`⚠️ Edit pipeline not available for ${sessionId}: ${err.message}`);
    }

    res.json({ ok: true, ...result });
  } catch (err) {
    log.error("merge failed", { sessionId, err: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
