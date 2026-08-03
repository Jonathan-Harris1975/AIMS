// services/artwork/createPodcastArtwork.js
import { info, warn, error, debug } from "../../logger.js";
import { uploadBuffer } from "../shared/utils/r2-client.js";
import { generatePodcastArtwork } from "./utils/artwork.js";
import { detectImageFormat } from "./utils/imageFormat.js";
import { runArtworkTask } from "./utils/artworkTask.js";
import { emitQaEvent } from "../shared/utils/qaEvents.js";

const R2_BUCKET_ART_KEY = "art";
const PODCAST_ARTWORK_TIMEOUT_MS =
  Number(
    process.env.PODCAST_ARTWORK_TIMEOUT_MS ||
      process.env.ARTWORK_TIMEOUT_MS ||
      process.env.AI_TIMEOUT
  ) || 120_000;

// Deterministic branded fallback rotation (OB-004 / BSC-OB-005): supports a
// comma-separated list of pre-approved branded fallback images via
// PODCAST_FALLBACK_IMAGE_URLS, so repeated failures in the same window don't
// all publish the exact same fallback cover. Falls back to the single-URL
// env vars for backwards compatibility if the list var isn't set.
const PODCAST_FALLBACK_IMAGE_URLS = String(process.env.PODCAST_FALLBACK_IMAGE_URLS || "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);
const PODCAST_FALLBACK_IMAGE_URL = String(
  process.env.PODCAST_FALLBACK_IMAGE_URL ||
    process.env.PODCAST_FALLBACK_EPISODE_IMAGE_URL ||
    ""
).trim();

function stableIndex(value = "", length = 1) {
  let hash = 0;
  for (const char of String(value || "")) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  return length > 0 ? hash % length : 0;
}

function pickDeterministicFallbackUrl(sessionId) {
  const pool = PODCAST_FALLBACK_IMAGE_URLS.length
    ? PODCAST_FALLBACK_IMAGE_URLS
    : PODCAST_FALLBACK_IMAGE_URL
      ? [PODCAST_FALLBACK_IMAGE_URL]
      : [];
  if (!pool.length) return "";
  return pool[stableIndex(sessionId, pool.length)];
}

export async function createPodcastArtwork(input) {
  const sessionId = typeof input === "string" ? input : input?.sessionId;
  const prompt = typeof input === "object" ? input?.prompt : undefined;

  try {
    debug("start", { sessionId });

    const theme = prompt || `Podcast artwork for AI Weekly episode ${sessionId}`;

    const base64Data = await runArtworkTask(
      (signal) => generatePodcastArtwork(theme, { signal }),
      PODCAST_ARTWORK_TIMEOUT_MS,
      "Podcast artwork generation",
    );
    const image = detectImageFormat(base64Data);

    const key = `${sessionId}.${image.extension}`;
    const publicUrl = await uploadBuffer(
      R2_BUCKET_ART_KEY,
      key,
      image.buffer,
      image.mimeType,
    );

    info("artwork.podcast.generated", {
      sessionId,
      key,
      publicUrl,
      timeoutMs: PODCAST_ARTWORK_TIMEOUT_MS,
    });

    return {
      ok: true,
      key,
      url: publicUrl,
      publicUrl,
      source: "generated",
      imageGenerationStatus: "generated",
      imageGenerationError: "",
    };
  } catch (err) {
    const message = err?.message || "Unknown podcast artwork error";

    error("artwork.fail", { sessionId, error: message });

    // Failure alert: every exhausted artwork generation attempt raises a
    // structured, persisted QA event so repeated failures are visible
    // without having to grep logs. OB-004 / BSC-OB-005.
    emitQaEvent({
      source: "podcast.artwork",
      type: "artwork_generation_failed",
      severity: "high",
      message: `Podcast artwork generation failed for session ${sessionId}: ${message}`,
      detail: { sessionId, error: message },
      persist: true,
    });

    const fallbackUrl = pickDeterministicFallbackUrl(sessionId);
    if (fallbackUrl) {
      warn("artwork.podcast.fallback", {
        sessionId,
        error: message,
        fallbackUrl,
        fallbackPoolSize: PODCAST_FALLBACK_IMAGE_URLS.length || (PODCAST_FALLBACK_IMAGE_URL ? 1 : 0),
      });

      return {
        ok: true,
        key: null,
        url: fallbackUrl,
        publicUrl: fallbackUrl,
        source: "fallback",
        imageGenerationStatus: "fallback",
        imageGenerationError: message,
        usedFallback: true,
      };
    }

    return {
      ok: false,
      error: message,
      source: "failed",
      imageGenerationStatus: "failed",
      imageGenerationError: message,
    };
  }
}
