// services/artwork/createSocialArtwork.js

import { info, warn, error, debug } from "../../logger.js";
import { uploadBuffer } from "../shared/utils/r2-client.js";
import { generateSocialArtwork } from "./utils/artwork.js";
import { detectImageFormat } from "./utils/imageFormat.js";
import { runArtworkTask } from "./utils/artworkTask.js";
import { emitQaEvent } from "../shared/utils/qaEvents.js";

const DEFAULT_ZERNIO_ARTWORK_TIMEOUT_MS = 8 * 60_000;

function socialArtworkTimeoutMs() {
  const configured = Number(process.env.ZERNIO_ARTWORK_TIMEOUT_MS || process.env.ARTWORK_TASK_TIMEOUT_MS || process.env.ARTWORK_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 60_000 ? configured : DEFAULT_ZERNIO_ARTWORK_TIMEOUT_MS;
}

function validFallbackUrl(value = "") {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function fallbackFailureReason(err) {
  if (err?.code === "ARTWORK_TASK_TIMEOUT") return "generation-timeout";
  if (err?.artworkVisualQa) return "visual-qa-rejected";
  return "generation-or-storage-error";
}

// R2 upload failures should not waste a successfully generated, QA-approved
// image. Retry the SAME bytes and key; never re-bill an image model for this.
async function uploadApprovedSocialArtwork(key, image, sessionId, lane) {
  const rawAttempts = Number(process.env.ZERNIO_ARTWORK_UPLOAD_ATTEMPTS || 3);
  const attempts = Number.isFinite(rawAttempts) ? Math.max(1, Math.min(3, Math.trunc(rawAttempts))) : 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const publicUrl = await uploadBuffer("blogImages", key, image.buffer, image.mimeType);
      if (!validFallbackUrl(publicUrl)) {
        throw new Error("R2 artwork upload did not return a usable HTTP(S) public image URL");
      }
      return publicUrl;
    } catch (err) {
      if (attempt === attempts) throw err;
      warn("artwork.social.upload_retry", {
        sessionId,
        lane,
        key,
        attempt,
        attempts,
        error: err?.message || String(err),
      });
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
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
  allowFallback = false,
} = {}) {
  const safeSession = cleanPart(sessionId || `${lane}-${Date.now()}`);
  const safeLane = cleanPart(lane || "social").toLowerCase();

  try {
    debug("artwork.social.start", { sessionId: safeSession, lane: safeLane });

    const base64Data = await runArtworkTask(
      (signal) => generateSocialArtwork(prompt || `Editorial AI social artwork for ${safeLane}`, { date, signal, generationKey: safeSession }),
      socialArtworkTimeoutMs(),
      "Zernio social artwork generation",
    );

    const image = detectImageFormat(base64Data);
    const key = `zernio/${safeLane}/${safeSession}.${image.extension}`;
    const publicUrl = await uploadApprovedSocialArtwork(key, image, safeSession, safeLane);

    info("artwork.social.done", { sessionId: safeSession, lane: safeLane, key, publicUrl });
    return { ok: true, key, publicUrl, fallback: false, imageStatus: "generated" };
  } catch (err) {
    const reason = fallbackFailureReason(err);
    const detail = {
      sessionId: safeSession,
      lane: safeLane,
      reason,
      fallbackRequested: Boolean(allowFallback && validFallbackUrl(fallbackUrl)),
      qaScore: err?.artworkVisualQa?.score ?? null,
      qaRelevance: err?.artworkVisualQa?.relevance ?? null,
    };
    error("artwork.social.fresh_image_required", { ...detail, error: err?.message || String(err) });
    emitQaEvent({
      source: "zernio.artwork",
      type: "fresh_artwork_required",
      severity: "high",
      message: `Publication blocked for ${safeLane}: no new approved image was generated.`,
      detail,
      persist: true,
    });
    // A default/curated/deterministic image cannot ever count as a
    // successful Zernio post, even if a stale deployment flag requests it.
    return {
      ok: false,
      error: err?.message || String(err),
      publicUrl: "",
      fallback: false,
      imageStatus: "generation-failed",
      fallbackReason: reason,
    };
  }
}
