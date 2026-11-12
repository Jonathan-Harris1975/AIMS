// services/artwork/createSocialArtwork.js

import { info, warn, error, debug } from "../../logger.js";
import { uploadBuffer } from "../shared/utils/r2-client.js";
import { generateSocialArtwork } from "./utils/artwork.js";
import { detectImageFormat } from "./utils/imageFormat.js";
import { runArtworkTask } from "./utils/artworkTask.js";
import { emitQaEvent } from "../shared/utils/qaEvents.js";
import { createDeterministicAiFallbackPng } from "./utils/deterministicAiFallback.js";

const DEFAULT_ZERNIO_ARTWORK_TIMEOUT_MS = 8 * 60_000;

function socialArtworkTimeoutMs() {
  const configured = Number(process.env.ZERNIO_ARTWORK_TIMEOUT_MS || process.env.ARTWORK_TASK_TIMEOUT_MS || process.env.ARTWORK_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 60_000 ? configured : DEFAULT_ZERNIO_ARTWORK_TIMEOUT_MS;
}

function boolEnv(name, fallback = false) {
  const value = String(process.env[name] ?? "").trim().toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on", "y"].includes(value)) return true;
  if (["0", "false", "no", "off", "n"].includes(value)) return false;
  return fallback;
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
    const failureReason = fallbackFailureReason(err);
    const qa = err?.artworkVisualQa || null;
    if (!allowFallback) {
      error("artwork.social.required_generation_failed", {
        sessionId: safeSession,
        lane: safeLane,
        error: err?.message || String(err),
      });
      return {
        ok: false,
        error: err?.message || String(err),
        publicUrl: "",
        fallback: false,
        imageStatus: "generation-failed",
      };
    }

    const curatedFallback = validFallbackUrl(fallbackUrl);
    if (curatedFallback) {
      warn("artwork.social.curated_fallback", {
        sessionId: safeSession,
        lane: safeLane,
        publicUrl: curatedFallback,
        reason: failureReason,
        qaScore: qa?.score ?? null,
        qaRelevance: qa?.relevance ?? null,
        originalError: err?.message || String(err),
      });
      emitQaEvent({
        source: "zernio.artwork",
        type: "curated_static_fallback",
        severity: "medium",
        message: `Fresh artwork failed for ${safeLane}; published the curated static image only after generation/recovery was exhausted.`,
        detail: {
          sessionId: safeSession,
          lane: safeLane,
          fallbackReason: failureReason,
          qaScore: qa?.score ?? null,
          qaRelevance: qa?.relevance ?? null,
          qaTextSafety: qa?.textSafety ?? null,
          originalError: String(err?.message || err).slice(0, 500),
        },
        persist: true,
      });
      return {
        ok: true,
        fallback: true,
        imageStatus: "curated-static-fallback",
        fallbackReason: failureReason,
        warning: `Generated artwork unavailable (${failureReason}); curated lane image used as last resort.`,
        originalError: err?.message || String(err),
        publicUrl: curatedFallback,
      };
    }

    error("artwork.social.fail", {
      sessionId: safeSession,
      lane: safeLane,
      error: err?.message || String(err),
    });

    try {
      const fallbackBuffer = createDeterministicAiFallbackPng({
        width: 1080,
        height: 1080,
        seed: `${safeLane}:${safeSession}:${prompt || ""}`,
      });
      const key = `zernio/${safeLane}/${safeSession}-ai-fallback.png`;
      const publicUrl = await uploadBuffer("blogImages", key, fallbackBuffer, "image/png");
      warn("artwork.social.deterministic_ai_diagnostic", {
        sessionId: safeSession,
        lane: safeLane,
        key,
        publicUrl,
        originalError: err?.message || String(err),
      });
      const publishableFallback = boolEnv("ZERNIO_ALLOW_DETERMINISTIC_FALLBACK", false);
      return {
        ok: publishableFallback,
        fallback: true,
        imageStatus: publishableFallback ? "deterministic-fallback" : "failed",
        warning: publishableFallback ? "Generated artwork unavailable; deterministic editorial fallback used." : undefined,
        error: publishableFallback ? undefined : (err?.message || String(err)),
        originalError: err?.message || String(err),
        key: publishableFallback ? key : undefined,
        diagnosticKey: key,
        diagnosticUrl: publicUrl,
        publicUrl: publishableFallback ? publicUrl : "",
      };
    } catch (fallbackError) {
      error("artwork.social.deterministic_ai_diagnostic_failed", {
        sessionId: safeSession,
        lane: safeLane,
        originalError: err?.message || String(err),
        fallbackError: fallbackError?.message || String(fallbackError),
      });
      return {
        ok: false,
        error: `${err?.message || String(err)}; deterministic AI diagnostic failed: ${fallbackError?.message || String(fallbackError)}`,
        publicUrl: "",
        fallback: false,
      };
    }
  }
}
