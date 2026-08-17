import express from "express";
import { runKeyword } from "../services/outreachService.js";
import { runNextBatch, resetProgress } from "../services/batchService.js";
import { requestDedupe } from "../../shared/utils/requestDedupe.js";
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

router.get("/automation/status", asyncRoute(async (_req, res) => {
  const { getCommsHubContext } = await import("../../comms-hub/runtime.js");
  const status = await getCommsHubContext().outreachAutomationService.status();
  res.json({ ok: true, service: "outreach", automation: status });
}));

router.post("/keyword", requestDedupe("outreach:keyword"), asyncRoute(async (req, res) => {
  const parsed = validateBody(outreachKeywordBodySchema, req.body);
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const result = await runKeyword(parsed.data.keyword);
  res.json({ ok: true, ...result });
}));

router.post("/batch/next", requestDedupe("outreach:batchNext"), asyncRoute(async (req, res) => {
  if (req.aimsAuth?.strategy === "temporary-public-outreach-batch-next") {
    res.set("X-AIMS-Temporary-Public-Route", "outreach-batch-next");
  }
  const result = await runNextBatch();
  res.json({ ok: true, ...result });
}));

router.post("/batch/reset", requestDedupe("outreach:batchReset"), asyncRoute(async (req, res) => {
  const parsed = validateBody(outreachResetBodySchema, req.body);
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const result = await resetProgress(parsed.data.lastProcessedIndex || 0);
  res.json({ ok: true, progress: result });
}));

export default router;
