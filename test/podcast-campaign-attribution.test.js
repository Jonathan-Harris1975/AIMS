import test from "node:test";
import assert from "node:assert/strict";
import {
  isOwnedWebsiteUrl, tagOwnedWebsiteUrl, resolvePodcastPromoDestination,
} from "../services/podcast-growth/campaignLinks.js";
import { resolveIssuePromotion } from "../services/newsletter/engine/promotion.js";

test("organic UTM attribution accepts only owned HTTPS URLs and preserves existing tags", () => {
  const output = tagOwnedWebsiteUrl("https://jonathan-harris.online/podcast/?utm_campaign=original#listen", {
    source: "AI Edge", medium: "Email", campaign: "ignored",
  });
  const parsed = new URL(output);
  assert.equal(parsed.searchParams.get("utm_source"), "ai_edge");
  assert.equal(parsed.searchParams.get("utm_medium"), "email");
  assert.equal(parsed.searchParams.get("utm_campaign"), "original");
  assert.equal(parsed.hash, "#listen");
  assert.equal(isOwnedWebsiteUrl("https://jonathan-harris.online.evil.example/podcast"), false);
  assert.equal(isOwnedWebsiteUrl("http://jonathan-harris.online/podcast"), false);
  assert.equal(isOwnedWebsiteUrl("https://someone:secret@jonathan-harris.online"), false);
  assert.equal(tagOwnedWebsiteUrl("https://amazon.co.uk/dp/EXAMPLE", { source: "ai_edge" }),
    "https://amazon.co.uk/dp/EXAMPLE");
});

test("existing Spotify promotion destination remains the unmodified default", () => {
  const result = resolvePodcastPromoDestination({ episode: { mode: "preview" } });
  assert.equal(result.mode, "spotify");
  assert.equal(result.label, "Follow on Spotify");
  assert.equal(result.url, "https://open.spotify.com/show/4NluRPjuAIGK59vVf7GcoF");
  assert.equal(result.url.includes("utm_"), false);
});

test("opt-in tracked website promotions distinguish preview and verified released episode", () => {
  const preview = resolvePodcastPromoDestination({ mode: "website", episode: {
    mode: "preview", link: "https://jonathan-harris.online/podcast/episodes/not-yet-published",
  } });
  assert.equal(new URL(preview.url).pathname, "/podcast/");
  assert.equal(preview.label, "Explore the podcast");
  assert.equal(new URL(preview.url).searchParams.get("utm_source"), "zernio");
  const published = resolvePodcastPromoDestination({ mode: "website", episode: {
    mode: "recap", link: "https://jonathan-harris.online/podcast/episodes/verified-release",
  } });
  assert.equal(new URL(published.url).pathname, "/podcast/episodes/verified-release");
  assert.equal(published.label, "Listen to the episode");
  const external = resolvePodcastPromoDestination({ mode: "website", episode: {
    mode: "recap", link: "https://other.example/redirect",
  } });
  assert.equal(new URL(external.url).pathname, "/podcast/");
});

test("Thursday AI Edge podcast promotion receives free first-party campaign attribution", async () => {
  const p = await resolveIssuePromotion({}, { now: new Date("2026-11-19T12:00:00Z") });
  assert.equal(p.type, "podcast");
  const url = new URL(p.url);
  assert.equal(url.hostname, "jonathan-harris.online");
  assert.equal(url.searchParams.get("utm_source"), "ai_edge");
  assert.equal(url.searchParams.get("utm_medium"), "email");
  assert.equal(url.searchParams.get("utm_campaign"), "podcast_thursday_preview");
});
