// services/artwork/createPodcastArtwork.js
import { info, warn, error, debug } from "../../logger.js";
import { uploadBuffer } from "../shared/utils/r2-client.js";
import { generatePodcastArtwork } from "./utils/artwork.js";

const R2_BUCKET_ART_KEY = "art";
const PODCAST_ARTWORK_TIMEOUT_MS =
  Number(
    process.env.PODCAST_ARTWORK_TIMEOUT_MS ||
      process.env.ARTWORK_TIMEOUT_MS ||
      process.env.AI_TIMEOUT
  ) || 120_000;
const PODCAST_FALLBACK_IMAGE_URL = String(
  process.env.PODCAST_FALLBACK_IMAGE_URL ||
    process.env.PODCAST_FALLBACK_EPISODE_IMAGE_URL ||
    ""
).trim();

function withTimeout(promise, timeoutMs, label) {
  let timer;

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function createPodcastArtwork(input) {
  const sessionId = typeof input === "string" ? input : input?.sessionId;
  const prompt = typeof input === "object" ? input?.prompt : undefined;

  try {
    debug("start", { sessionId });

    const theme = prompt || `Podcast artwork for AI Weekly episode ${sessionId}`;

    const base64Data = await withTimeout(
      generatePodcastArtwork(theme),
      PODCAST_ARTWORK_TIMEOUT_MS,
      "Podcast artwork generation"
    );
    const buffer = Buffer.from(base64Data, "base64");

    const key = `${sessionId}.png`;
    const publicUrl = await uploadBuffer(
      R2_BUCKET_ART_KEY,
      key,
      buffer,
      "image/png"
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

    if (PODCAST_FALLBACK_IMAGE_URL) {
      warn("artwork.podcast.fallback", {
        sessionId,
        error: message,
        fallbackUrl: PODCAST_FALLBACK_IMAGE_URL,
      });

      return {
        ok: true,
        key: null,
        url: PODCAST_FALLBACK_IMAGE_URL,
        publicUrl: PODCAST_FALLBACK_IMAGE_URL,
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
