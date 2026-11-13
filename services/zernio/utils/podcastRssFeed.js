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
  try {
    let listKeys = listKeysImpl;
    let getObjectAsText = getObjectAsTextImpl;
    if (!listKeys || !getObjectAsText) {
      const r2 = await import("../../shared/utils/r2-client.js");
      listKeys ||= r2.listKeys;
      getObjectAsText ||= r2.getObjectAsText;
    }
    const keys = (await listKeys("meta", ""))
      .filter((key) => typeof key === "string" && key.endsWith(".json") && !key.includes("/") && !key.endsWith("-tts.json") && !key.endsWith("-meta.json"));
    const produced = [];
    for (const key of keys) {
      try {
        const meta = JSON.parse(await getObjectAsText("meta", key));
        const ts = episodeDate(meta);
        if (clean(meta?.title) && isProducedMeta(meta) && Number.isFinite(ts) && ts < cutoff) produced.push(meta);
      } catch {
        // A damaged older metadata object cannot suppress a verified recent one.
      }
    }
    produced.sort((a, b) => episodeDate(b) - episodeDate(a));
    for (const meta of produced.slice(0, 8)) {
      const episode = normaliseProducedMeta(meta);
      if (!episode.sessionId) continue;
      try {
        const transcript = await getObjectAsText("transcript", episode.sessionId + ".txt");
        const transcriptExcerpt = transcriptSample(transcript);
        if (transcriptExcerpt && episode.title && episode.description) {
          return { ...episode, source: "published-transcript", transcriptExcerpt, feedUrl: feedUrl || "" };
        }
      } catch {
        // Fall back to published RSS rather than claiming an unverified transcript.
      }
    }
  } catch {
    // Storage outage cannot turn an unproduced metadata draft into a preview.
  }
  return fetchLatestPodcastEpisode({ feedUrl, fetchImpl, beforeDate: publishDate });
}
