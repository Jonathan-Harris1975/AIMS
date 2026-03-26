// services/merge/routes/merge.js
// ============================================================
// 🎧 Merge Route (webhook-free version)
// POST /merge  { sessionId }
// ============================================================

import express from "express";
import { mergeChunks } from "../utils/audio.js";
import { log } from "../../../logger.js";
import { uploadBuffer, getObjectAsText } from "../../shared/utils/r2-client.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }

  try {
    log.info(`🎧 Merge requested for session: ${sessionId}`);

    // Merge all chunks into one audio file
    const result = await mergeChunks(sessionId);

    // 🔄 Directly trigger the local edit processor instead of webhook
    try {
      const { editingProcessor } = await import("../utils/editingProcessor.js");
      await editingProcessor(sessionId, result?.key || result?.localPath || result?.path);
      log.info(`🎬 Local edit pipeline triggered for ${sessionId}`);
    } catch (err) {
      log.warn(`⚠️ Edit pipeline not available for ${sessionId}: ${err.message}`);
    }

    res.json({ success: true, ...result });
  } catch (err) {
    log.error("merge failed", { sessionId, err: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
