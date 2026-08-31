// services/artwork/createSocialArtwork.js

import { info, warn, error, debug } from "../../logger.js";
import { uploadBuffer } from "../shared/utils/r2-client.js";
import { generateSocialArtwork } from "./utils/artwork.js";
import { detectImageFormat } from "./utils/imageFormat.js";
import { runArtworkTask } from "./utils/artworkTask.js";
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
    const publicUrl = await uploadBuffer("blogImages", key, image.buffer, image.mimeType);

    info("artwork.social.done", { sessionId: safeSession, lane: safeLane, key, publicUrl });
    return { ok: true, key, publicUrl };
  } catch (err) {
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
        originalError: err?.message || String(err),
      });
      return {
        ok: true,
        fallback: true,
        imageStatus: "curated-static-fallback",
        warning: "Generated artwork unavailable; curated lane image used.",
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
