// services/artwork/createBlogArtwork.js
import { info, error, debug } from "../../logger.js";
import { uploadBuffer } from "../shared/utils/r2-client.js";
import { generatePodcastArtwork } from "./utils/artwork.js";

// Uses the new dedicated blog-images bucket alias
const R2_BUCKET_BLOG_IMAGES_KEY = "blogImages";

export async function createBlogArtwork(input) {
  // Supports createBlogArtwork("BLOG-2026-W10") or createBlogArtwork({ sessionId, prompt })
  const sessionId = typeof input === "string" ? input : input?.sessionId;
  const prompt = typeof input === "object" ? input?.prompt : undefined;

  const log = (stage, meta) => info(`artwork.blog.${stage}`, { sessionId, ...meta });

  try {
    debug("artwork.blog.start", { sessionId });

    const theme = prompt || `Blog header artwork for AI Weekly ${sessionId}`;

    const base64Data = await generatePodcastArtwork(theme);
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
