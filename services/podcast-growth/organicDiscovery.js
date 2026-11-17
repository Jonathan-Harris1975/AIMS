// services/podcast-growth/organicDiscovery.js
// Read-only organic podcast search evidence. API positions are NOT in-app rankings.
import { fetchWithTimeout } from "../shared/http-client.js";
import { hasPodcastIndexCredentials, searchPodcastsByTerm } from "../shared/utils/podcastIndexClient.js";
import { getObjectAsText, putPrivateJson } from "../shared/utils/r2-client.js";

const APPLE_SEARCH_URL = "https://itunes.apple.com/search";
export const TURINGS_TORCH_APPLE_ID = 1862839712;
export const TURINGS_TORCH_RSS_URL = "https://podcast-rss-feeds.jonathan-harris.online/turing-torch.xml";
export const SEARCH_TERMS = Object.freeze([
  "artificial intelligence podcast",
  "AI news podcast",
  "AI automation podcast",
]);
const BUCKET = "audits";
const PREFIX = "audits/podcast-growth/discovery";
const MAX_RESULTS = 25;

const clean = (value, max = 160) => String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
const asArray = (value) => Array.isArray(value) ? value : [];
const normaliseFeed = (value) => clean(value, 500).replace(/\/+$/, "").toLowerCase();
const safeError = (error) => clean(error && error.message ? error.message : error, 160);

export function summariseAppleSearch(payload, term) {
  if (!payload || !Array.isArray(payload.results)) throw new Error("Apple podcast search returned invalid JSON results");
  const results = payload.results.slice(0, MAX_RESULTS);
  const match = results.findIndex((item) => Number(item.collectionId) === TURINGS_TORCH_APPLE_ID);
  return {
    provider: "apple-itunes-search",
    country: "GB",
    term,
    surface: "public-catalogue-api-not-apple-podcasts-app",
    sampledResults: results.length,
    ownPositionInSample: match < 0 ? null : match + 1,
    ownNotObservedInSample: match < 0,
    competitors: results.filter((item) => Number(item.collectionId) !== TURINGS_TORCH_APPLE_ID).slice(0, 5)
      .map((item) => ({
        id: Number.isFinite(Number(item.collectionId)) ? Number(item.collectionId) : null,
        title: clean(item.collectionName || item.trackName, 120),
        author: clean(item.artistName, 100),
      })),
  };
}

export function summarisePodcastIndexSearch(payload, term) {
  if (!payload || !Array.isArray(payload.feeds)) throw new Error("Podcast Index returned invalid JSON feeds");
  const results = payload.feeds.slice(0, MAX_RESULTS);
  const ownFeed = normaliseFeed(TURINGS_TORCH_RSS_URL);
  const match = results.findIndex((item) => normaliseFeed(item.url || item.feedUrl) === ownFeed);
  return {
    provider: "podcast-index-search",
    country: null,
    term,
    surface: "public-podcast-index-search-not-platform-ranking",
    sampledResults: results.length,
    ownPositionInSample: match < 0 ? null : match + 1,
    ownNotObservedInSample: match < 0,
    competitors: results.filter((item) => normaliseFeed(item.url || item.feedUrl) !== ownFeed).slice(0, 5)
      .map((item) => ({
        id: Number.isFinite(Number(item.id)) ? Number(item.id) : null,
        title: clean(item.title, 120),
        author: clean(item.author, 100),
      })),
  };
}

export async function fetchApplePodcastSearch(term) {
  const url = new URL(APPLE_SEARCH_URL);
  url.searchParams.set("term", term);
  url.searchParams.set("media", "podcast");
  url.searchParams.set("entity", "podcast");
  url.searchParams.set("country", "GB");
  url.searchParams.set("limit", String(MAX_RESULTS));
  const response = await fetchWithTimeout(url.toString(), {
    timeout: 8000,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Apple podcast search HTTP " + response.status);
  return response.json();
}

function snapshotDay(now) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid podcast discovery snapshot date");
  return date.toISOString().slice(0, 10);
}

function dailyKey(day) {
  return PREFIX + "/" + day + ".json";
}

export async function readLatestPodcastGrowthSnapshot({ readText = getObjectAsText } = {}) {
  try {
    const payload = JSON.parse(await readText(BUCKET, PREFIX + "/latest.json"));
    return payload && payload.schemaVersion === "podcast-growth-discovery/v1" ? payload : null;
  } catch {
    return null;
  }
}

export async function collectPodcastGrowthSnapshot({
  now = new Date(),
  terms = SEARCH_TERMS,
  searchApple = fetchApplePodcastSearch,
  searchIndex = searchPodcastsByTerm,
  indexCredentialsAvailable = hasPodcastIndexCredentials(),
  readText = getObjectAsText,
  persist = putPrivateJson,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const day = snapshotDay(now);
  const uniqueTerms = [...new Set(asArray(terms).map((term) => clean(term, 75)).filter(Boolean))].slice(0, 5);
  if (!uniqueTerms.length) throw new Error("At least one discovery search term is required");

  // The dated, private artefact is a once-per-day cost and rate-limit guard.
  try {
    const previous = JSON.parse(await readText(BUCKET, dailyKey(day)));
    if (previous && previous.schemaVersion === "podcast-growth-discovery/v1" && previous.status !== "unavailable") {
      return { ...previous, reused: true };
    }
  } catch {
    // New day or storage unavailable: an explicit API invocation may still proceed.
  }

  const evidence = [];
  const limitations = [];
  const providers = ["apple-itunes-search"];
  if (indexCredentialsAvailable) providers.push("podcast-index-search");
  else limitations.push("Podcast Index search skipped: existing API credentials unavailable.");

  for (let i = 0; i < uniqueTerms.length; i += 1) {
    if (i) await sleep(3200); // Polite spacing for the free Apple catalogue API.
    const term = uniqueTerms[i];
    try {
      evidence.push(summariseAppleSearch(await searchApple(term), term));
    } catch (error) {
      limitations.push("Apple search for " + term + ": " + safeError(error));
    }
    if (indexCredentialsAvailable) {
      try {
        evidence.push(summarisePodcastIndexSearch(await searchIndex(term, { max: MAX_RESULTS }), term));
      } catch (error) {
        limitations.push("Podcast Index search for " + term + ": " + safeError(error));
      }
    }
  }

  const report = {
    schemaVersion: "podcast-growth-discovery/v1",
    generatedAt: new Date(now).toISOString(),
    date: day,
    status: evidence.length === 0 ? "unavailable" : limitations.length ? "partial" : "complete",
    sourcePolicy: "public-API-samples-not-listener-metrics-or-certified-rankings",
    show: { title: "Turing's Torch: AI Weekly", appleCollectionId: TURINGS_TORCH_APPLE_ID, feedUrl: TURINGS_TORCH_RSS_URL },
    terms: uniqueTerms,
    providers,
    evidence,
    limitations,
  };
  if (!evidence.length) return { ...report, persisted: false };
  try {
    await persist(BUCKET, dailyKey(day), report);
    await persist(BUCKET, PREFIX + "/latest.json", report);
    return { ...report, persisted: true };
  } catch (error) {
    return { ...report, persisted: false, status: "partial",
      limitations: [...limitations, "Private R2 persistence unavailable: " + safeError(error)] };
  }
}

export function podcastGrowthReadiness() {
  return {
    ok: true,
    service: "podcast-growth",
    mode: "read-only-public-search",
    appleSearch: "free-public-API",
    podcastIndex: hasPodcastIndexCredentials() ? "configured" : "unconfigured",
    storage: "private-R2-audits",
    paidApiRequired: false,
    podseoModification: false,
    automaticPaidActions: false,
    scheduledPublicationModified: false,
  };
}
