// ============================================================
// ☁️ Cloudflare R2 Client — Unified + Updated With New Buckets
// ============================================================
//
// Includes:
//   • metasystem bucket for episode counter + system files
//   • R2_PUBLIC_BASE_URL_META_SYSTEM
//   • R2_BUCKET_EDITED_AUDIO
//   • R2_PUBLIC_BASE_URL_EDITED_AUDIO
//   • Correct dual RSS setup (newsletter + podcast RSS)
//   • Backwards-compatible aliases for ALL services
// ============================================================

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { log } from "../../../logger.js";
import {
  getDurableStateBucketEnvName,
  getDurableStateBucketName,
  getDurableStatePublicBaseUrl,
  getDurableStatePublicUrlEnvName,
} from "./durableStateEnv.js";

// ------------------------------------------------------------
// 🔧 Environment Variables
// ------------------------------------------------------------
const {
  // Core creds
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_ENDPOINT,
  R2_REGION,

  // Buckets
  R2_BUCKET_PODCAST,
  R2_BUCKET_RAW,
  R2_BUCKET_RAW_TEXT,
  R2_BUCKET_META,
  R2_BUCKET_MERGED,
  R2_BUCKET_ART,
  R2_BUCKET_RSS_FEEDS,            // newsletter RSS
  R2_BUCKET_PODCAST_RSS_FEEDS,    // podcast-specific RSS
  R2_BUCKET_TRANSCRIPTS,
  R2_BUCKET_CHUNKS,
  R2_BUCKET_EDITED_AUDIO,
  R2_BUCKET_BLOG,
  R2_BUCKET_BLOG_IMAGES,
  R2_BUCKET_BLOG_RSS,
  R2_BUCKET_BRAND_ASSETS,
  R2_BUCKET_AUDITS,
  R2_BUCKET_COMMS_HUB,

  // Legacy/compat (read-only)
  R2_BUCKET_PODCAST_OUTPUT,

  // Legacy/compat (read-only)
  R2_BUCKET_RAW_TEXT_INPUT,

  // NEW — metasystem bucket for episode counter
  R2_BUCKET_META_SYSTEM,

  // Public URLs
  R2_PUBLIC_BASE_URL_PODCAST,
  R2_PUBLIC_BASE_URL_RAW_TEXT,
  R2_PUBLIC_BASE_URL_META,
  R2_PUBLIC_BASE_URL_MERGE,
  R2_PUBLIC_BASE_URL_ART,
  R2_PUBLIC_BASE_URL_RSS,
  R2_PUBLIC_BASE_URL_PODCAST_RSS,
  R2_PUBLIC_BASE_URL_TRANSCRIPT,
  R2_PUBLIC_BASE_URL_CHUNKS,
  R2_PUBLIC_BASE_URL_EDITED_AUDIO,
  R2_PUBLIC_BASE_URL_BLOG,
  R2_PUBLIC_BASE_URL_BLOG_IMAGES,
  R2_PUBLIC_BASE_URL_BLOG_RSS,
  R2_PUBLIC_BASE_URL_BRAND_ASSETS,
  R2_PUBLIC_BASE_URL_AUDITS,
  R2_PUBLIC_BASE_URL_COMMS_HUB,
  R2_PUBLIC_BASE_URL_TRANSCRIPT_HTML,

  // NEW — metasystem public URL (optional)
  R2_PUBLIC_BASE_URL_META_SYSTEM,

  // Legacy/compat (read-only)
  R2_PUBLIC_BASE_URL_RSS_FEEDS,

  // Legacy/compat (read-only)
  R2_PUBLIC_BASE_URL_PODCAST_OUTPUT,
} = process.env;

const RAW_AUDIO_BUCKET_NAME = R2_BUCKET_CHUNKS || R2_BUCKET_RAW;
const TRANSCRIPT_PUBLIC_BASE_URL = R2_PUBLIC_BASE_URL_TRANSCRIPT_HTML || R2_PUBLIC_BASE_URL_TRANSCRIPT;
const META_SYSTEM_BUCKET_NAME = getDurableStateBucketName(process.env);
const META_SYSTEM_BUCKET_ENV_NAME = getDurableStateBucketEnvName(process.env);
const META_SYSTEM_PUBLIC_BASE_URL = getDurableStatePublicBaseUrl(process.env);
const META_SYSTEM_PUBLIC_URL_ENV_NAME = getDurableStatePublicUrlEnvName(process.env);

// ------------------------------------------------------------
// 🧠 Initialize Client
// ------------------------------------------------------------
export const s3 = new S3Client({
  region: R2_REGION || "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

const R2_REQUEST_TIMEOUT_MS = Number(process.env.R2_REQUEST_TIMEOUT_MS || 15_000);
const R2_UPLOAD_RETRIES = Math.max(0, Math.min(8, Number(process.env.R2_UPLOAD_RETRIES ?? process.env.R2_RETRY_ATTEMPTS ?? 4)));
const R2_RETRY_BASE_MS = Math.max(100, Math.min(10_000, Number(process.env.R2_RETRY_BASE_MS || 400)));
const R2_RETRY_MAX_MS = Math.max(R2_RETRY_BASE_MS, Math.min(30_000, Number(process.env.R2_RETRY_MAX_MS || 5_000)));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableR2Error(error) {
  const status = Number(error?.$metadata?.httpStatusCode || error?.statusCode || error?.status || 0);
  const name = String(error?.name || error?.code || "").toLowerCase();
  const message = String(error?.message || error || "").toLowerCase();
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  return /abort|timeout|timed out|throttl|slowdown|temporar|rate|busy|unavailable|reset|socket|network|econnreset|etimedout|eai_again/.test(`${name} ${message}`);
}

function r2RetryDelayMs(retryIndex) {
  const jitter = Math.floor(Math.random() * 150);
  return Math.min(R2_RETRY_MAX_MS, R2_RETRY_BASE_MS * (2 ** Math.max(0, retryIndex - 1))) + jitter;
}

async function sendR2Command(command, { timeoutMs = R2_REQUEST_TIMEOUT_MS, retries = R2_UPLOAD_RETRIES } = {}) {
  const maxAttempts = Math.max(1, Number(retries || 0) + 1);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();

    try {
      return await s3.send(command, { abortSignal: controller.signal });
    } catch (error) {
      lastError = error;
      const retryable = isRetryableR2Error(error);
      if (!retryable || attempt >= maxAttempts) throw error;
      const delayMs = r2RetryDelayMs(attempt);
      log.warn("r2.command.retry", {
        attempt,
        maxAttempts,
        delayMs,
        command: command?.constructor?.name || "R2Command",
        statusCode: error?.$metadata?.httpStatusCode || error?.statusCode || error?.status || null,
        message: error?.message || String(error),
      });
      await sleep(delayMs);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error("R2 command failed without an error object");
}


// ------------------------------------------------------------
// 🎧 Canonical bucket key exports (wire-only)
// ------------------------------------------------------------
// NOTE: These are bucket *keys* (aliases), not bucket names.
// Use alias strings here so helpers can safely call ensureBucketKey/buildPublicUrl.
export const R2_BUCKET_RAW_AUDIO = "chunks";
export const R2_BUCKET_RAW_TEXT_KEY = "rawtext";
export const R2_BUCKET_PODCAST_KEY = "podcast";
export const R2_BUCKET_AUDITS_KEY = "audits";
export const R2_PUBLIC_BASE_URL_PODCAST_RESOLVED = R2_PUBLIC_BASE_URL_PODCAST || R2_PUBLIC_BASE_URL_PODCAST_OUTPUT;
export const R2_PUBLIC_BASE_URL_RSS_RESOLVED = R2_PUBLIC_BASE_URL_RSS || R2_PUBLIC_BASE_URL_RSS_FEEDS;

// ------------------------------------------------------------
// 🪣 Bucket Aliases (all services unify on these keys)
// ------------------------------------------------------------
export const R2_BUCKETS = {
  podcast:         R2_BUCKET_PODCAST,
  R2_BUCKET_RAW:    R2_BUCKET_RAW || RAW_AUDIO_BUCKET_NAME,
  rawtext:         R2_BUCKET_RAW_TEXT,
  rawText:         R2_BUCKET_RAW_TEXT,
  "raw-text":      R2_BUCKET_RAW_TEXT,
  meta:            R2_BUCKET_META,
  merged:          R2_BUCKET_MERGED,
  art:             R2_BUCKET_ART,

  chunks:          RAW_AUDIO_BUCKET_NAME,
  "podcast-chunks":RAW_AUDIO_BUCKET_NAME,

  // Raw audio (TTS output, pre-merge)
  rawAudio:        RAW_AUDIO_BUCKET_NAME,
  rawaudio:        RAW_AUDIO_BUCKET_NAME,
  "raw-audio":     RAW_AUDIO_BUCKET_NAME,

  // Newsletter RSS feed
  rss:             R2_BUCKET_RSS_FEEDS,
  "rss-feeds":     R2_BUCKET_RSS_FEEDS,
  rssfeeds:        R2_BUCKET_RSS_FEEDS,

  // Podcast RSS feed
  podcastRss:      R2_BUCKET_PODCAST_RSS_FEEDS,

  // Transcripts
  transcripts:     R2_BUCKET_TRANSCRIPTS,
  transcript:      R2_BUCKET_TRANSCRIPTS,

  // NEW — final edited/mastered audio
  edited:          R2_BUCKET_EDITED_AUDIO,

  // Blog (HTML)
  blog:            R2_BUCKET_BLOG,

  // Blog images (header art)
  blogImages:      R2_BUCKET_BLOG_IMAGES,
  blogimages:      R2_BUCKET_BLOG_IMAGES,
  "blog-images":   R2_BUCKET_BLOG_IMAGES,

  // Blog RSS feed
  blogRss:         R2_BUCKET_BLOG_RSS,
  blogrss:         R2_BUCKET_BLOG_RSS,
  "blog-rss":      R2_BUCKET_BLOG_RSS,

  // Audit reports
  audits:          R2_BUCKET_AUDITS,
  audit:           R2_BUCKET_AUDITS,

  // Brand assets / legacy non-audit assets
  brandAssets:     R2_BUCKET_BRAND_ASSETS,
  brandassets:     R2_BUCKET_BRAND_ASSETS,
  "brand-assets":  R2_BUCKET_BRAND_ASSETS,

  // Legacy/compat (read-only)
  R2_BUCKET_PODCAST_OUTPUT,
  R2_BUCKET_RAW_TEXT_INPUT,
  editedAudio:     R2_BUCKET_EDITED_AUDIO,
  "edited-audio":  R2_BUCKET_EDITED_AUDIO,

  // Comms Hub operational receipts (private-ready; never store message content or attachments)
  commsHub:        R2_BUCKET_COMMS_HUB,
  commshub:        R2_BUCKET_COMMS_HUB,
  "comms-hub":     R2_BUCKET_COMMS_HUB,

  // NEW — metasystem bucket (episode-counter + system files)
  metasystem:      META_SYSTEM_BUCKET_NAME,
  metaSystem:      META_SYSTEM_BUCKET_NAME,
};

// ------------------------------------------------------------
// 🌍 Public URL Aliases
// ------------------------------------------------------------
export const BUCKET_ENV_BY_ALIAS = {
  podcast: "R2_BUCKET_PODCAST",
  R2_BUCKET_RAW: "R2_BUCKET_RAW",
  rawtext: "R2_BUCKET_RAW_TEXT",
  rawText: "R2_BUCKET_RAW_TEXT",
  "raw-text": "R2_BUCKET_RAW_TEXT",
  meta: "R2_BUCKET_META",
  merged: "R2_BUCKET_MERGED",
  art: "R2_BUCKET_ART",
  chunks: "R2_BUCKET_CHUNKS",
  "podcast-chunks": "R2_BUCKET_CHUNKS",
  rawAudio: "R2_BUCKET_CHUNKS",
  rawaudio: "R2_BUCKET_CHUNKS",
  "raw-audio": "R2_BUCKET_CHUNKS",
  rss: "R2_BUCKET_RSS_FEEDS",
  "rss-feeds": "R2_BUCKET_RSS_FEEDS",
  rssfeeds: "R2_BUCKET_RSS_FEEDS",
  podcastRss: "R2_BUCKET_PODCAST_RSS_FEEDS",
  transcripts: "R2_BUCKET_TRANSCRIPTS",
  transcript: "R2_BUCKET_TRANSCRIPTS",
  edited: "R2_BUCKET_EDITED_AUDIO",
  editedAudio: "R2_BUCKET_EDITED_AUDIO",
  "edited-audio": "R2_BUCKET_EDITED_AUDIO",
  blog: "R2_BUCKET_BLOG",
  blogImages: "R2_BUCKET_BLOG_IMAGES",
  blogimages: "R2_BUCKET_BLOG_IMAGES",
  "blog-images": "R2_BUCKET_BLOG_IMAGES",
  blogRss: "R2_BUCKET_BLOG_RSS",
  blogrss: "R2_BUCKET_BLOG_RSS",
  "blog-rss": "R2_BUCKET_BLOG_RSS",
  audits: "R2_BUCKET_AUDITS",
  audit: "R2_BUCKET_AUDITS",
  brandAssets: "R2_BUCKET_BRAND_ASSETS",
  brandassets: "R2_BUCKET_BRAND_ASSETS",
  "brand-assets": "R2_BUCKET_BRAND_ASSETS",
  commsHub: "R2_BUCKET_COMMS_HUB",
  commshub: "R2_BUCKET_COMMS_HUB",
  "comms-hub": "R2_BUCKET_COMMS_HUB",
  metasystem: META_SYSTEM_BUCKET_ENV_NAME,
  metaSystem: META_SYSTEM_BUCKET_ENV_NAME,
};

export const PUBLIC_URL_ENV_BY_ALIAS = {
  podcast: "R2_PUBLIC_BASE_URL_PODCAST",
  rawtext: "R2_PUBLIC_BASE_URL_RAW_TEXT",
  rawText: "R2_PUBLIC_BASE_URL_RAW_TEXT",
  "raw-text": "R2_PUBLIC_BASE_URL_RAW_TEXT",
  meta: "R2_PUBLIC_BASE_URL_META",
  merged: "R2_PUBLIC_BASE_URL_MERGE",
  art: "R2_PUBLIC_BASE_URL_ART",
  rss: "R2_PUBLIC_BASE_URL_RSS",
  "rss-feeds": "R2_PUBLIC_BASE_URL_RSS",
  transcript: "R2_PUBLIC_BASE_URL_TRANSCRIPT_HTML or R2_PUBLIC_BASE_URL_TRANSCRIPT",
  transcripts: "R2_PUBLIC_BASE_URL_TRANSCRIPT_HTML or R2_PUBLIC_BASE_URL_TRANSCRIPT",
  chunks: "R2_PUBLIC_BASE_URL_CHUNKS",
  "podcast-chunks": "R2_PUBLIC_BASE_URL_CHUNKS",
  podcastRss: "R2_PUBLIC_BASE_URL_PODCAST_RSS",
  edited: "R2_PUBLIC_BASE_URL_EDITED_AUDIO",
  editedAudio: "R2_PUBLIC_BASE_URL_EDITED_AUDIO",
  "edited-audio": "R2_PUBLIC_BASE_URL_EDITED_AUDIO",
  blog: "R2_PUBLIC_BASE_URL_BLOG",
  blogImages: "R2_PUBLIC_BASE_URL_BLOG_IMAGES",
  blogimages: "R2_PUBLIC_BASE_URL_BLOG_IMAGES",
  "blog-images": "R2_PUBLIC_BASE_URL_BLOG_IMAGES",
  blogRss: "R2_PUBLIC_BASE_URL_BLOG_RSS",
  blogrss: "R2_PUBLIC_BASE_URL_BLOG_RSS",
  "blog-rss": "R2_PUBLIC_BASE_URL_BLOG_RSS",
  audits: "R2_PUBLIC_BASE_URL_AUDITS",
  audit: "R2_PUBLIC_BASE_URL_AUDITS",
  brandAssets: "R2_PUBLIC_BASE_URL_BRAND_ASSETS",
  brandassets: "R2_PUBLIC_BASE_URL_BRAND_ASSETS",
  "brand-assets": "R2_PUBLIC_BASE_URL_BRAND_ASSETS",
  commsHub: "R2_PUBLIC_BASE_URL_COMMS_HUB",
  commshub: "R2_PUBLIC_BASE_URL_COMMS_HUB",
  "comms-hub": "R2_PUBLIC_BASE_URL_COMMS_HUB",
  metasystem: META_SYSTEM_PUBLIC_URL_ENV_NAME,
  metaSystem: META_SYSTEM_PUBLIC_URL_ENV_NAME,
};

export const R2_PUBLIC_URLS = {
  podcast:         R2_PUBLIC_BASE_URL_PODCAST,
  rawtext:         R2_PUBLIC_BASE_URL_RAW_TEXT,
  rawText:         R2_PUBLIC_BASE_URL_RAW_TEXT,
  "raw-text":      R2_PUBLIC_BASE_URL_RAW_TEXT,
  meta:            R2_PUBLIC_BASE_URL_META,
  merged:          R2_PUBLIC_BASE_URL_MERGE,
  art:             R2_PUBLIC_BASE_URL_ART,
  rss:             R2_PUBLIC_BASE_URL_RSS,
  "rss-feeds":     R2_PUBLIC_BASE_URL_RSS,

  // ✅ FIX: both singular & plural transcript aliases
  transcript:      TRANSCRIPT_PUBLIC_BASE_URL,
  transcripts:     TRANSCRIPT_PUBLIC_BASE_URL,

  chunks:          R2_PUBLIC_BASE_URL_CHUNKS,
  "podcast-chunks":R2_PUBLIC_BASE_URL_CHUNKS,

  // Podcast RSS
  podcastRss:      R2_PUBLIC_BASE_URL_PODCAST_RSS,

  // Edited/mastered audio
  edited:          R2_PUBLIC_BASE_URL_EDITED_AUDIO,
  editedAudio:     R2_PUBLIC_BASE_URL_EDITED_AUDIO,
  "edited-audio":  R2_PUBLIC_BASE_URL_EDITED_AUDIO,

  // Blog
  blog:            R2_PUBLIC_BASE_URL_BLOG,
  blogImages:      R2_PUBLIC_BASE_URL_BLOG_IMAGES,
  blogimages:      R2_PUBLIC_BASE_URL_BLOG_IMAGES,
  "blog-images":   R2_PUBLIC_BASE_URL_BLOG_IMAGES,
  blogRss:         R2_PUBLIC_BASE_URL_BLOG_RSS,
  blogrss:         R2_PUBLIC_BASE_URL_BLOG_RSS,
  "blog-rss":      R2_PUBLIC_BASE_URL_BLOG_RSS,

  // Audit reports
  audits:          R2_PUBLIC_BASE_URL_AUDITS,
  audit:           R2_PUBLIC_BASE_URL_AUDITS,

  // Brand assets / legacy non-audit assets
  brandAssets:     R2_PUBLIC_BASE_URL_BRAND_ASSETS,
  brandassets:     R2_PUBLIC_BASE_URL_BRAND_ASSETS,
  "brand-assets":  R2_PUBLIC_BASE_URL_BRAND_ASSETS,

  // Comms Hub operational receipts are private. Stale public env values are ignored.
  commsHub:        null,
  commshub:        null,
  "comms-hub":     null,

  // Durable system state is private. Stale public env values are ignored.
  metasystem:      null,
  metaSystem:      null,

  // Legacy/compat (read-only)
  R2_PUBLIC_BASE_URL_RSS_FEEDS,

  // Legacy/compat (read-only)
  R2_PUBLIC_BASE_URL_PODCAST_OUTPUT,
};

// ------------------------------------------------------------
// 🔒 Private-ready aliases
// ------------------------------------------------------------
// These buckets contain internal/intermediate/operational data. AIMS must be
// able to read/write them through authenticated R2 even while legacy public
// URLs remain temporarily enabled for other repos during the coordinated
// migration. Published delivery buckets are deliberately excluded.
export const PRIVATE_READY_BUCKET_ALIASES = Object.freeze(new Set([
  "rawtext", "rawText", "raw-text",
  "meta",
  "merged",
  "chunks", "podcast-chunks", "rawAudio", "rawaudio", "raw-audio",
  "edited", "editedAudio", "edited-audio",
  "audits", "audit",
  "commsHub", "commshub", "comms-hub",
  "metasystem", "metaSystem",
]));

export function isPrivateReadyBucket(bucketKey) {
  return PRIVATE_READY_BUCKET_ALIASES.has(String(bucketKey || ""));
}

// ------------------------------------------------------------
// 🧩 Validation Helper
// ------------------------------------------------------------
export function ensureBucketKey(bucketKey) {
  if (!Object.prototype.hasOwnProperty.call(R2_BUCKETS, bucketKey)) {
    const valid = Object.keys(R2_BUCKETS).join(", ");
    throw new Error(`❌ Unknown R2 bucket key: ${bucketKey} — valid keys: ${valid}`);
  }

  const bucket = R2_BUCKETS[bucketKey];
  if (!bucket) {
    const envName = BUCKET_ENV_BY_ALIAS[bucketKey] || `bucket alias '${bucketKey}'`;
    throw new Error(`❌ R2 bucket alias '${bucketKey}' is configured in code but missing in env (${envName}).`);
  }

  return bucket;
}

// ------------------------------------------------------------
// 🔐 Object key safety
// ------------------------------------------------------------
export function normaliseR2ObjectKey(key, { allowEmpty = false, label = "R2 object key" } = {}) {
  const raw = String(key ?? "").trim();

  if (!raw) {
    if (allowEmpty) return "";
    throw new Error(`${label} is required`);
  }

  const normalised = raw.replace(/\\+/g, "/").replace(/^\/+/, "");
  const segments = normalised.split("/");

  if (raw.startsWith("/")) {
    throw new Error(`${label} must be relative, not absolute`);
  }

  if (segments.some((segment) => segment === ".." || segment === ".")) {
    throw new Error(`${label} contains unsafe path traversal segment`);
  }

  if (/[\x00-\x1F\x7F]/.test(normalised)) {
    throw new Error(`${label} contains control characters`);
  }

  if (/[?#]/.test(normalised)) {
    throw new Error(`${label} must not contain URL query or fragment characters`);
  }

  if (normalised.length > 1024) {
    throw new Error(`${label} exceeds the 1024 byte S3/R2 object key limit`);
  }

  return normalised;
}

export function assertSafeR2ObjectKey(key, options = {}) {
  return normaliseR2ObjectKey(key, options);
}

// ------------------------------------------------------------
// 🔗 Public URL Joiner
// ------------------------------------------------------------
function joinPublicUrl(base, key) {
  const safeKey = normaliseR2ObjectKey(key);
  return `${String(base || "").replace(/\/+$/, "")}/${safeKey}`;
}

// ------------------------------------------------------------
// ⚙️ Upload / Download
// ------------------------------------------------------------
export async function uploadBuffer(bucketKey, key, buffer, contentType = "application/octet-stream", options = {}) {
  const bucket = ensureBucketKey(bucketKey);
  const safeKey = normaliseR2ObjectKey(key);
  const cacheControl = String(options?.cacheControl || "").trim();

  await sendR2Command(
    new PutObjectCommand({
      Bucket: bucket,
      Key: safeKey,
      Body: buffer,
      ContentType: contentType,
      ...(cacheControl ? { CacheControl: cacheControl } : {}),
    })
  );

  const base = R2_PUBLIC_URLS[bucketKey];
  if (!base) {
    const envName = PUBLIC_URL_ENV_BY_ALIAS[bucketKey] || `public URL alias '${bucketKey}'`;
    throw new Error(`❌ No public URL configured for R2 bucket alias '${bucketKey}' (${envName}).`);
  }

  return joinPublicUrl(base, safeKey);
}

export async function uploadText(bucketKey, key, text, contentType = "text/plain", options = {}) {
  return uploadBuffer(bucketKey, key, Buffer.from(text, "utf-8"), contentType, options);
}

// Private/internal writes deliberately do not construct or require a public URL.
// The returned r2:// reference is safe to persist/log and can be resolved by
// authenticated AIMS code without anonymous HTTP access.
export async function uploadPrivateBuffer(bucketKey, key, buffer, contentType = "application/octet-stream", options = {}) {
  const bucket = ensureBucketKey(bucketKey);
  const safeKey = normaliseR2ObjectKey(key);
  const cacheControl = String(options?.cacheControl || "no-store, max-age=0").trim();

  await sendR2Command(
    new PutObjectCommand({
      Bucket: bucket,
      Key: safeKey,
      Body: buffer,
      ContentType: contentType,
      ...(cacheControl ? { CacheControl: cacheControl } : {}),
    })
  );

  return Object.freeze({ bucket, key: safeKey, uri: `r2://${bucket}/${safeKey}` });
}

export async function uploadPrivateText(bucketKey, key, text, contentType = "text/plain", options = {}) {
  return uploadPrivateBuffer(bucketKey, key, Buffer.from(text, "utf-8"), contentType, options);
}

export async function getObjectAsBuffer(bucketKey, key) {
  const bucket = ensureBucketKey(bucketKey);
  const safeKey = normaliseR2ObjectKey(key);
  const response = await sendR2Command(new GetObjectCommand({ Bucket: bucket, Key: safeKey }));
  const chunks = [];
  for await (const chunk of response.Body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function getObjectAsText(bucketKey, key) {
  return (await getObjectAsBuffer(bucketKey, key)).toString("utf-8");
}

export function buildR2Reference(bucketKey, key) {
  const bucket = ensureBucketKey(bucketKey);
  const safeKey = normaliseR2ObjectKey(key);
  return `r2://${bucket}/${safeKey}`;
}

export function parseR2Reference(reference) {
  const raw = String(reference || "").trim();
  if (!raw.startsWith("r2://")) return null;
  const withoutScheme = raw.slice(5);
  const slash = withoutScheme.indexOf("/");
  if (slash <= 0) throw new Error("Invalid r2:// object reference");
  const bucket = withoutScheme.slice(0, slash);
  const key = normaliseR2ObjectKey(withoutScheme.slice(slash + 1));
  return Object.freeze({ bucket, key });
}

export async function getR2ReferenceAsBuffer(reference) {
  const parsed = parseR2Reference(reference);
  if (!parsed) throw new Error("Expected an r2:// object reference");
  const response = await sendR2Command(new GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }));
  const chunks = [];
  for await (const chunk of response.Body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

// ------------------------------------------------------------
// 🔁 Legacy Aliases
// ------------------------------------------------------------
export const putObject = uploadBuffer;
export const r2Put = uploadBuffer;
export const putText = uploadText;
export const getObject = getObjectAsText;
export const r2Get = getObjectAsText;

export const putJson = async (bucketKey, key, obj) =>
  uploadText(bucketKey, key, JSON.stringify(obj, null, 2), "application/json");

export const putPrivateJson = async (bucketKey, key, obj, options = {}) =>
  uploadPrivateText(bucketKey, key, JSON.stringify(obj, null, 2), "application/json", options);

export function buildPublicUrl(bucketKey, key) {
  const base = R2_PUBLIC_URLS[bucketKey];
  if (!base) {
    const envName = PUBLIC_URL_ENV_BY_ALIAS[bucketKey] || `public URL alias '${bucketKey}'`;
    throw new Error(`❌ No public URL configured for ${bucketKey} (${envName})`);
  }
  return joinPublicUrl(base, key);
}

// ------------------------------------------------------------
// 🧰 Utilities
// ------------------------------------------------------------
export async function listObjects(bucketKey, prefix = "") {
  const bucket = ensureBucketKey(bucketKey);
  const safePrefix = normaliseR2ObjectKey(prefix, { allowEmpty: true, label: "R2 list prefix" });
  const objects = [];
  let continuationToken;

  do {
    const response = await sendR2Command(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: safePrefix,
        ContinuationToken: continuationToken,
      })
    );

    if (response.Contents?.length) {
      objects.push(
        ...response.Contents
          .filter((item) => item?.Key)
          .map((item) => ({
            key: item.Key,
            lastModified: item.LastModified instanceof Date ? item.LastModified.toISOString() : item.LastModified || null,
            size: Number.isFinite(Number(item.Size)) ? Number(item.Size) : null,
            eTag: item.ETag || null,
          }))
      );
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

export async function listKeys(bucketKey, prefix = "") {
  const objects = await listObjects(bucketKey, prefix);
  return objects.map((item) => item.key).filter(Boolean);
}

export async function deleteObject(bucketKey, key) {
  const bucket = ensureBucketKey(bucketKey);
  const safeKey = normaliseR2ObjectKey(key);
  await sendR2Command(new DeleteObjectCommand({ Bucket: bucket, Key: safeKey }));
  log.info("🗑️ R2 object deleted", { bucket, key: safeKey });
}

// ------------------------------------------------------------
// 🧾 Startup Log
// ------------------------------------------------------------
log.debug("r2-client.initialized", {
  endpoint: R2_ENDPOINT,
  region: R2_REGION,
  buckets: Object.keys(R2_BUCKETS),
});

// ------------------------------------------------------------
// 📦 Default Export
// ------------------------------------------------------------
export default {
  s3,
  R2_BUCKETS,
  R2_PUBLIC_URLS,
  PRIVATE_READY_BUCKET_ALIASES,
  isPrivateReadyBucket,
  R2_BUCKET_RAW_AUDIO,
  R2_BUCKET_RAW_TEXT_KEY,
  R2_BUCKET_PODCAST_KEY,
  R2_BUCKET_AUDITS_KEY,
  R2_PUBLIC_BASE_URL_PODCAST_RESOLVED,
  R2_PUBLIC_BASE_URL_RSS_RESOLVED,
  uploadBuffer,
  uploadText,
  uploadPrivateBuffer,
  uploadPrivateText,
  getObjectAsText,
  getObjectAsBuffer,
  buildR2Reference,
  parseR2Reference,
  getR2ReferenceAsBuffer,
  deleteObject,
  listObjects,
  listKeys,
  putObject,
  putJson,
  putPrivateJson,
  putText,
  buildPublicUrl,
  normaliseR2ObjectKey,
  assertSafeR2ObjectKey,
  getObject,
  r2Put,
  r2Get,
};
