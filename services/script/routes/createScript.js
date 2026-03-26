// services/script/routes/createScript.js

import express from "express";
import crypto from "crypto";
import { orchestrateEpisode } from "../utils/orchestrator.js";
import { sanitizeSessionId } from "../../shared/utils/sessionId.js";
import { error } from "../../../logger.js";

const router = express.Router();

router.post("/create-script", async (req, res) => {
  const sessionId = sanitizeSessionId(req.body?.sessionId || crypto.randomUUID(), "TT");

  try {
    const result = await orchestrateEpisode({ sessionId });
    res.status(200).json({ ok: true, sessionId, ...result });
  } catch (err) {
    error("script.create.fail", { sessionId, error: err?.stack || err?.message });
    res.status(500).json({
      ok: false,
      error: "Script generation failed",
      details: err.message,
    });
  }
});

export default router;
