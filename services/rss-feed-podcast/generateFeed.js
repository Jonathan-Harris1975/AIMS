// ============================================================
// 🧩 RSS Feed XML Generator (PSP-1 / Podcasting 2.0 Ready)
// ============================================================

import { buildRssXml } from "./xmlBuilder.js";
import { buildLegacyItunesKeywordsCsv, buildPodcastDiscoveryMetadata, normaliseDiscoveryTerms } from "./discoveryMetadata.js";
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

function stripQuotes(str) {
  return String(str).replace(/^"+|"+$/g, "").trim();
}

function isAbsoluteHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function joinUrl(base, segment) {
  return `${String(base || "").replace(/\/$/, "")}/${String(segment || "").replace(/^\//, "")}`;
}

function hasPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function isEpisodePublicationReady(meta = {}) {
  if (meta.episodePublicationReady === true || meta.productionComplete === true) return true;

  // Backwards compatibility for older, genuinely produced episodes that pre-date
  // the explicit lifecycle marker. Planned metadata must not satisfy this gate.
  return (
    isAbsoluteHttpUrl(meta.podcastUrl) &&
    hasPositiveNumber(meta.fileSize) &&
    (hasPositiveNumber(meta.actualDurationSeconds) || hasPositiveNumber(meta.duration))
  );
}

function buildEpisodePageUrl(meta, sessionId) {
  const explicitPageUrl = stripQuotes(meta.episodePageUrl || "");
  if (isAbsoluteHttpUrl(explicitPageUrl)) {
    return explicitPageUrl;
  }

  const configuredBase = stripQuotes(envString("PODCAST_EPISODE_BASE_URL"));
  const slug = stripQuotes(meta.episodeSlug || slugify(meta.title));

  if (isAbsoluteHttpUrl(configuredBase) && slug) {
    return joinUrl(configuredBase, `${slug}/`);
  }

  const siteBaseUrl = stripQuotes(envString("SITE_BASE_URL") || "https://jonathan-harris.online");
  if (isAbsoluteHttpUrl(siteBaseUrl) && slug) {
    return joinUrl(siteBaseUrl, `podcast/episodes/${slug}/`);
  }

  if (isAbsoluteHttpUrl(configuredBase) && sessionId) {
    return joinUrl(configuredBase, `${sessionId}/`);
  }

  return "";
}

function resolveTranscript(meta, sessionId) {
  const htmlUrl = stripQuotes(meta.transcriptHtmlUrl || meta.transcript_url_html || "");
  const textUrl = stripQuotes(
    meta.transcriptTextUrl || meta.transcriptUrl || meta.transcript_url || ""
  );
  const siteBaseUrl = stripQuotes(envString("SITE_BASE_URL") || "https://jonathan-harris.online");

  if (isAbsoluteHttpUrl(htmlUrl)) {
    return { url: htmlUrl, type: "text/html" };
  }

  const transcriptHtmlBase = stripQuotes(
    envString(
      "PODCAST_TRANSCRIPT_HTML_BASE_URL",
      "R2_PUBLIC_BASE_URL_TRANSCRIPT_HTML"
    )
  ) || (isAbsoluteHttpUrl(siteBaseUrl) ? joinUrl(siteBaseUrl, "transcripts") : stripQuotes(envString("R2_PUBLIC_BASE_URL_TRANSCRIPT")));
  if (isAbsoluteHttpUrl(transcriptHtmlBase) && sessionId) {
    return { url: joinUrl(transcriptHtmlBase, `${sessionId}.html`), type: "text/html" };
  }

  if (isAbsoluteHttpUrl(textUrl)) {
    return { url: textUrl, type: "text/plain" };
  }

  return { url: "", type: "" };
}

export function generateFeedXML(episodesMeta) {
  if (!Array.isArray(episodesMeta) || episodesMeta.length === 0) {
    throw new Error("No episode metadata provided to generateFeedXML");
  }

  const sorted = [...episodesMeta].sort((a, b) => {
    const da = new Date(a.pubDate || a.updatedAt || 0).getTime();
    const db = new Date(b.pubDate || b.updatedAt || 0).getTime();
    return db - da;
  });

  info(`📝 Building RSS feed with ${sorted.length} episode(s)`);

  const rawLang = envString("PODCAST_LANGUAGE") || "en-gb";
  const language = rawLang === "en-uk" ? "en-gb" : rawLang;
  const lockedRaw = (envString("PODCAST_LOCKED") || "yes").toLowerCase();
  const podcastLocked = lockedRaw === "no" ? "no" : "yes";

  const channelTitle = envString("PODCAST_TITLE") || "Turing’s Torch: Artificial Intelligence Weekly";
  const channelDescription =
    envString("PODCAST_DESCRIPTION") ||
    "Hosted by Jonathan Harris, Turing's Torch AI Weekly cuts through artificial intelligence news, AI governance, automation and model hype with sceptical, plain-English analysis for people who would rather not swallow the vendor confetti.";
  const channelCategories = [envString("PODCAST_CATEGORY_1"), envString("PODCAST_CATEGORY_2")].filter(Boolean);
  const channelDiscovery = buildPodcastDiscoveryMetadata({
    title: channelTitle,
    description: channelDescription,
    channelKeywords: envString("PODCAST_ITUNES_KEYWORDS", "itunes_keywords"),
    categories: channelCategories,
  });

  const channel = {
    title: channelTitle,
    link: stripQuotes(envString("PODCAST_LINK")) || "https://jonathan-harris.online/podcast/",
    description: channelDescription,
    language,
    copyright: envString("PODCAST_COPYRIGHT") || `© ${new Date().getUTCFullYear()} Jonathan Harris`,
    itunesAuthor: envString("PODCAST_AUTHOR") || "Jonathan Harris",
    itunesExplicit: envString("PODCAST_EXPLICIT") || "no",
    itunesType: envString("PODCAST_ITUNES_TYPE", "itunes_type") || "episodic",
    itunesKeywords: channelDiscovery.legacy.itunesKeywordsCsv,
    ownerName: envString("PODCAST_OWNER_NAME") || "Jonathan Harris",
    ownerEmail: envString("PODCAST_OWNER_EMAIL"),
    imageUrl: envString("PODCAST_IMAGE_URL"),
    categories: channelCategories,
    fundingUrl: envString("PODCAST_FUNDING_URL", "funding_url"),
    fundingText: envString("PODCAST_FUNDING_TEXT", "funding_text"),
    rssSelfLink:
      stripQuotes(envString("PODCAST_RSS_FEED_URL")) ||
      stripQuotes(R2_PUBLIC_BASE_URL_RSS_RESOLVED || ""),
    podcastGuid:
      stripQuotes(envString("PODCAST_GUID")) ||
      stripQuotes(envString("PODCAST_LINK")) ||
      "turing-torch-ai-weekly",
    podcastLocked,
    podcastLockedOwner: envString("PODCAST_LOCKED_OWNER_EMAIL", "PODCAST_OWNER_EMAIL"),
    generator:
      envString("PODCAST_GENERATOR") ||
      "Turing Podcast Suite (Node.js, PSP-1 compatible)",
  };

  const items = sorted.map((meta) => mapMetaToEpisode(meta, channelDiscovery)).filter(Boolean);

  if (items.length === 0) {
    warn("⚠️ RSS generated with ZERO valid episode items.");
  } else {
    info(`📦 Final RSS will include ${items.length} item(s).`);
  }

  return buildRssXml(channel, items);
}

function mapMetaToEpisode(meta, channelDiscovery = {}) {
  const sessionId = meta.sessionId || meta.session?.sessionId || null;
  const {
    title,
    description,
    podcastUrl,
    artUrl,
    duration,
    plannedDurationSeconds,
    fileSize,
    pubDate,
    updatedAt,
    episodeNumber,
    keywords,
  } = meta;

  if (!sessionId || !title || !podcastUrl) {
    warn("⚠️ Episode metadata missing required fields – skipped", {
      title,
      podcastUrl,
      hasPodcastUrl: !!podcastUrl,
      hasSessionId: !!sessionId,
      rawSessionId: meta.sessionId,
      nestedSessionId: meta.session?.sessionId,
    });
    return null;
  }

  if (!isEpisodePublicationReady(meta)) {
    warn("podcast.rss.episode_not_produced.skipped", {
      sessionId,
      title,
      episodeNumber: meta.episodeNumber || null,
      episodePublicationReady: meta.episodePublicationReady === true,
      productionComplete: meta.productionComplete === true,
      hasPodcastUrl: isAbsoluteHttpUrl(meta.podcastUrl),
      fileSize: Number(meta.fileSize || 0),
      actualDurationSeconds: Number(meta.actualDurationSeconds || 0),
    });
    return null;
  }

  const guid = sessionId;
  const pubDateStr = pubDate
    ? new Date(pubDate).toUTCString()
    : updatedAt
    ? new Date(updatedAt).toUTCString()
    : new Date().toUTCString();

  const discoveryMetadata = meta.discoveryMetadata || buildPodcastDiscoveryMetadata({
    title,
    description: description || "",
    keywords,
    keywordCandidates: meta.seoKeywordCandidates || [],
    channelKeywords: channelDiscovery.primaryTerms || [],
  });
  const keywordsCsv = buildLegacyItunesKeywordsCsv(
    meta.itunesKeywords,
    discoveryMetadata.legacy?.itunesKeywordsCsv,
    normaliseDiscoveryTerms(keywords, meta.seoKeywordCandidates),
    { context: `${title} ${description || ""}`, fallback: false }
  );

  const transcript = resolveTranscript(meta, sessionId);
  const episodePageUrl = buildEpisodePageUrl(meta, sessionId);
  const link = isAbsoluteHttpUrl(episodePageUrl) ? episodePageUrl : "";

  if (!link) {
    warn("⚠️ Episode metadata has no publishable canonical episode link", {
      sessionId,
      title,
      episodePageUrl,
    });
  }

  return {
    title,
    description: description || "",
    guid,
    guidIsPermaLink: false,
    pubDate: pubDateStr,
    link,
    enclosureUrl: podcastUrl,
    enclosureLength: fileSize || 0,
    durationSeconds:
      typeof duration === "number"
        ? duration
        : typeof plannedDurationSeconds === "number"
        ? plannedDurationSeconds
        : null,
    episodeNumber: typeof episodeNumber === "number" ? episodeNumber : undefined,
    imageUrl: artUrl || "",
    transcriptUrl: transcript.url,
    transcriptType: transcript.type,
    keywordsCsv,
    discoveryMetadata,
  };
}
