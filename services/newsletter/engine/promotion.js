// services/newsletter/engine/promotion.js
//
// Day-aware AI Edge promotion slot. Tuesday promotes the current featured
// book; Thursday promotes Friday's Turing's Torch episode. Other days carry
// no house promotion so editorial space stays focused on the news.

import { warn } from "../../../logger.js";
import { THRESHOLDS } from "../../../config/thresholds.js";
import { resolveFeaturedBookForEbooks } from "../../zernio/utils/featuredBook.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function weekdayInLondon(now = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
  }).format(now).toLowerCase();
}

async function resolveTuesdayBook(profile, { retries = THRESHOLDS.newsletter.featuredBookRetries } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const { featuredBook, warnings = [] } = await resolveFeaturedBookForEbooks({});
      return {
        type: "book",
        eyebrow: "Tuesday book pick",
        title: featuredBook.title,
        blurb:
          featuredBook.shortDescription ||
          featuredBook.whyItMatters ||
          featuredBook.summary ||
          "This week's featured book from Jonathan Harris.",
        url: featuredBook.bookUrl,
        imageUrl: featuredBook.coverArtUrl || "",
        ctaLabel: "Explore the book",
        warnings,
      };
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(THRESHOLDS.newsletter.featuredBookRetryBaseMs * 2 ** attempt);
    }
  }

  warn("newsletter.promotion.book_unavailable", {
    profileId: profile.id,
    attempts: retries + 1,
    error: lastError?.message || String(lastError),
  });
  return null;
}

function resolveThursdayPodcast(profile) {
  const podcast = profile.podcastPromotion || {};
  return {
    type: "podcast",
    eyebrow: "Thursday podcast preview",
    title: podcast.title || "Turing's Torch: AI Weekly",
    blurb:
      podcast.blurb ||
      "A new Turing's Torch episode lands Friday. Expect the week's important AI developments, stripped of vendor confetti and given a proper reality check.",
    url: podcast.url || "https://jonathan-harris.online/podcast/",
    imageUrl: podcast.imageUrl || "",
    ctaLabel: podcast.ctaLabel || "Follow Turing's Torch",
  };
}

export async function resolveIssuePromotion(profile, { now = new Date() } = {}) {
  const day = weekdayInLondon(now);
  if (day === "tuesday") return resolveTuesdayBook(profile);
  if (day === "thursday") return resolveThursdayPodcast(profile);
  return null;
}

export { weekdayInLondon };
export default { resolveIssuePromotion, weekdayInLondon };
