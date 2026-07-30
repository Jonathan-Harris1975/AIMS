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

function normaliseMetaEpisode(meta = {}) {
  return {
    title: clean(meta.title),
    description: clean(meta.episodeSummary || meta.summary || meta.shortSummary || meta.description),
    link: "", // Upcoming/private metadata must never advertise a speculative episode route.
    audioUrl: "",
    imageUrl: firstUrl(meta.artUrl, meta.imageUrl),
    pubDate: meta.pubDate || meta.createdAt || meta.updatedAt || "",
    episodeNumber: clean(meta.episodeNumber),
  };
}

function candidateSort(a, b) {
  const aEpisode = Number(a.episodeNumber || 0);
  const bEpisode = Number(b.episodeNumber || 0);
  if (aEpisode !== bEpisode) return bEpisode - aEpisode;
  return (Date.parse(b.updatedAt || b.createdAt || b.pubDate || "") || 0) - (Date.parse(a.updatedAt || a.createdAt || a.pubDate || "") || 0);
}

function isProducedMeta(meta = {}) {
  if (meta.episodePublicationReady === true || meta.productionComplete === true) return true;
  const fileSize = Number(meta.fileSize || 0);
  const duration = Number(meta.actualDurationSeconds || meta.duration || 0);
  return firstUrl(meta.podcastUrl) !== "" && Number.isFinite(fileSize) && fileSize > 0 && Number.isFinite(duration) && duration > 0;
}

function chooseUpcomingMeta(candidates = []) {
  const numbered = candidates.filter((meta) => Number.isFinite(Number(meta.episodeNumber)) && Number(meta.episodeNumber) > 0);
  const publishedNumbers = numbered.filter(isProducedMeta).map((meta) => Number(meta.episodeNumber));
  const latestPublished = publishedNumbers.length ? Math.max(...publishedNumbers) : 0;
  if (latestPublished > 0) {
    const exactNext = numbered.find((meta) => !isProducedMeta(meta) && Number(meta.episodeNumber) === latestPublished + 1);
    if (exactNext) return exactNext;
  }
  return [...candidates].sort(candidateSort).find((meta) => !isProducedMeta(meta)) || [...candidates].sort(candidateSort)[0] || null;
}

export async function fetchLatestPodcastEpisode({
  feedUrl = process.env.ZERNIO_PODCAST_RSS_FEED_URL || process.env.PODCAST_RSS_FEED_URL || "https://podcast-rss-feeds.jonathan-harris.online/turing-torch.xml",
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Podcast RSS fetch requires fetch.");
  const response = await fetchImpl(feedUrl, { headers: { accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1" } });
  if (!response.ok) throw new Error(`Podcast RSS fetch failed with HTTP ${response.status}.`);
  const feed = await parser.parseString(await response.text());
  const items = Array.isArray(feed.items) ? feed.items : [];
  if (!items.length) throw new Error("Podcast RSS contains no episode items.");
  const episode = items.map((item) => ({
    title: clean(item.title),
    description: clean(item.contentSnippet || item.itunesSummary || item.contentEncoded || item.content || item.summary),
    link: firstUrl(item.link, item.guid),
    audioUrl: firstUrl(item.enclosure?.url),
    imageUrl: firstUrl(item.itunesImage, item.image),
    pubDate: item.isoDate || item.pubDate || "",
    episodeNumber: clean(item.episodeNumber),
  })).sort((a,b)=>(Date.parse(b.pubDate||"")||0)-(Date.parse(a.pubDate||"")||0))[0];
  if (!episode.title) throw new Error("Latest podcast RSS item has no title.");
  return { ...episode, feedUrl };
}

/**
 * Thursday previews are allowed to read private/planned episode metadata, but
 * unpublished episodes must never be inserted into the public RSS merely so a
 * social post can preview them.
 */
export async function fetchPodcastPromoEpisode({
  feedUrl,
  fetchImpl = globalThis.fetch,
  listKeysImpl,
  getObjectAsTextImpl,
} = {}) {
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
    const candidates = [];
    for (const key of keys) {
      try {
        const meta = JSON.parse(await getObjectAsText("meta", key));
        if (!clean(meta?.title)) continue;
        candidates.push(meta);
      } catch {}
    }
    const selected = chooseUpcomingMeta(candidates);
    if (selected) {
      const episode = normaliseMetaEpisode(selected);
      if (episode.title) return { ...episode, source: "private-podcast-meta", feedUrl: feedUrl || "" };
    }
  } catch {}

  return fetchLatestPodcastEpisode({ feedUrl, fetchImpl });
}
