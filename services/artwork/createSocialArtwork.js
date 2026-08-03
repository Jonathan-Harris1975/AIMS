// services/artwork/createSocialArtwork.js

import { info, error, debug } from "../../logger.js";
import { uploadBuffer } from "../shared/utils/r2-client.js";
import { generateSocialArtwork } from "./utils/artwork.js";
import { detectImageFormat } from "./utils/imageFormat.js";
import { runArtworkTask } from "./utils/artworkTask.js";

const ARTWORK_TIMEOUT_MS =
  Number(process.env.ZERNIO_ARTWORK_TIMEOUT_MS || process.env.ARTWORK_TIMEOUT_MS || process.env.AI_TIMEOUT)
  || 120_000;

function cleanPart(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createSocialArtwork({
  sessionId,
  prompt,
  date,
  lane = "social",
  fallbackUrl = "",
} = {}) {
  const safeSession = cleanPart(sessionId || `${lane}-${Date.now()}`);
  const safeLane = cleanPart(lane || "social").toLowerCase();

  try {
    debug("artwork.social.start", { sessionId: safeSession, lane: safeLane });

    const base64Data = await runArtworkTask(
      (signal) => generateSocialArtwork(prompt || `Editorial AI social artwork for ${safeLane}`, { date, signal }),
      ARTWORK_TIMEOUT_MS,
      "Social artwork generation",
    );

    const image = detectImageFormat(base64Data);
    const key = `zernio/${safeLane}/${safeSession}.${image.extension}`;
    const publicUrl = await uploadBuffer("blogImages", key, image.buffer, image.mimeType);

    info("artwork.social.done", { sessionId: safeSession, lane: safeLane, key, publicUrl });
    return { ok: true, key, publicUrl };
  } catch (err) {
    error("artwork.social.fail", {
      sessionId: safeSession,
      lane: safeLane,
      error: err?.message || String(err),
      fallbackUrl: fallbackUrl || undefined,
    });

    return {
      ok: false,
      error: err?.message || String(err),
      publicUrl: fallbackUrl || "",
      fallback: Boolean(fallbackUrl),
    };
  }
}
