// services/rss-links/store.js
//
// R2-backed storage for the self-hosted RSS link shortener.
// All objects live in the newsletter RSS bucket alias (`rss`), which maps to
// R2_BUCKET_RSS_FEEDS / R2_PUBLIC_BASE_URL_RSS in services/shared/utils/r2-client.js.

import { getObjectAsText, putJson, putText } from "../shared/utils/r2-client.js";
import { debug, warn } from "../../logger.js";

export const RSS_LINKS_BUCKET_ALIAS = "rss";
export const RSS_LINKS_PREFIX = "rss-links";
export const RSS_LINKS_RECORDS_PREFIX = `${RSS_LINKS_PREFIX}/_records`;
export const RSS_LINKS_URL_INDEX_PREFIX = `${RSS_LINKS_PREFIX}/_index/by-url`;

export function recordObjectKey(key) {
  return `${RSS_LINKS_RECORDS_PREFIX}/${key}.json`;
}

export function urlIndexObjectKey(hash) {
  return `${RSS_LINKS_URL_INDEX_PREFIX}/${hash}.json`;
}

export function redirectPageObjectKey(key) {
  return `${RSS_LINKS_PREFIX}/${key}/index.html`;
}

function isMissingObjectError(err) {
  const name = err?.name || err?.Code || err?.code;
  return name === "NoSuchKey" || name === "NotFound" || err?.$metadata?.httpStatusCode === 404;
}

async function readJsonFromR2(key) {
  try {
    const raw = await getObjectAsText(RSS_LINKS_BUCKET_ALIAS, key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    if (isMissingObjectError(err)) {
      debug("rss-links.store.miss", { bucket: RSS_LINKS_BUCKET_ALIAS, key });
      return null;
    }

    warn("rss-links.store.read.fail", {
      bucket: RSS_LINKS_BUCKET_ALIAS,
      key,
      error: err?.message,
    });
    throw err;
  }
}

export async function readRecordByKey(key) {
  return readJsonFromR2(recordObjectKey(key));
}

export async function readUrlIndexByHash(hash) {
  return readJsonFromR2(urlIndexObjectKey(hash));
}

export async function writeRecord(record) {
  const key = recordObjectKey(record.key);
  await putJson(RSS_LINKS_BUCKET_ALIAS, key, record);
  debug("rss-links.store.record.put", { bucket: RSS_LINKS_BUCKET_ALIAS, key });
  return key;
}

export async function writeUrlIndex(indexRecord) {
  const key = urlIndexObjectKey(indexRecord.urlHash);
  await putJson(RSS_LINKS_BUCKET_ALIAS, key, indexRecord);
  debug("rss-links.store.index.put", { bucket: RSS_LINKS_BUCKET_ALIAS, key });
  return key;
}

export async function writeRedirectPage(key, html) {
  const objectKey = redirectPageObjectKey(key);
  await putText(RSS_LINKS_BUCKET_ALIAS, objectKey, html, "text/html; charset=utf-8");
  debug("rss-links.store.redirectPage.put", {
    bucket: RSS_LINKS_BUCKET_ALIAS,
    key: objectKey,
  });
  return objectKey;
}
