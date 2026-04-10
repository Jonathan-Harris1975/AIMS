import { getObjectAsText } from "../../shared/utils/r2-client.js";
import { ONEUP_RSS_LOOKBACK_DAYS } from "./config.js";

function parsePubDate(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanText(value = "") {
  return String(value || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function loadRecentRssContext({ days = ONEUP_RSS_LOOKBACK_DAYS, maxItems = 8 } = {}) {
  try {
    const raw = await getObjectAsText("rss", "feed.json");
    const feed = JSON.parse(raw);
    const itemsRaw = feed?.rss?.channel?.item || [];
    const items = (Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw])
      .map((item) => ({
        title: cleanText(item?.title || item?.shortTitle || "Untitled"),
        summary: cleanText(item?.description?.__cdata || item?.description || ""),
        link: String(item?.link || "").trim(),
        pubDate: parsePubDate(item?.pubDate),
      }))
      .filter((item) => item.pubDate && item.summary)
      .sort((a, b) => b.pubDate - a.pubDate);

    const cutoff = Date.now() - Number(days || ONEUP_RSS_LOOKBACK_DAYS) * 86400000;
    const recent = items.filter((item) => item.pubDate >= cutoff).slice(0, maxItems);

    return {
      ok: true,
      items: recent,
      warning: recent.length ? null : "No recent rewritten RSS items found.",
    };
  } catch (error) {
    return {
      ok: false,
      items: [],
      warning: error?.message || "Failed to load RSS feed context.",
    };
  }
}
