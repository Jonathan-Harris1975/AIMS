// services/artwork/createBlogArtwork.js
import { info, error, debug } from "../../logger.js";
import { uploadBuffer } from "../shared/utils/r2-client.js";
import { generateBlogArtwork } from "./utils/artwork.js";

const R2_BUCKET_BLOG_IMAGES_KEY = "blogImages";
const ARTWORK_TIMEOUT_MS =
  Number(process.env.BLOG_ARTWORK_TIMEOUT_MS || process.env.ARTWORK_TIMEOUT_MS || process.env.AI_TIMEOUT)
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

export async function createBlogArtwork(input) {
  const sessionId = typeof input === "string" ? input : input?.sessionId;
  const prompt = typeof input === "object" ? input?.prompt : undefined;

  const log = (stage, meta) => info(`artwork.blog.${stage}`, { sessionId, ...meta });

  try {
    debug("artwork.blog.start", { sessionId });

    const theme = prompt || `Blog header artwork for AI Weekly ${sessionId}`;

    const base64Data = await withTimeout(
      generateBlogArtwork(theme),
      ARTWORK_TIMEOUT_MS,
      "Blog artwork generation"
    );
    const buffer = Buffer.from(base64Data, "base64");

    const key = `${sessionId}.png`;
    const publicUrl = await uploadBuffer(
      R2_BUCKET_BLOG_IMAGES_KEY,
      key,
      buffer,
      "image/png"
    );

    log("done", { key, publicUrl });
    return { ok: true, key, publicUrl };
  } catch (err) {
    error("artwork.blog.fail", { sessionId, error: err.message });
    return { ok: false, error: err.message };
  }
}
