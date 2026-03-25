// ============================================================
// 🎙 TTS Router — Handles TTS orchestration API endpoints
//  - Returns immediately to avoid request timeouts
//  - Runs the long job detached from the HTTP lifecycle
// ============================================================

import express from "express";
import { info, error } from "../../../logger.js";
import { sanitizeSessionId } from "../../shared/utils/sessionId.js";
import { orchestrateTTS } from "../index.js";

const router = express.Router();

// Health
router.get("/health", (_req, res) => res.json({ ok: true, service: "tts" }));

/**
 * POST /tts/orchestrate
 * body: { sessionId?: string }
 */
router.post("/orchestrate", async (req, res) => {
  let sessionId;

  try {
    sessionId = sanitizeSessionId(req.body?.sessionId || `TT-${Date.now()}`, "TT");
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }

  // Defensively ensure we never inherit a slow server timeout
  if (typeof req.setTimeout === "function") {
    req.setTimeout(0); // unlimited for proxies that respect it
  }

  // Respond immediately
  res.json({ ok: true, message: "TTS orchestration started", sessionId });

  // Run the heavy work out-of-band
  (async () => {
    try {
      info("🏁 Detached TTS job started", { sessionId });
      await orchestrateTTS(sessionId);
      info("🏁 Detached TTS job completed", { sessionId });
    } catch (err) {
      error("💥 Detached TTS job failed", { sessionId, error: err?.stack || err?.message });
    }
  })();
});

export default router;
