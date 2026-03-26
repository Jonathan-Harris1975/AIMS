// ============================================================
// 📁 File Reader Utility
// ============================================================
// Loads text files either from local data folder or Cloudflare R2.
// Supports both the current R2 naming (rss-feeds.txt/url-feeds.txt)
// and the legacy local filenames committed in this repo (feeds.txt/urls.txt).
// ============================================================

import fs from "fs";
import path from "path";
import { error, debug } from "../../../logger.js";
import { getObjectAsText } from "../../shared/utils/r2-client.js";

const R2_BUCKET = "rss";

function localFilenameCandidates(filename) {
  if (filename === "rss-feeds.txt") return ["rss-feeds.txt", "feeds.txt"];
  if (filename === "url-feeds.txt") return ["url-feeds.txt", "urls.txt"];
  return [filename];
}

function r2KeyCandidates(filename) {
  if (filename === "rss-feeds.txt") return ["data/rss-feeds.txt", "data/feeds.txt"];
  if (filename === "url-feeds.txt") return ["data/url-feeds.txt", "data/urls.txt"];
  return [`data/${filename}`];
}

/**
 * Read text file from local filesystem or Cloudflare R2.
 * @param {string} filename - Name of the file to load.
 * @returns {Promise<string>} File content as UTF-8 text.
 */
export async function readLocalOrR2File(filename) {
  for (const candidate of localFilenameCandidates(filename)) {
    const localPath = path.resolve("services/rss-feed-creator/data", candidate);

    if (fs.existsSync(localPath)) {
      debug("rss.fetchFeeds.local.hit", { requested: filename, file: candidate });
      return fs.readFileSync(localPath, "utf-8");
    }
  }

  for (const key of r2KeyCandidates(filename)) {
    try {
      const text = await getObjectAsText(R2_BUCKET, key);
      debug("rss.fetchFeeds.r2.success", { bucket: R2_BUCKET, key, requested: filename });
      return text;
    } catch {}
  }

  error("rss.fetchFeeds.read.fail", { filename, err: "file not found locally or in R2" });
  return "";
}
