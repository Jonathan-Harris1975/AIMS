// services/rss-feed-podcast/index.js
// ============================================================
// 📡 Podcast RSS Feed Creator - Orchestrator (FIXED)
// ============================================================
//
// - Reads episode meta JSON from R2 bucket alias "meta"
// - Builds RSS XML
// - Uploads to R2 bucket alias "podcastRss"
// - Optional: AUTO_CALL=yes → notify PodcastIndex Hub automatically
// ============================================================

import { listKeys, getObjectAsText, putObject, R2_PUBLIC_URLS } from "../shared/utils/r2-client.js";
import { info, warn, error } from "../../logger.js";
import { generateFeedXML, mapMetaToEpisode } from "./generateFeed.js";
import { hasPodcastIndexCredentials, notifyHubByUrl } from "../shared/utils/podcastIndexClient.js";

function envString(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

const META_BUCKET_ALIAS = "meta";

// FIXED: your files live in bucket root, NOT "podcast-meta/"
const META_PREFIX = "";

const RSS_BUCKET_ALIAS = "podcastRss";
const RSS_KEY = "turing-torch.xml";

// Feed URL for PodcastIndex notifications
const FEED_URL =
  envString("PODCAST_RSS_FEED_URL") ||
  `${R2_PUBLIC_URLS.podcastRss || ""}/${RSS_KEY}`;

function sessionIdFor(meta = {}) {
  return String(meta.sessionId || meta.session?.sessionId || "").trim();
}

export async function runRssFeedCreator({ requiredSessionId = null } = {}) {
  info("🚀 Starting RSS feed generation");

  // ------------------------------------------------------------
  // Load meta files
  // ------------------------------------------------------------
  let keys;
  try {
    keys = await listKeys(META_BUCKET_ALIAS, META_PREFIX);
  } catch (err) {
    error("Failed to list meta objects", { error: err.message });
    throw err;
  }

  if (!Array.isArray(keys) || keys.length === 0) {
    warn("No metadata files found in meta bucket");
    return { ok: false, reason: "no_metadata_files" };
  }

  const metaKeys = keys.filter((key) => {
    if (typeof key !== "string" || !key.endsWith(".json")) return false;
    if (key.endsWith("-tts.json") || key.endsWith("-meta.json")) return false;
    if (key.includes("/")) return false;
    return true;
  });

  if (metaKeys.length === 0) {
    warn("No .json metadata files found in meta bucket root");
    return { ok: false, reason: "no_episode_metadata_files" };
  }

  info("Found metadata files", { count: metaKeys.length });

  const episodes = [];

  for (const key of metaKeys) {
    try {
      const text = await getObjectAsText(META_BUCKET_ALIAS, key);
      const json = JSON.parse(text);
      episodes.push(json);
    } catch (err) {
      warn("Failed to parse meta file", { key, error: err.message });
    }
  }

  if (episodes.length === 0) {
    warn("No valid episode metadata parsed – RSS not generated");
    return { ok: false, reason: "no_valid_episode_metadata" };
  }

  let requiredEpisode = null;
  const required = String(requiredSessionId || "").trim();
  if (required) {
    const requiredMeta = episodes.find((episode) => sessionIdFor(episode) === required);
    if (!requiredMeta) {
      throw new Error(`Current podcast session ${required} is missing from episode metadata; refusing to report RSS publication success.`);
    }
    requiredEpisode = mapMetaToEpisode(requiredMeta);
    if (!requiredEpisode) {
      throw new Error(`Current podcast session ${required} is not publication-ready; refusing to report RSS publication success.`);
    }
    if (!/^https:\/\//i.test(String(requiredEpisode.link || ""))) {
      throw new Error(`Current podcast session ${required} has no canonical HTTPS episode page URL.`);
    }
  }

  // ------------------------------------------------------------
  // Build XML
  // ------------------------------------------------------------
  let xml;
  try {
    xml = generateFeedXML(episodes);
  } catch (err) {
    error("Failed to generate RSS XML", { error: err.message });
    throw err;
  }

  // ------------------------------------------------------------
  // Upload RSS
  // ------------------------------------------------------------
  try {
    await putObject(
      RSS_BUCKET_ALIAS,
      RSS_KEY,
      Buffer.from(xml, "utf-8"),
      "application/rss+xml"
    );

    info("RSS feed uploaded successfully", {
      bucketAlias: RSS_BUCKET_ALIAS,
      key: RSS_KEY,
    });
  } catch (err) {
    error("Failed to upload RSS feed", { error: err.message });
    throw err;
  }

  // ------------------------------------------------------------
  // PodcastIndex Auto Notify (if enabled)
  // ------------------------------------------------------------
  const shouldAutoCall =
    String(process.env.AUTO_CALL || "").toLowerCase() === "yes";

  const result = {
    ok: true,
    feedUrl: FEED_URL,
    bucketAlias: RSS_BUCKET_ALIAS,
    key: RSS_KEY,
    episodeCount: episodes.length,
    episode: requiredEpisode
      ? {
          sessionId: required,
          guid: requiredEpisode.guid,
          title: requiredEpisode.title,
          url: requiredEpisode.link,
        }
      : null,
    podcastIndex: { attempted: false, notified: false },
  };

  if (!shouldAutoCall) {
    info("AUTO_CALL disabled — PodcastIndex Hub NOT notified.");
    return result;
  }

  if (!hasPodcastIndexCredentials()) {
    info("PodcastIndex Hub notify skipped — API key/secret not configured.", {
      feedUrl: FEED_URL,
      autoCall: true,
    });
    return { ...result, podcastIndex: { attempted: false, notified: false, reason: "credentials_not_configured" } };
  }

  info("📡 AUTO_CALL=yes — notifying PodcastIndex Hub…", {
    feedUrl: FEED_URL,
  });

  try {
    const res = await notifyHubByUrl(FEED_URL);
    info("📡 PodcastIndex Hub notified successfully!", {
      result: res?.status,
      feedUrl: FEED_URL,
    });
    return { ...result, podcastIndex: { attempted: true, notified: true, status: res?.status || null } };
  } catch (err) {
    warn("⚠️ PodcastIndex Hub notify failed", {
      feedUrl: FEED_URL,
      error: String(err),
    });
    return { ...result, podcastIndex: { attempted: true, notified: false, error: err?.message || String(err) } };
  }
}

export default runRssFeedCreator;
