import express from "express";
import { runKeyword } from "../services/outreachService.js";
import { runNextBatch, resetProgress, getProgress } from "../services/batchService.js";

const router = express.Router();

router.get("/health", (_req, res) => res.json({ ok: true, service: "outreach" }));

router.get("/progress", async (_req, res) => {
  const progress = await getProgress();
  res.json({ ok: true, progress });
});

router.post("/keyword", async (req, res) => {
  const { keyword } = req.body || {};
  if (!keyword || typeof keyword !== "string") {
    return res.status(400).json({ ok: false, error: "keyword is required" });
  }
  const result = await runKeyword(keyword);
  res.json({ ok: true, ...result });
});

router.post("/batch/next", async (_req, res) => {
  const result = await runNextBatch();
  res.json({ ok: true, ...result });
});

router.post("/batch/reset", async (req, res) => {
  const { lastProcessedIndex = 0 } = req.body || {};
  const result = await resetProgress(Number(lastProcessedIndex) || 0);
  res.json({ ok: true, progress: result });
});

export default router;
