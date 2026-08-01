// ============================================================
// 🎨 Artwork Generator — Express Route + Function Export
// ============================================================
// Backwards-compatible route module. Keep this aligned with
// services/artwork/routes/generateArtwork.js so older imports do
// not drift onto a separate image transport path.
// ============================================================

import express from "express";
import { putObject } from "../shared/utils/r2-client.js";
import { sanitizeSessionId } from "../shared/utils/sessionId.js";
import { requestDedupe } from "../shared/utils/requestDedupe.js";
import {
  validateBody,
  artworkGenerateBodySchema,
} from "../shared/utils/requestSchemas.js";
import { info, error } from "../../logger.js";
import { generatePodcastArtwork } from "./utils/artwork.js";

const router = express.Router();

function sendRouteError(req, res, err, fallbackMessage = "Internal error") {
  const requestId = req?.id || req?.headers?.["x-request-id"] || null;
  return res.status(500).json({ ok: false, error: fallbackMessage, requestId });
}

export async function generateArtwork(sessionId, prompt = "") {
  const resolvedPrompt = prompt && prompt.trim()
    ? prompt
    : `Podcast episode artwork for ${sessionId}: one concrete AI-news subject, cinematic technology editorial realism, high contrast, text-free.`;

  const imageData = await generatePodcastArtwork(resolvedPrompt, { sessionId });
  const buffer = Buffer.from(imageData, "base64");
  const key = `${sessionId}.png`;

  await putObject("art", key, buffer, "image/png");

  const publicUrl = `${process.env.R2_PUBLIC_BASE_URL_ART}/${encodeURIComponent(key)}`;
  info("🎨 Artwork saved to R2", { sessionId, key, publicUrl });

  return publicUrl;
}

router.post("/", requestDedupe("artwork:generate"), async (req, res) => {
  let sessionId;

  try {
    const parsed = validateBody(artworkGenerateBodySchema, req.body);
    if (!parsed.ok) {
      return res.status(400).json({ ok: false, error: parsed.error });
    }

    sessionId = sanitizeSessionId(parsed.data.sessionId || `art-${Date.now()}`, "art");
    const prompt = parsed.data.prompt || "Podcast episode artwork: one concrete AI-news subject, cinematic editorial realism, text-free";
    const url = await generateArtwork(sessionId, prompt);
    res.json({ ok: true, sessionId, url });
  } catch (err) {
    error("💥 Artwork route failed", {
      sessionId,
      requestId: req?.id || req?.headers?.["x-request-id"] || null,
      error: err?.stack || err?.message || String(err),
    });
    return sendRouteError(req, res, err, "Artwork generation failed");
  }
});

export default router;
