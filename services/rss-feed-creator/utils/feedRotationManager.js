// ============================================================
// 🧭 Feed Rotation Manager
// ============================================================
// Rotates through rss-feeds.txt and url-feeds.txt on each endpoint call
// Persists rotation index in R2 (feed-rotation.json)
// ============================================================

import fs from "fs";
import path from "path";
import { info, error } from "../../../logger.js";
import { getObjectAsText, putJson } from "../../shared/utils/r2-client.js";

const R2_BUCKET = "rss";

const ROTATION_FILE = "data/feed-rotation.json";
const RSS_FILE = "rss-feeds.txt";
const URL_FILE = "url-feeds.txt";

const MAX_RSS_FEEDS_PER_RUN = Number(process.env.MAX_RSS_FEEDS_PER_RUN) || 5;
const MAX_URL_FEEDS_PER_RUN = Number(process.env.MAX_URL_FEEDS_PER_RUN) || 1;

function parseList(text = "") {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

function localFilenameCandidates(filename) {
  if (filename === RSS_FILE) return [RSS_FILE, "feeds.txt"];
  if (filename === URL_FILE) return [URL_FILE, "urls.txt"];
  return [filename];
}

function r2KeyCandidates(filename) {
  if (filename === RSS_FILE) return ["data/rss-feeds.txt", "data/feeds.txt"];
  if (filename === URL_FILE) return ["data/url-feeds.txt", "data/urls.txt"];
  return [`data/${filename}`];
}

async function readFileOrR2(filename) {
  for (const candidate of localFilenameCandidates(filename)) {
    const localPath = path.resolve("services/rss-feed-creator/data", candidate);
    if (fs.existsSync(localPath)) {
      return fs.readFileSync(localPath, "utf-8");
    }
  }

  for (const key of r2KeyCandidates(filename)) {
    try {
      return await getObjectAsText(R2_BUCKET, key);
    } catch {}
  }

  error("feedRotation.readFile.fail", { filename, err: "file not found locally or in R2" });
  return "";
}

export async function loadRotationState() {
  try {
    const text = await getObjectAsText(R2_BUCKET, ROTATION_FILE);
    return JSON.parse(text);
  } catch {
    return { rssIndex: 0, urlIndex: 0 };
  }
}

export async function saveFeedRotation(state) {
  await putJson(R2_BUCKET, ROTATION_FILE, state);
  info("feedRotation.saved", state);
}

export async function loadNextFeedBatch() {
  const rssText = await readFileOrR2(RSS_FILE);
  const urlText = await readFileOrR2(URL_FILE);
  const rssList = parseList(rssText);
  const urlList = parseList(urlText);

  if (rssList.length === 0 && urlList.length === 0) {
    throw new Error("No feeds found in either file");
  }

  const rotation = await loadRotationState();
  const rssIndex = rotation.rssIndex || 0;
  const urlIndex = rotation.urlIndex || 0;

  const nextRss = [];
  for (let i = 0; i < MAX_RSS_FEEDS_PER_RUN && rssList.length > 0; i++) {
    nextRss.push(rssList[(rssIndex + i) % rssList.length]);
  }

  const nextUrl = [];
  for (let i = 0; i < MAX_URL_FEEDS_PER_RUN && urlList.length > 0; i++) {
    nextUrl.push(urlList[(urlIndex + i) % urlList.length]);
  }

  const newState = {
    rssIndex: rssList.length ? (rssIndex + MAX_RSS_FEEDS_PER_RUN) % rssList.length : 0,
    urlIndex: urlList.length ? (urlIndex + MAX_URL_FEEDS_PER_RUN) % urlList.length : 0,
  };

  await saveFeedRotation(newState);

  info("feedRotation.nextBatch", {
    rssIndex,
    urlIndex,
    nextRssCount: nextRss.length,
    nextUrlCount: nextUrl.length,
  });

  return {
    rssFeeds: nextRss,
    urlFeeds: nextUrl,
  };
}
