// services/podcast-growth/campaignLinks.js
// Privacy-minimised organic campaign tags for links on the owned website.
// No trackers, redirect services, advertising pixels or paid API calls.
const CANONICAL_HOSTS = new Set(["jonathan-harris.online", "www.jonathan-harris.online"]);

export function isOwnedWebsiteUrl(input) {
  try {
    const url = new URL(String(input || ""));
    return url.protocol === "https:" && CANONICAL_HOSTS.has(url.hostname.toLowerCase()) &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}

function normaliseTag(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 64);
}

export function tagOwnedWebsiteUrl(input, { source, medium, campaign } = {}) {
  const original = String(input || "").trim();
  if (!isOwnedWebsiteUrl(original)) return original;
  const url = new URL(original);
  const labels = { utm_source: source, utm_medium: medium, utm_campaign: campaign };
  for (const [key, value] of Object.entries(labels)) {
    const tag = normaliseTag(value);
    if (tag && !url.searchParams.has(key)) url.searchParams.set(key, tag);
  }
  return url.toString();
}

// Spotify remains the default. Website mode is a deliberate opt-in only.
export function resolvePodcastPromoDestination({
  mode = "spotify",
  episode = {},
  spotifyUrl = "https://open.spotify.com/show/4NluRPjuAIGK59vVf7GcoF",
  websiteUrl = "https://jonathan-harris.online/podcast/",
} = {}) {
  const preview = episode.mode === "preview";
  if (mode !== "website") {
    return { url: spotifyUrl, label: preview ? "Follow on Spotify" : "Listen on Spotify", mode: "spotify" };
  }
  const episodeUrl = !preview && isOwnedWebsiteUrl(episode.link) ? episode.link : websiteUrl;
  const safeUrl = isOwnedWebsiteUrl(episodeUrl) ? episodeUrl : "https://jonathan-harris.online/podcast/";
  return {
    url: tagOwnedWebsiteUrl(safeUrl, {
      source: "zernio",
      medium: "social",
      campaign: preview ? "podcast_thursday_preview" : "podcast_published_recommendation",
    }),
    label: preview ? "Explore the podcast" : "Listen to the episode",
    mode: "website",
  };
}
