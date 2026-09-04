// services/artwork/createBlogArtwork.js
import { info, warn, error, debug } from "../../logger.js";
import { uploadBuffer } from "../shared/utils/r2-client.js";
import { generateBlogArtwork, generateNewsletterArtwork, generateSocialBlogArtwork } from "./utils/artwork.js";
import { detectImageFormat } from "./utils/imageFormat.js";
import { runArtworkTask } from "./utils/artworkTask.js";
import { createDeterministicAiFallbackPng } from "./utils/deterministicAiFallback.js";

const DEFAULT_BLOG_IMAGES_BUCKET_KEY = "blogImages";
const BLOG_BUCKET_KEY = "blog";
const DEFAULT_ARTWORK_TASK_TIMEOUT_MS = 8 * 60_000;

function artworkTaskTimeoutMs(mode = "blog") {
  const envName = mode === "newsletter"
    ? "NEWSLETTER_ARTWORK_TIMEOUT_MS"
    : mode === "social-blog"
      ? "SOCIAL_BLOG_ARTWORK_TIMEOUT_MS"
      : "BLOG_ARTWORK_TIMEOUT_MS";
  const configured = Number(process.env[envName] || process.env.ARTWORK_TASK_TIMEOUT_MS || process.env.ARTWORK_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 60_000 ? configured : DEFAULT_ARTWORK_TASK_TIMEOUT_MS;
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

function boolEnv(name, fallback = false) {
  const value = String(process.env[name] ?? "").trim().toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on", "y"].includes(value)) return true;
  if (["0", "false", "no", "off", "n"].includes(value)) return false;
  return fallback;
}

function allowDeterministicFallback(mode) {
  // Social-blog artwork is a published editorial asset. Never silently turn a
  // generation failure into a generic image. SOCIAL_BLOG_ALLOW_DETERMINISTIC_FALLBACK
  // remains documented for backwards compatibility but is intentionally ignored.
  // Newsletter/blog modes retain their separate compatibility behaviour.
  if (mode === "social-blog") return false;
  if (mode === "newsletter") return boolEnv("NEWSLETTER_ALLOW_DETERMINISTIC_FALLBACK", true);
  return boolEnv("BLOG_ALLOW_DETERMINISTIC_FALLBACK", false);
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
  const artworkDate = typeof input === "object" ? (input?.date || input?.week) : undefined;
  const keyPrefix = typeof input === "object" ? normaliseKeyPrefix(input?.keyPrefix) : "";
  const requestedMode = typeof input === "object" ? String(input?.mode || "blog") : "blog";
  const artworkMode = ["newsletter", "social-blog"].includes(requestedMode) ? requestedMode : "blog";
  const { bucketKey, reason: bucketReason } = resolveBlogArtworkBucketKey();

  const log = (stage, meta) => info(`artwork.blog.${stage}`, {
    sessionId,
    keyPrefix: keyPrefix || undefined,
    bucketKey,
    bucketReason,
    ...meta,
  });

  try {
    debug("artwork.blog.start", { sessionId, keyPrefix: keyPrefix || undefined, bucketKey, bucketReason, artworkMode });

    const theme = prompt || `Blog header artwork for AI Weekly ${sessionId}`;

    const base64Data = await runArtworkTask(
      (signal) => (artworkMode === "newsletter" ? generateNewsletterArtwork : artworkMode === "social-blog" ? generateSocialBlogArtwork : generateBlogArtwork)(theme, { date:
         artworkDate, signal, generationKey: sessionId }),
      artworkTaskTimeoutMs(artworkMode),
      `${artworkMode} artwork generation`,
    );
    const image = detectImageFormat(base64Data);

    const key = keyPrefix ? `${keyPrefix}/${sessionId}.${image.extension}` : `${sessionId}.${image.extension}`;
    const publicUrl = await uploadBuffer(
      bucketKey,
      key,
      image.buffer,
      image.mimeType,
    );

    log("done", { key, publicUrl });
    return { ok: true, key, publicUrl, bucketKey, bucketReason };
  } catch (err) {
    error("artwork.blog.fail", { sessionId, keyPrefix: keyPrefix || undefined, bucketKey, bucketReason, error: err.message });
    try {
      const fallbackBuffer = createDeterministicAiFallbackPng({
        width: 1200,
        height: 675,
        seed: `${artworkMode}:${sessionId}:${prompt || ""}`,
      });
      const fallbackKey = keyPrefix
        ? `${keyPrefix}/${sessionId}-ai-fallback.png`
        : `${sessionId}-ai-fallback.png`;
      const publicUrl = await uploadBuffer(bucketKey, fallbackKey, fallbackBuffer, "image/png");
      warn("artwork.blog.deterministic_ai_diagnostic", {
        sessionId,
        artworkMode,
        key: fallbackKey,
        publicUrl,
        originalError: err?.message || String(err),
      });
      const publishableFallback = allowDeterministicFallback(artworkMode);
      return {
        ok: publishableFallback,
        fallback: true,
        imageStatus: publishableFallback ? "deterministic-fallback" : "failed",
        warning: publishableFallback ? "Generated artwork unavailable; deterministic editorial fallback used." : undefined,
        error: publishableFallback ? undefined : (err?.message || String(err)),
        originalError: err?.message || String(err),
        key: publishableFallback ? fallbackKey : undefined,
        diagnosticKey: fallbackKey,
        diagnosticUrl: publicUrl,
        publicUrl: publishableFallback ? publicUrl : "",
        bucketKey,
        bucketReason,
      };
    } catch (fallbackError) {
      error("artwork.blog.deterministic_ai_diagnostic_failed", {
        sessionId,
        artworkMode,
        originalError: err?.message || String(err),
        fallbackError: fallbackError?.message || String(fallbackError),
      });
      return {
        ok: false,
        error: `${err?.message || String(err)}; deterministic AI diagnostic failed: ${fallbackError?.message || String(fallbackError)}`,
        bucketKey,
        bucketReason,
      };
    }
  }
}
