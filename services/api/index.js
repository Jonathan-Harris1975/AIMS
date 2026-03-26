// services/api/index.js
import express from "express";
import podcastRouter from "../podcast/index.js";
import scriptRouter from "../script/routes/index.js";
import ttsRouter from "../tts/routes/tts.js";
import artworkRouter from "../artwork/index.js";

export const router = express.Router();

router.use("/podcast", podcastRouter);
router.use("/script", scriptRouter);
router.use("/tts", ttsRouter);
router.use("/artwork", artworkRouter);

export default router;
