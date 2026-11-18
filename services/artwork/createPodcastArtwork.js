// services/artwork/createPodcastArtwork.js
import { info, error, debug } from "../../logger.js";
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

export async function createPodcastArtwork(input) {
  const sessionId = typeof input === "string" ? input : input?.sessionId;
  const prompt = typeof input === "object" ? input?.prompt : undefined;

  try {
    debug("start", { sessionId });

    const theme = prompt || `Podcast artwork for AI Weekly episode ${sessionId}`;

    const base64Data = await runArtworkTask(
      (signal) => generatePodcastArtwork(theme, { signal, sessionId }),
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

    // Never use a reusable episode cover when on-topic image generation fails.
    return {
      ok: false,
      error: message,
      source: "failed",
      imageGenerationStatus: "failed",
      imageGenerationError: message,
    };
  }
}
