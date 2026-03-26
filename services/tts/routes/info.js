import express from "express";
import { getPodcastInfo } from "../utils/infoProcessor.js";

const router = express.Router();

router.get("/:filename", async (req, res) => {
  try {
    const { filename } = req.params;
    const info = await getPodcastInfo(filename); 
    res.json({ success: true, info });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
