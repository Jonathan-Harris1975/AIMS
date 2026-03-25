// services/script/routes/index.js

import express from "express";
import { info, error } from "../../../logger.js";
import { sanitizeSessionId } from "../../shared/utils/sessionId.js";
import {
  generateIntro,
  generateMain,
  generateOutro,
  generateComposedEpisode,
} from "../utils/models.js";
import { orchestrateEpisode } from "../utils/orchestrator.js";

const router = express.Router();

function normalizePayload(body = {}) {
  if (!body || typeof body !== "object") {
    return {};
  }

  const payload = { ...body };

  if (payload.sessionId !== undefined) {
    payload.sessionId = sanitizeSessionId(payload.sessionId, "TT");
  }

  return payload;
}

// ─────────────────────────────
//  HEALTH CHECK
// ─────────────────────────────
router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "script" });
});

// ─────────────────────────────
//  INTRO
// ─────────────────────────────
router.post("/intro", async (req, res) => {
  try {
    const payload = normalizePayload(req.body);
    info("script.intro.req", { date: payload.date, sessionId: payload.sessionId });
    const result = await generateIntro(payload);
    res.json({ ok: true, text: result });
  } catch (err) {
    error("script.intro.fail", { err: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
//  MAIN
// ─────────────────────────────
router.post("/main", async (req, res) => {
  try {
    const payload = normalizePayload(req.body);
    info("script.main.req", { date: payload.date, sessionId: payload.sessionId });
    const result = await generateMain(payload);
    res.json({ ok: true, text: result });
  } catch (err) {
    error("script.main.fail", { err: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
//  OUTRO
// ─────────────────────────────
router.post("/outro", async (req, res) => {
  try {
    const payload = normalizePayload(req.body);
    info("script.outro.req", { date: payload.date, sessionId: payload.sessionId });
    const result = await generateOutro(payload);
    res.json({ ok: true, text: result });
  } catch (err) {
    error("script.outro.fail", { err: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
//  COMPOSE
// ─────────────────────────────
router.post("/compose", async (req, res) => {
  try {
    const payload = normalizePayload(req.body);
    info("script.compose.req", { date: payload.date, sessionId: payload.sessionId });
    const result = await generateComposedEpisode(payload);
    res.json({ ok: true, ...result });
  } catch (err) {
    error("script.compose.fail", { err: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────
//  ORCHESTRATE (FULL PIPELINE)
// ─────────────────────────────
router.post("/orchestrate", async (req, res) => {
  try {
    const payload = normalizePayload(req.body);
    info("script.orchestrate.req", { date: payload.date, sessionId: payload.sessionId });
    const result = await orchestrateEpisode(payload);
    res.json(result);
  } catch (err) {
    error("script.orchestrate.fail", { err: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
