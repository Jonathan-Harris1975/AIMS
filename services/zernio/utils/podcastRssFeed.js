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
