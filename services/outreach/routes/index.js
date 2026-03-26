import express from "express";
import { runKeyword } from "../services/outreachService.js";
import { runNextBatch, resetProgress } from "../services/batchService.js";
import { hookdeckDedupe } from "../../shared/utils/hookdeckDedupe.js";
import {
  validateBody,
  outreachKeywordBodySchema,
  outreachResetBodySchema,
} from "../../shared/utils/requestSchemas.js";

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "outreach" });
});

router.post("/keyword", hookdeckDedupe("outreach:keyword"), asyncRoute(async (req, res) => {
  const parsed = validateBody(outreachKeywordBodySchema, req.body);
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const result = await runKeyword(parsed.data.keyword);
  res.json({ ok: true, ...result });
}));

router.post("/batch/next", hookdeckDedupe("outreach:batchNext"), asyncRoute(async (_req, res) => {
  const result = await runNextBatch();
  res.json({ ok: true, ...result });
}));

router.post("/batch/reset", hookdeckDedupe("outreach:batchReset"), asyncRoute(async (req, res) => {
  const parsed = validateBody(outreachResetBodySchema, req.body);
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const result = await resetProgress(parsed.data.lastProcessedIndex || 0);
  res.json({ ok: true, progress: result });
}));

export default router;
