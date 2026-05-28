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

async function sendR2Command(command, { timeoutMs = R2_REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  try {
    return await s3.send(command, { abortSignal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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

  // NEW — metasystem public URL
  metasystem:      META_SYSTEM_PUBLIC_BASE_URL,
  metaSystem:      META_SYSTEM_PUBLIC_BASE_URL,

  // Legacy/compat (read-only)
  R2_PUBLIC_BASE_URL_RSS_FEEDS,

  // Legacy/compat (read-only)
  R2_PUBLIC_BASE_URL_PODCAST_OUTPUT,
};

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
// 🔗 Public URL Joiner
// ------------------------------------------------------------
function joinPublicUrl(base, key) {
  return `${String(base || "").replace(/\/+$/, "")}/${String(key || "").replace(/^\/+/, "")}`;
}

// ------------------------------------------------------------
// ⚙️ Upload / Download
// ------------------------------------------------------------
export async function uploadBuffer(bucketKey, key, buffer, contentType = "application/octet-stream") {
  const bucket = ensureBucketKey(bucketKey);

  await sendR2Command(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );

  const base = R2_PUBLIC_URLS[bucketKey];
  if (!base) {
    const envName = PUBLIC_URL_ENV_BY_ALIAS[bucketKey] || `public URL alias '${bucketKey}'`;
    throw new Error(`❌ No public URL configured for R2 bucket alias '${bucketKey}' (${envName}).`);
  }

  return joinPublicUrl(base, key);
}

export async function uploadText(bucketKey, key, text, contentType = "text/plain") {
  return uploadBuffer(bucketKey, key, Buffer.from(text, "utf-8"), contentType);
}

export async function getObjectAsText(bucketKey, key) {
  const bucket = ensureBucketKey(bucketKey);
  const response = await sendR2Command(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks = [];
  for await (const chunk of response.Body) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
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
  const objects = [];
  let continuationToken;

  do {
    const response = await sendR2Command(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
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
  await sendR2Command(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  log.info("🗑️ R2 object deleted", { bucket, key });
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
  R2_BUCKET_RAW_AUDIO,
  R2_BUCKET_RAW_TEXT_KEY,
  R2_BUCKET_PODCAST_KEY,
  R2_BUCKET_AUDITS_KEY,
  R2_PUBLIC_BASE_URL_PODCAST_RESOLVED,
  R2_PUBLIC_BASE_URL_RSS_RESOLVED,
  uploadBuffer,
  uploadText,
  getObjectAsText,
  deleteObject,
  listObjects,
  listKeys,
  putObject,
  putJson,
  putText,
  buildPublicUrl,
  getObject,
  r2Put,
  r2Get,
};
