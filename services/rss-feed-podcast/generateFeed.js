// ============================================================
// 🧩 RSS Feed XML Generator (PSP-1 / Podcasting 2.0 Ready)
// ============================================================
//
// Improvements:
// ✔ Accepts both meta.sessionId and meta.session.sessionId
// ✔ Strong validation + descriptive warnings
// ✔ Prevents silent episode drops
// ✔ Stable date handling (pubDate → updatedAt → now)
// ✔ Clean keyword CSV generation
// ✔ Supplies podcast:guid, podcast:locked, generator to XML builder
// ============================================================

import { buildRssXml } from "./xmlBuilder.js";
import { R2_PUBLIC_BASE_URL_RSS_RESOLVED } from "../shared/utils/r2-client.js";
import { info, warn } from "../../logger.js";

function envString(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

export function generateFeedXML(episodesMeta) {
  if (!Array.isArray(episodesMeta) || episodesMeta.length === 0) {
    throw new Error("No episode metadata provided to generateFeedXML");
  }

  // Sort newest → oldest by pubDate
  const sorted = [...episodesMeta].sort((a, b) => {
    const da = new Date(a.pubDate || a.updatedAt || 0).getTime();
    const db = new Date(b.pubDate || b.updatedAt || 0).getTime();
    return db - da;
  });

  info(`📝 Building RSS feed with ${sorted.length} episode(s)`);

  // Map show-level env vars
  const rawLang = envString("PODCAST_LANGUAGE") || "en-gb";
  const language = rawLang === "en-uk" ? "en-gb" : rawLang;

  // Podcast locked: default "yes" unless explicitly "no"
  const lockedRaw = (envString("PODCAST_LOCKED") || "yes").toLowerCase();
  const podcastLocked = lockedRaw === "no" ? "no" : "yes";

  const channel = {
    title: envString("PODCAST_TITLE") || "Podcast",
    link: stripQuotes(envString("PODCAST_LINK")),
    description: envString("PODCAST_DESCRIPTION"),
    language,
    copyright: envString("PODCAST_COPYRIGHT"),
    itunesAuthor: envString("PODCAST_AUTHOR"),
    itunesExplicit: envString("PODCAST_EXPLICIT") || "no",
    itunesType:
      envString("PODCAST_ITUNES_TYPE", "itunes_type") ||
      "episodic",
    itunesKeywords:
      envString("PODCAST_ITUNES_KEYWORDS", "itunes_keywords"),
    ownerName: envString("PODCAST_OWNER_NAME"),
    ownerEmail: envString("PODCAST_OWNER_EMAIL"),
    imageUrl: envString("PODCAST_IMAGE_URL"),
    categories: [
      envString("PODCAST_CATEGORY_1"),
      envString("PODCAST_CATEGORY_2")
    ].filter(Boolean),
    fundingUrl:
      envString("PODCAST_FUNDING_URL", "funding_url"),
    fundingText:
      envString("PODCAST_FUNDING_TEXT", "funding_text"),

    // Atom self-link (feed URL). Strongly recommended for PSP-1.
    // Prefer explicit feed URL env, fallback to RSS feeds base if set.
    rssSelfLink:
      stripQuotes(envString("PODCAST_RSS_FEED_URL")) ||
      stripQuotes(R2_PUBLIC_BASE_URL_RSS_RESOLVED || ""),

    // Podcasting 2.0 / PSP-1 recommended:
    // podcast:guid – globally unique ID for the show
    podcastGuid:
      stripQuotes(envString("PODCAST_GUID")) ||
      stripQuotes(envString("PODCAST_LINK")) || // fallback
      "turing-torch-ai-weekly",

    // podcast:locked – protect feed from unauthorised import
    podcastLocked, // "yes" or "no"
    podcastLockedOwner:
      envString("PODCAST_LOCKED_OWNER_EMAIL", "PODCAST_OWNER_EMAIL"),

    // generator – recommended by PSP to identify the tool building the feed
    generator:
      envString("PODCAST_GENERATOR") ||
      "Turing Podcast Suite (Node.js, PSP-1 compatible)"
  };

  const items = sorted.map(mapMetaToEpisode).filter(Boolean);

  if (items.length === 0) {
    warn("⚠️ RSS generated with ZERO valid episode items.");
  } else {
    info(`📦 Final RSS will include ${items.length} item(s).`);
  }

  return buildRssXml(channel, items);
}

// ============================================================
// Episode Mapper (FULLY UPDATED)
// ============================================================

function mapMetaToEpisode(meta) {
  // Robust sessionId resolution
  const sessionId =
    meta.sessionId ||
    meta.session?.sessionId ||
    null;

  const {
    title,
    description,
    podcastUrl,
    artUrl,
    transcriptUrl,
    duration,
    fileSize,
    pubDate,
    updatedAt,
    episodeNumber,
    keywords
  } = meta;

  // Detailed info for missing fields
  if (!sessionId || !title || !podcastUrl) {
    warn("⚠️ Episode metadata missing required fields – skipped", {
      title,
      podcastUrl,
      hasPodcastUrl: !!podcastUrl,
      hasSessionId: !!sessionId,
      rawSessionId: meta.sessionId,
      nestedSessionId: meta.session?.sessionId
    });
    return null;
  }

  const guid = sessionId;

  // Resilient pubDate handling
  const pubDateStr = pubDate
    ? new Date(pubDate).toUTCString()
    : updatedAt
    ? new Date(updatedAt).toUTCString()
    : new Date().toUTCString();

  // Convert keywords array → CSV
  const keywordsCsv = Array.isArray(keywords)
    ? keywords.join(", ")
    : typeof keywords === "string"
    ? keywords
    : "";

  // Per-episode link. Set PODCAST_EPISODE_BASE_URL once episode pages exist
  // (e.g. https://jonathan-harris.online/podcast/episodes/).
  // Falls back to transcriptUrl until then.
  const episodeBaseUrl = envString("PODCAST_EPISODE_BASE_URL");
  const link = episodeBaseUrl
    ? `${episodeBaseUrl.replace(/\/$/, "")}/${sessionId}/`
    : transcriptUrl || "";

  return {
    title,
    description: description || "",
    guid,
    pubDate: pubDateStr,
    link,
    enclosureUrl: podcastUrl,
    enclosureLength: fileSize || 0,
    durationSeconds: typeof duration === "number" ? duration : null,
    episodeNumber:
      typeof episodeNumber === "number" ? episodeNumber : undefined,
    imageUrl: artUrl || "",
    transcriptUrl: transcriptUrl || "",
    keywordsCsv
  };
}

// ============================================================
// Helpers
// ============================================================

function stripQuotes(str) {
  return String(str).replace(/^"+|"+$/g, "").trim();
}
