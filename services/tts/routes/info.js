import express from "express";
import { getPodcastInfo } from "../utils/infoProcessor.js";

const router = express.Router();

router.get("/:filename", async (req, res) => {
  try {
    const { filename } = req.params;
    const info = await getPodcastInfo(filename);
    res.json({ ok: true, info });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
