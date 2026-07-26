// services/artwork/createSocialArtwork.js

import { info, error, debug } from "../../logger.js";
import { uploadBuffer } from "../shared/utils/r2-client.js";
import { generateSocialArtwork } from "./utils/artwork.js";

const ARTWORK_TIMEOUT_MS =
  Number(process.env.ZERNIO_ARTWORK_TIMEOUT_MS || process.env.ARTWORK_TIMEOUT_MS || process.env.AI_TIMEOUT)
  || 120_000;

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

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

    const base64Data = await withTimeout(
      generateSocialArtwork(prompt || `Editorial AI social artwork for ${safeLane}`, { date }),
      ARTWORK_TIMEOUT_MS,
      "Social artwork generation",
    );

    const buffer = Buffer.from(base64Data, "base64");
    const key = `zernio/${safeLane}/${safeSession}.png`;
    const publicUrl = await uploadBuffer("blogImages", key, buffer, "image/png");

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
