import express from "express";
import { runKeyword } from "../services/outreachService.js";
import { runNextBatch } from "../services/batchService.js";
import { loadProgress } from "../utils/r2ProgressStore.js";

const router = express.Router();

router.get("/health", (_, res) => res.json({ ok: true }));
router.get("/progress", async (_, res) => res.json(await loadProgress()));
router.post("/keyword", async (req, res) =>
  res.json(await runKeyword(req.body.keyword))
);
router.post("/batch/next", async (_, res) =>
  res.json(await runNextBatch())
);

export default router
