import express from "express";
import { info, error } from "../../../logger.js";
import { sanitizeSessionId } from "../../shared/utils/sessionId.js";
import { requestDedupe } from "../../shared/utils/requestDedupe.js";
import {
  generateIntro,
  generateMain,
  generateOutro,
  generateComposedEpisode,
} from "../utils/models.js";
import { orchestrateEpisode } from "../utils/orchestrator.js";
import {
  IntroSchema,
  MainSchema,
  OutroSchema,
  ComposeSchema,
  OrchestrateSchema,
  parseSchema,
} from "../utils/schemas.js";

const router = express.Router();

function normalizePayload(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {};
  }

  const payload = { ...body };
  payload.sessionId = sanitizeSessionId(
    payload.sessionId || `TT-${new Date().toISOString().slice(0, 10)}`,
    "TT"
  );

  return payload;
}

function validateOrThrow(schema, body) {
  const parsed = parseSchema(schema, body);
  if (!parsed.ok) {
    const err = new Error(parsed.error);
    err.statusCode = 400;
    throw err;
  }

  return normalizePayload(parsed.data);
}

function sendRouteError(req, res, err, fallbackMessage = "Internal error") {
  const statusCode = Number(err?.statusCode) || 500;
  const requestId = req?.id || req?.headers?.["x-request-id"] || null;
  const publicMessage = statusCode >= 500 ? fallbackMessage : err?.message || fallbackMessage;
  return res.status(statusCode).json({ ok: false, error: publicMessage, requestId });
}

router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "script" });
});

router.post("/intro", requestDedupe("script:intro"), async (req, res) => {
  try {
    const payload = validateOrThrow(IntroSchema, req.body);
    info("script.intro.req", { date: payload.date, sessionId: payload.sessionId });
    const result = await generateIntro(payload);
    res.json({ ok: true, sessionId: payload.sessionId, text: result });
  } catch (err) {
    error("script.intro.fail", { err: err.message });
    return sendRouteError(req, res, err, "Script intro failed");
  }
});

router.post("/main", requestDedupe("script:main"), async (req, res) => {
  try {
    const payload = validateOrThrow(MainSchema, req.body);
    info("script.main.req", { date: payload.date, sessionId: payload.sessionId });
    const result = await generateMain(payload);
    res.json({ ok: true, sessionId: payload.sessionId, text: result });
  } catch (err) {
    error("script.main.fail", { err: err.message });
    return sendRouteError(req, res, err, "Script main failed");
  }
});

router.post("/outro", requestDedupe("script:outro"), async (req, res) => {
  try {
    const payload = validateOrThrow(OutroSchema, req.body);
    info("script.outro.req", { date: payload.date, sessionId: payload.sessionId });
    const result = await generateOutro(payload);
    res.json({ ok: true, sessionId: payload.sessionId, text: result });
  } catch (err) {
    error("script.outro.fail", { err: err.message });
    return sendRouteError(req, res, err, "Script outro failed");
  }
});

router.post("/compose", requestDedupe("script:compose"), async (req, res) => {
  try {
    const payload = validateOrThrow(ComposeSchema, req.body);
    info("script.compose.req", { date: payload.date, sessionId: payload.sessionId });
    const result = await generateComposedEpisode(payload);
    res.json({ ok: true, sessionId: payload.sessionId, ...result });
  } catch (err) {
    error("script.compose.fail", { err: err.message });
    return sendRouteError(req, res, err, "Script compose failed");
  }
});

router.post("/orchestrate", requestDedupe("script:orchestrate"), async (req, res) => {
  try {
    const payload = validateOrThrow(OrchestrateSchema, req.body);
    info("script.orchestrate.req", { date: payload.date, sessionId: payload.sessionId });
    const result = await orchestrateEpisode(payload);
    res.json({ ok: true, sessionId: payload.sessionId, ...result });
  } catch (err) {
    error("script.orchestrate.fail", { err: err.message });
    return sendRouteError(req, res, err, "Script orchestration failed");
  }
});

export default router;
