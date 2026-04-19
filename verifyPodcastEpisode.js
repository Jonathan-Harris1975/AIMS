// verifyPodcastEpisode.js
// Usage:
//   node verifyPodcastEpisode.js TT-2025-11-23
//   node verifyPodcastEpisode.js --all

import { XMLParser } from "fast-xml-parser";
import {
  getObjectAsText,
  listKeys,
} from "./services/shared/utils/r2-client.js";

const args = process.argv.slice(2);
const verifyAll = args.includes("--all");
const sessionIdArg = args.find((arg) => !arg.startsWith("--")) || null;

if (!verifyAll && !sessionIdArg) {
  console.error("Usage: node verifyPodcastEpisode.js <sessionId> | --all");
  process.exit(1);
}

const META_BASE = process.env.R2_PUBLIC_BASE_URL_META;
if (!META_BASE) {
  console.error("R2_PUBLIC_BASE_URL_META not set");
  process.exit(1);
}

const FEED_URL =
  process.env.PODCAST_RSS_FEED_URL ||
  process.env.RSS_URL ||
  "https://podcast-rss-feeds.jonathan-harris.online/turing-torch.xml";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
});

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function requestUrl(url, method = "HEAD") {
  try {
    const res = await fetch(url, { method, redirect: "follow" });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: err?.message || String(err) };
  }
}

async function probeUrl(url) {
  if (!url) return { ok: false, status: 0, error: "missing url" };
  const head = await requestUrl(url, "HEAD");
  if (head.ok || (head.status && head.status !== 405)) {
    return head;
  }
  return requestUrl(url, "GET");
}

async function loadMetaBySessionId(sessionId) {
  const text = await getObjectAsText("meta", `${sessionId}.json`);
  return JSON.parse(text);
}

async function loadAllEpisodeMeta() {
  const keys = await listKeys("meta", "");
  const metaKeys = keys.filter((key) => typeof key === "string" && key.endsWith(".json") && !key.includes("/"));
  const items = [];

  for (const key of metaKeys) {
    try {
      const text = await getObjectAsText("meta", key);
      const json = JSON.parse(text);
      items.push(json);
    } catch (err) {
      console.error(`❌ Failed to parse meta file ${key}: ${err?.message || String(err)}`);
    }
  }

  return items;
}

async function loadFeedItemsByGuid() {
  const response = await fetch(FEED_URL);
  if (!response.ok) {
    throw new Error(`RSS fetch failed: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const parsed = parser.parse(xml);
  const channel = parsed?.rss?.channel || {};
  const items = asArray(channel.item);
  const map = new Map();

  for (const item of items) {
    const guid = String(item?.guid?.["#text"] || item?.guid || "").trim();
    if (guid) map.set(guid, item);
  }

  return map;
}

function normalizeTranscriptUrl(meta) {
  return String(meta.transcriptHtmlUrl || meta.transcriptUrl || meta.transcriptTextUrl || "").trim();
}

function requiredFieldFailures(meta) {
  const failures = [];
  const requiredFields = [
    "sessionId",
    "title",
    "episodeSlug",
    "episodePageUrl",
    "podcastUrl",
    "transcriptTextUrl",
    "transcriptHtmlUrl",
    "pubDate",
  ];

  for (const field of requiredFields) {
    if (!String(meta?.[field] || "").trim()) {
      failures.push(`missing ${field}`);
    }
  }

  if (meta?.duration === null || meta?.duration === undefined || Number.isNaN(Number(meta.duration))) {
    failures.push("missing duration");
  }
  if (meta?.fileSize === null || meta?.fileSize === undefined || Number.isNaN(Number(meta.fileSize))) {
    failures.push("missing fileSize");
  }
  if (meta?.episodeNumber === null || meta?.episodeNumber === undefined || Number.isNaN(Number(meta.episodeNumber))) {
    failures.push("missing episodeNumber");
  }

  return failures;
}

async function verifyEpisode(meta, feedItemsByGuid) {
  const sessionId = meta.sessionId || meta.session?.sessionId || "(unknown)";
  const failures = [];

  for (const issue of requiredFieldFailures(meta)) {
    failures.push(issue);
  }

  const probes = {
    podcastUrl: meta.podcastUrl,
    transcriptTextUrl: meta.transcriptTextUrl,
    transcriptHtmlUrl: meta.transcriptHtmlUrl,
    episodePageUrl: meta.episodePageUrl,
  };

  for (const [label, url] of Object.entries(probes)) {
    const res = await probeUrl(url);
    if (!res.ok) {
      failures.push(`${label} unreachable (${res.status || res.error || "unknown"})`);
    }
  }

  const rssItem = feedItemsByGuid.get(sessionId);
  if (!rssItem) {
    failures.push("missing RSS item");
  } else {
    const rssLink = String(rssItem.link || "").trim();
    const rssEnclosure = String(rssItem.enclosure?.["@_url"] || "").trim();
    const rssTranscript = String(rssItem["podcast:transcript"]?.["@_url"] || "").trim();

    if (rssLink !== String(meta.episodePageUrl || "").trim()) {
      failures.push(`RSS link mismatch (${rssLink || "missing"})`);
    }
    if (rssEnclosure !== String(meta.podcastUrl || "").trim()) {
      failures.push(`RSS enclosure mismatch (${rssEnclosure || "missing"})`);
    }
    if (rssTranscript !== normalizeTranscriptUrl(meta)) {
      failures.push(`RSS transcript mismatch (${rssTranscript || "missing"})`);
    }
  }

  return { sessionId, title: meta.title || "(untitled)", failures };
}

(async () => {
  const episodes = verifyAll
    ? await loadAllEpisodeMeta()
    : [await loadMetaBySessionId(sessionIdArg)];

  const feedItemsByGuid = await loadFeedItemsByGuid();
  const results = [];

  for (const meta of episodes) {
    results.push(await verifyEpisode(meta, feedItemsByGuid));
  }

  const failures = results.filter((result) => result.failures.length > 0);
  const passes = results.length - failures.length;

  for (const result of results) {
    if (result.failures.length === 0) {
      console.log(`✅ ${result.sessionId} — ${result.title}`);
    } else {
      console.log(`❌ ${result.sessionId} — ${result.title}`);
      for (const failure of result.failures) {
        console.log(`   - ${failure}`);
      }
    }
  }

  console.log(`\nArchive verification summary: ${passes} passed, ${failures.length} failed, ${results.length} checked.`);

  if (failures.length > 0) {
    process.exit(1);
  }
})();
