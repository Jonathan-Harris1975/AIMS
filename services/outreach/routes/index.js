import express from "express";
import { runKeyword } from "../services/outreachService.js";
import { runNextBatch, resetProgress } from "../services/batchService.js";

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "outreach" });
});

router.post("/keyword", asyncRoute(async (req, res) => {
  const { keyword } = req.body || {};

  if (!keyword || typeof keyword !== "string") {
    return res.status(400).json({
      ok: false,
      error: "keyword is required"
    });
  }

  const result = await runKeyword(keyword);
  res.json({ ok: true, ...result });
}));

router.post("/batch/next", asyncRoute(async (_req, res) => {
  const result = await runNextBatch();
  res.json({ ok: true, ...result });
}));

router.post("/batch/reset", asyncRoute(async (req, res) => {
  const { lastProcessedIndex = 0 } = req.body || {};
  const result = resetProgress(Number(lastProcessedIndex) || 0);
  res.json({ ok: true, progress: result });
}));

export default router;
