// services/rss-links/service.js
//
// Shared self-hosted RSS link creation logic.
// Used by both the RSS feed creator and POST /rss-links/shorten.

import { buildPublicUrl } from "../shared/utils/r2-client.js";
import { debug } from "../../logger.js";
import { checkURL } from "./utils/checkURL.js";
import { randomString } from "./utils/randomString.js";
import { sha512 } from "./utils/sha512.js";
import {
  readRecordByKey,
  readUrlIndexByHash,
  recordObjectKey,
  redirectPageObjectKey,
  urlIndexObjectKey,
  writeRecord,
  writeRedirectPage,
  writeUrlIndex,
} from "./store.js";

const SHORT_KEY_RE = /^[A-Za-z0-9]{4,32}$/;

export function normaliseOriginalUrl(url) {
  const trimmed = String(url || "").trim();
  if (!checkURL(trimmed)) {
    throw new Error("URL must be an absolute http/https URL");
  }
  return new URL(trimmed).href;
}

export function normaliseShortKey(key) {
  const trimmed = String(key || "").trim();
  if (!SHORT_KEY_RE.test(trimmed)) {
    throw new Error("Invalid RSS short-link key");
  }
  return trimmed;
}

export function buildShortUrl(key) {
  const safeKey = normaliseShortKey(key);
  return buildPublicUrl("rss", `rss-links/${safeKey}/`);
}

export async function getShortLinkRecord(key) {
  const safeKey = normaliseShortKey(key);
  const record = await readRecordByKey(safeKey);
  if (!record?.originalUrl) return null;

  return {
    ...record,
    key: safeKey,
    shortUrl: record.shortUrl || buildShortUrl(safeKey),
  };
}

export async function createShortLink(originalUrl) {
  const url = normaliseOriginalUrl(originalUrl);
  const urlHash = sha512(url);

  const existingIndex = await readUrlIndexByHash(urlHash);
  if (existingIndex?.key) {
    const existingRecord = await getShortLinkRecord(existingIndex.key).catch(() => null);
    if (existingRecord?.originalUrl) {
      debug("rss-links.create.dedup.hit", { key: existingRecord.key, urlHash });
      return toCreateResult(existingRecord, false);
    }
  }

  const key = await generateUniqueKey();
  const now = new Date().toISOString();
  const shortUrl = buildShortUrl(key);

  const record = {
    key,
    originalUrl: url,
    urlHash,
    shortUrl,
    createdAt: now,
    updatedAt: now,
    storage: {
      bucketAlias: "rss",
      bucketEnv: "R2_BUCKET_RSS_FEEDS",
      publicBaseUrlEnv: "R2_PUBLIC_BASE_URL_RSS",
      recordKey: recordObjectKey(key),
      indexKey: urlIndexObjectKey(urlHash),
      redirectPageKey: redirectPageObjectKey(key),
    },
  };

  const indexRecord = {
    urlHash,
    key,
    originalUrl: url,
    shortUrl,
    recordKey: recordObjectKey(key),
    updatedAt: now,
  };

  await writeRecord(record);
  await writeUrlIndex(indexRecord);
  await writeRedirectPage(key, buildRedirectPageHtml(record));

  debug("rss-links.create.created", { key, urlHash });
  return toCreateResult(record, true);
}

async function generateUniqueKey(attempts = 0) {
  if (attempts > 10) {
    throw new Error("rss-links: failed to generate a unique key after 10 attempts");
  }

  const key = randomString();
  const existing = await readRecordByKey(key);
  if (!existing) return key;
  return generateUniqueKey(attempts + 1);
}

function toCreateResult(record, created) {
  return {
    key: record.key,
    originalUrl: record.originalUrl,
    urlHash: record.urlHash,
    shortUrl: record.shortUrl || buildShortUrl(record.key),
    created,
    record,
  };
}

function buildRedirectPageHtml(record) {
  const safeTarget = escapeHtml(record.originalUrl);
  const scriptTarget = JSON.stringify(record.originalUrl);

  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="robots" content="noindex, nofollow">
  <meta http-equiv="refresh" content="0;url=${safeTarget}">
  <title>Redirecting…</title>
</head>
<body>
  <p>Redirecting to <a href="${safeTarget}">${safeTarget}</a>.</p>
  <script>window.location.replace(${scriptTarget});</script>
</body>
</html>
`;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
