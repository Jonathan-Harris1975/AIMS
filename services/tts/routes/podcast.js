import express from "express";
import { log } from "../../../logger.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
  log.info("📣 podcast final ack", { sessionId });
  res.json({ success: true, sessionId });
});

export default router;
