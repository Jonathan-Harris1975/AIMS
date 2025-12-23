import express from "express";
import { runKeyword } from "../services/outreachService.js";
import { runNextBatch, resetProgress } from "../services/batchService.js";

const router = express.Router();

/* ============================================================
   Health
============================================================ */

router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "outreach" });
});

/* ============================================================
   Single keyword run
============================================================ */

router.post("/keyword", async (req, res) => {
  const { keyword } = req.body || {};

  if (!keyword || typeof keyword !== "string") {
    return res.status(400).json({
      ok: false,
      error: "keyword is required"
    });
  }

  const result = await runKeyword(keyword);
  res.json({ ok: true, ...result });
});

/* ============================================================
   Batch processing
============================================================ */

router.post("/batch/next", async (_req, res) => {
  const result = await runNextBatch();
  res.json({ ok: true, ...result });
});

router.post("/batch/reset", async (req, res) => {
  const { lastProcessedIndex = 0 } = req.body || {};
  const result = resetProgress(Number(lastProcessedIndex) || 0);
  res.json({ ok: true, progress: result });
});

export default router;
