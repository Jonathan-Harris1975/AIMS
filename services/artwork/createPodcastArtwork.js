// services/artwork/createPodcastArtwork.js
import { info, error, debug } from "../../logger.js";
import { uploadBuffer } from "../shared/utils/r2-client.js";
import { generatePodcastArtwork } from "./utils/artwork.js";

const R2_BUCKET_ART_KEY = "art";
const ARTWORK_TIMEOUT_MS = Number(process.env.ARTWORK_TIMEOUT_MS || process.env.AI_TIMEOUT) || 60_000;

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

export async function createPodcastArtwork(input) {
  const sessionId = typeof input === "string" ? input : input?.sessionId;
  const prompt = typeof input === "object" ? input?.prompt : undefined;

  const log = (stage, meta) =>
    info(`artwork.${stage}`, { sessionId, ...meta });

  try {
    debug("start", {});

    const theme =
      prompt || `Podcast artwork for AI Weekly episode ${sessionId}`;

    const base64Data = await withTimeout(
      generatePodcastArtwork(theme),
      ARTWORK_TIMEOUT_MS,
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

    debug("done", { key, publicUrl });

    return { ok: true, key, url: publicUrl, publicUrl };
  } catch (err) {
    error("artwork.fail", { sessionId, error: err.message });
    return { ok: false, error: err.message };
  }
}
