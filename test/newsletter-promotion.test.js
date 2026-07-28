import test from "node:test";
import assert from "node:assert/strict";
import { weekdayInLondon, resolveIssuePromotion } from "../services/newsletter/engine/promotion.js";

const profile = {
  id: "ai-edge",
  podcastPromotion: {
    title: "Turing's Torch: AI Weekly",
    url: "https://jonathan-harris.online/podcast/",
    ctaLabel: "Follow Turing's Torch",
  },
};

test("weekdayInLondon uses Europe/London rather than server-local time", () => {
  assert.equal(weekdayInLondon(new Date("2026-07-30T10:00:00Z")), "thursday");
});

test("Thursday carries the Turing's Torch promotion", async () => {
  const promo = await resolveIssuePromotion(profile, { now: new Date("2026-07-30T10:00:00Z") });
  assert.equal(promo.type, "podcast");
  assert.match(promo.title, /Turing's Torch/);
  assert.equal(promo.url, "https://jonathan-harris.online/podcast/");
});

test("non-Tuesday/Thursday issues do not inject a house promotion", async () => {
  const promo = await resolveIssuePromotion(profile, { now: new Date("2026-07-29T10:00:00Z") });
  assert.equal(promo, null);
});
