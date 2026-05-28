// services/artwork/createBlogArtwork.js
import { info, error, debug } from "../../logger.js";
import { uploadBuffer } from "../shared/utils/r2-client.js";
import { generateBlogArtwork } from "./utils/artwork.js";

const DEFAULT_BLOG_IMAGES_BUCKET_KEY = "blogImages";
const BLOG_BUCKET_KEY = "blog";
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

function normaliseKeyPrefix(value = "") {
  return String(value || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
}

function normaliseAlias(value = "") {
  return String(value || "").trim();
}

function hasEnv(name) {
  return Boolean(String(process.env[name] || "").trim());
}

function resolveBlogArtworkBucketKey() {
  const configured = normaliseAlias(process.env.BLOG_ARTWORK_BUCKET_ALIAS);

  if (configured) {
    const configuredIsBlogImages = ["blogImages", "blogimages", "blog-images"].includes(configured);
    if (configuredIsBlogImages && !hasEnv("R2_PUBLIC_BASE_URL_BLOG_IMAGES") && hasEnv("R2_BUCKET_BLOG") && hasEnv("R2_PUBLIC_BASE_URL_BLOG")) {
      return { bucketKey: BLOG_BUCKET_KEY, reason: "configured-blog-images-missing-public-url-fallback" };
    }

    return { bucketKey: configured, reason: "configured" };
  }

  if (hasEnv("R2_BUCKET_BLOG_IMAGES") && hasEnv("R2_PUBLIC_BASE_URL_BLOG_IMAGES")) {
    return { bucketKey: DEFAULT_BLOG_IMAGES_BUCKET_KEY, reason: "blog-images-configured" };
  }

  if (hasEnv("R2_BUCKET_BLOG") && hasEnv("R2_PUBLIC_BASE_URL_BLOG")) {
    return { bucketKey: BLOG_BUCKET_KEY, reason: "blog-bucket-public-url-fallback" };
  }

  return { bucketKey: DEFAULT_BLOG_IMAGES_BUCKET_KEY, reason: "default" };
}

export async function createBlogArtwork(input) {
  const sessionId = typeof input === "string" ? input : input?.sessionId;
  const prompt = typeof input === "object" ? input?.prompt : undefined;
  const keyPrefix = typeof input === "object" ? normaliseKeyPrefix(input?.keyPrefix) : "";
  const { bucketKey, reason: bucketReason } = resolveBlogArtworkBucketKey();

  const log = (stage, meta) => info(`artwork.blog.${stage}`, {
    sessionId,
    keyPrefix: keyPrefix || undefined,
    bucketKey,
    bucketReason,
    ...meta,
  });

  try {
    debug("artwork.blog.start", { sessionId, keyPrefix: keyPrefix || undefined, bucketKey, bucketReason });

    const theme = prompt || `Blog header artwork for AI Weekly ${sessionId}`;

    const base64Data = await withTimeout(
      generateBlogArtwork(theme),
      ARTWORK_TIMEOUT_MS,
      "Blog artwork generation"
    );
    const buffer = Buffer.from(base64Data, "base64");

    const key = keyPrefix ? `${keyPrefix}/${sessionId}.png` : `${sessionId}.png`;
    const publicUrl = await uploadBuffer(
      bucketKey,
      key,
      buffer,
      "image/png"
    );

    log("done", { key, publicUrl });
    return { ok: true, key, publicUrl, bucketKey, bucketReason };
  } catch (err) {
    error("artwork.blog.fail", { sessionId, keyPrefix: keyPrefix || undefined, bucketKey, bucketReason, error: err.message });
    return { ok: false, error: err.message, bucketKey, bucketReason };
  }
}
