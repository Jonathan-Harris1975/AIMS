import Parser from "rss-parser";

const parser = new Parser({
  customFields: { item: [["itunes:episode", "episodeNumber"], ["itunes:summary", "itunesSummary"], ["itunes:image", "itunesImage"], ["content:encoded", "contentEncoded"]] },
});
const clean = (v = "") => String(v || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
function firstUrl(...values) {
  for (const value of values) {
    if (typeof value === "string" && /^https?:\/\//i.test(value.trim())) return value.trim();
    if (value && typeof value === "object") {
      const candidate = value.href || value.url || value.$?.href || value.$?.url;
      if (candidate && /^https?:\/\//i.test(String(candidate).trim())) return String(candidate).trim();
    }
  }
  return "";
}

function isProducedMeta(meta = {}) {
  if (meta.episodePublicationReady === true || meta.productionComplete === true) return true;
  return Boolean(firstUrl(meta.podcastUrl)) && Number(meta.fileSize || 0) > 0
    && Number(meta.actualDurationSeconds || meta.duration || meta.plannedDurationSeconds || 0) > 0;
}

function episodeDate(meta = {}) {
  return Date.parse(meta.pubDate || meta.productionCompletedAt || meta.episodePublicationReadyAt || meta.createdAt || "");
}

function normaliseProducedMeta(meta = {}) {
  return {
    title: clean(meta.title),
    description: clean(meta.episodeSummary || meta.summary || meta.shortSummary || meta.description),
    link: firstUrl(meta.episodePageUrl, meta.podcastUrl),
    audioUrl: firstUrl(meta.podcastUrl),
    imageUrl: firstUrl(meta.artUrl, meta.imageUrl),
    pubDate: meta.pubDate || meta.productionCompletedAt || meta.episodePublicationReadyAt || meta.createdAt || "",
    episodeNumber: clean(meta.episodeNumber),
    sessionId: clean(meta.sessionId || meta.session?.sessionId),
  };
}

function transcriptSample(raw = "") {
  const cleanText = clean(raw);
  if (!cleanText) return "";
  if (cleanText.length <= 2900) return cleanText;
  const middle = Math.floor(cleanText.length / 2);
  return [cleanText.slice(0, 1000), cleanText.slice(middle, middle + 1200), cleanText.slice(-600)].join(" … ");
}

export async function fetchLatestPodcastEpisode({
  feedUrl = process.env.ZERNIO_PODCAST_RSS_FEED_URL || process.env.PODCAST_RSS_FEED_URL || "https://podcast-rss-feeds.jonathan-harris.online/turing-torch.xml",
  fetchImpl = globalThis.fetch,
  beforeDate = null,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Podcast RSS fetch requires fetch.");
  const response = await fetchImpl(feedUrl, { headers: { accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1" } });
  if (!response.ok) throw new Error("Podcast RSS fetch failed with HTTP " + response.status + ".");
  const feed = await parser.parseString(await response.text());
  const items = Array.isArray(feed.items) ? feed.items : [];
  const cutoff = beforeDate ? Date.parse(beforeDate + "T00:00:00Z") : Infinity;
  const episode = items.map((item) => ({
    title: clean(item.title),
    description: clean(item.contentSnippet || item.itunesSummary || item.contentEncoded || item.content || item.summary),
    link: firstUrl(item.link, item.guid),
    audioUrl: firstUrl(item.enclosure?.url),
    imageUrl: firstUrl(item.itunesImage, item.image),
    pubDate: item.isoDate || item.pubDate || "",
    episodeNumber: clean(item.episodeNumber),
  })).filter((item) => item.title && Date.parse(item.pubDate) < cutoff)
    .sort((a, b) => Date.parse(b.pubDate || "") - Date.parse(a.pubDate || ""))[0];
  if (!episode) throw new Error("Podcast RSS has no published episode before the Thursday promotion.");
  return { ...episode, feedUrl, source: "published-rss", transcriptExcerpt: "" };
}

/**
 * Thursday must promote a genuinely published episode from last week (or the
 * latest earlier episode), never label the last RSS item as tomorrow's release.
 * The full approved transcript is stored in the transcript R2 bucket.
 * A short excerpt guides brand voice and supported claims.
 */
export async function fetchPodcastPromoEpisode({
  feedUrl,
  publishDate,
  fetchImpl = globalThis.fetch,
  listKeysImpl,
  getObjectAsTextImpl,
} = {}) {
  const cutoff = publishDate ? Date.parse(publishDate + "T00:00:00Z") : Date.now();
  if (!Number.isFinite(cutoff)) throw new Error("Thursday promo received an invalid publish date.");

  let listKeys = listKeysImpl;
  let getObjectAsText = getObjectAsTextImpl;
  if (!listKeys || !getObjectAsText) {
    const r2 = await import("../../shared/utils/r2-client.js");
    listKeys ||= r2.listKeys;
    getObjectAsText ||= r2.getObjectAsText;
  }

  const metadata = [];
  try {
    const keys = (await listKeys("meta", ""))
      .filter((key) => typeof key === "string" && key.endsWith(".json") && !key.includes("/") && !key.endsWith("-tts.json") && !key.endsWith("-meta.json"));
    for (const key of keys) {
      try {
        const meta = JSON.parse(await getObjectAsText("meta", key));
        if (clean(meta?.title)) metadata.push(meta);
      } catch {
        // Skip corrupt or non-episode objects without fabricating evidence.
      }
    }
  } catch {
    // R2 unavailable: only published public RSS is a safe fall-back.
  }

  const produced = metadata.filter((meta) => isProducedMeta(meta)
    && Number.isFinite(episodeDate(meta)) && episodeDate(meta) < cutoff)
    .sort((a, b) => episodeDate(b) - episodeDate(a));
  const previous = produced[0];
  const previousNumber = Number(previous?.episodeNumber || 0);
  let transcriptExcerpt = "";
  let previousTranscriptTitle = "";
  if (previous?.sessionId || previous?.session?.sessionId) {
    try {
      const sid = clean(previous.sessionId || previous.session.sessionId);
      transcriptExcerpt = transcriptSample(await getObjectAsText("transcript", sid + ".txt"));
      previousTranscriptTitle = transcriptExcerpt ? clean(previous.title) : "";
    } catch {
      // Transcript is additional verified style context, never a prerequisite
      // to publishing an otherwise verified episode recommendation.
    }
  }

  // Preserve Thursday's Friday-preview purpose where a genuine upcoming
  // episode has been drafted. Only the next numbered, recent, unpublished
  // episode may be previewed, and its own metadata is the factual source.
  // Prior episode transcript influences voice only, not the upcoming claims.
  const planned = metadata.filter((meta) => {
    if (isProducedMeta(meta) || !previousNumber || Number(meta.episodeNumber) !== previousNumber + 1) return false;
    if (!clean(meta.title) || !clean(meta.episodeSummary || meta.summary || meta.shortSummary || meta.description)) return false;
    const updated = Date.parse(meta.updatedAt || meta.createdAt || "");
    if (!Number.isFinite(updated) || updated > cutoff + 86400000 || updated < cutoff - 14 * 86400000) return false;
    const intended = Date.parse(meta.pubDate || "");
    if (Number.isFinite(intended) && (intended < cutoff || intended > cutoff + 7 * 86400000)) return false;
    return true;
  }).sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt));

  if (planned.length) {
    const meta = planned[0];
    return {
      title: clean(meta.title),
      description: clean(meta.episodeSummary || meta.summary || meta.shortSummary || meta.description),
      episodeNumber: clean(meta.episodeNumber),
      pubDate: meta.pubDate || "",
      link: "",
      imageUrl: firstUrl(meta.artUrl, meta.imageUrl),
      source: "verified-upcoming-metadata",
      mode: "preview",
      transcriptExcerpt,
      previousTranscriptTitle,
    };
  }

  // Do not turn a published RSS episode into a fictional new-Friday preview.
  if (previous) {
    const episode = normaliseProducedMeta(previous);
    if (episode.title && episode.description) {
      return {
        ...episode,
        source: transcriptExcerpt ? "published-transcript" : "published-metadata",
        mode: "recap",
        transcriptExcerpt,
        previousTranscriptTitle,
        feedUrl: feedUrl || "",
      };
    }
  }
  return { ...(await fetchLatestPodcastEpisode({ feedUrl, fetchImpl, beforeDate: publishDate })),
    mode: "recap", previousTranscriptTitle: "" };
}
