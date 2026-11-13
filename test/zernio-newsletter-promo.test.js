import test from "node:test";
import assert from "node:assert/strict";
import { extractNewsletterLead, loadNewsletterPromoContext, buildNewsletterPromoPost } from "../services/zernio/utils/newsletterPromo.js";

const publishedPlaintext = [
  "AI Edge", "", "AI agents have a new security problem", "", "THE BIG THREE", "",
  "Agents and the new security problem",
  "What happened: Researchers documented a specific permissions weakness in automated agent workflows.",
  "Why it matters: Teams need to audit tool access before letting agents take real actions.",
  "Jonathan's take: Giving an agent more tools without checking permissions is not an upgrade.",
  "https://example.com/agent-security",
  "", "ANOTHER STORY", "",
].join("\n");

function fixtures(weekday, sourceDate, overrides = {}) {
  const metadata = {
    profileId: "ai-edge", edition: weekday === "monday" ? "sunday" : "daily",
    publicationDate: sourceDate, qa: { passed: true, quarantined: false },
    heroImageUrl: "https://images.example.org/newsletter/source-art.png",
    heroImageStatus: "generated", storyTitles: ["Agents and the new security problem"],
    ...overrides,
  };
  return {
    profile: { id: "ai-edge", storage: { htmlBucketKey: "blog", keyPrefix: "newsletter/ai-edge" } },
    findLatestIssueSessionId: async () => "approved-session",
    readCampaignDelivery: async () => ({ delivery: { status: "dispatched" } }),
    getObjectAsText: async (_bucket, key) => key.endsWith("metadata.json") ? JSON.stringify(metadata) : publishedPlaintext,
  };
}

test("AI Edge social copy is grounded in the stored lead and reuses exact approved artwork", async () => {
  const cases = [
    ["monday", "2026-11-15"],
    ["wednesday", "2026-11-17"],
    ["friday", "2026-11-19"],
  ];
  for (const [weekday, sourceDate] of cases) {
    const context = await loadNewsletterPromoContext({ sourceDate, weekday, deps: fixtures(weekday, sourceDate) });
    const post = buildNewsletterPromoPost({ context, weekday });
    assert.equal(context.sourceDate, sourceDate);
    assert.equal(post.imageUrl, "https://images.example.org/newsletter/source-art.png");
    assert.match(post.content, /Agents and the new security problem/);
    assert.match(post.content, /Teams need to audit tool access|Giving an agent more tools/);
    assert.match(post.content, /utm_source=zernio/);
    assert.match(post.content, new RegExp("utm_content=" + weekday + "-" + sourceDate));
    assert.ok(post.content.length < 1800);
  }
});

test("AI Edge source must be a completely dispatched, QA-approved edition with matching image and lead", async () => {
  const sourceDate = "2026-11-15";
  await assert.rejects(() => loadNewsletterPromoContext({
    sourceDate, weekday: "monday",
    deps: { ...fixtures("monday", sourceDate), readCampaignDelivery: async () => ({ delivery: { status: "partial" } }) },
  }), /complete send record/);
  await assert.rejects(() => loadNewsletterPromoContext({
    sourceDate, weekday: "monday",
    deps: fixtures("monday", sourceDate, { qa: { passed: false } }),
  }), /did not pass/);
  await assert.rejects(() => loadNewsletterPromoContext({
    sourceDate, weekday: "monday",
    deps: fixtures("monday", sourceDate, { edition: "daily" }),
  }), /identity\/date\/edition/);
  await assert.rejects(() => loadNewsletterPromoContext({
    sourceDate, weekday: "monday",
    deps: fixtures("monday", sourceDate, { storyTitles: ["Unrelated subject"] }),
  }), /not aligned/);
  await assert.rejects(() => loadNewsletterPromoContext({
    sourceDate, weekday: "monday",
    deps: fixtures("monday", sourceDate, { heroImageUrl: "http://example.com/unapproved.png" }),
  }), /HTTPS URL/);
});

test("AI Edge never fabricates text when lead story evidence is incomplete", () => {
  assert.deepEqual(extractNewsletterLead(publishedPlaintext), {
    title: "Agents and the new security problem",
    whatHappened: "Researchers documented a specific permissions weakness in automated agent workflows.",
    whyItMatters: "Teams need to audit tool access before letting agents take real actions.",
    jonathanTake: "Giving an agent more tools without checking permissions is not an upgrade.",
  });
  assert.throws(() => extractNewsletterLead("AI Edge\nTHE BIG THREE\n\nNo supported story"), /incomplete/);
});
