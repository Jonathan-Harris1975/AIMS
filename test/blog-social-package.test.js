import test from "node:test";
import assert from "node:assert/strict";
import { findExistingSocialPostForDate, normaliseSocialBlogPackage, mergeSocialPostsManifest, validateSocialBlogPackageForBrand } from "../services/blog/utils/socialBlogPackage.js";

test("normaliseSocialBlogPackage returns the required social-blog contract", () => {
  const pkg = normaliseSocialBlogPackage({ title: "Daily AI reality check lands", summary: "The first sentence is grounded. The second sentence keeps the judgement tight.", social_caption: "Today's briefing has enough energy for social posting without drifting into launch-day confetti. The useful signal is practical: delivery, cost, control and the pressure points that decide whether artificial intelligence earns its keep. That means looking past the theatre and asking what the source material actually supports. No invented numbers, no fake urgency, and no shiny nonsense dressed as insight. It is built for readers who want the point quickly, but not so quickly that the substance gets mugged in the alley.", hook: "The useful signal sat below the theatre.", body_sections: [{ heading: "Delivery beats theatre", paragraphs: ["The sourced material points to practical pressure, not decorative launch language."] }, { heading: "Cost still bites", paragraphs: ["The operational question is who carries the cost when the glossy layer meets real deployment."] }], takeaway: "Judge the AI story by delivery, cost and control.", hashtags: ["#AIReality", "#AIBusiness", "#AIRegulation"], image_prompt: "Create high-impact premium editorial tech artwork with a dark navy and charcoal base, controlled neon teal and muted purple accents, strong contrast, cinematic composition, grounded Gen X energy, no text, no letters, no numbers, no logos, no watermarks, no glowing brains, no cartoon robots, no stock office scenes, no generic AI wallpaper.", themes: ["Deployment", "Cost", "Regulation"] });
  assert.deepEqual(Object.keys(pkg), ["title", "summary", "social_caption", "hook", "body_sections", "takeaway", "hashtags", "image_prompt", "themes"]);
  assert.equal(pkg.body_sections.length, 2);
  assert.equal(pkg.hashtags.length, 3);
});

test("normaliseSocialBlogPackage deterministically repairs a one-sentence summary and weak image prompt", () => {
  const pkg = normaliseSocialBlogPackage({
    title: "AI deployment meets operational reality",
    summary: "This week's stories show that dependable artificial intelligence remains difficult operational work.",
    social_caption: "The practical story is not a shiny launch. It is the steady work of testing systems, checking data, monitoring failures and deciding where human review still belongs. That is less glamorous than a stage demo, but it is where reliability is won or lost. Teams that skip those details usually discover the bill later, complete with interest and an awkward meeting. The stronger habit is to test the claim against evidence, ownership and failure handling before treating it as production-ready. That keeps the post useful without turning it into launch-day confetti.",
    hook: "The demo was the easy bit.",
    body_sections: [
      { heading: "Delivery pressure", paragraphs: ["The sources point to deployment friction and operational trade-offs."] },
      { heading: "Reliability work", paragraphs: ["Monitoring and governance remain part of the product rather than optional decoration."] },
    ],
    takeaway: "Judge the system by how it behaves after the demo ends.",
    hashtags: ["#AIReality", "#AIOperations", "#AIGovernance"],
    image_prompt: "Abstract geometric technology scene in navy and teal with no text.",
    themes: ["Deployment", "Reliability"],
  }, { dateLabel: "2026-06-12", items: [] });

  const check = validateSocialBlogPackageForBrand(pkg);
  assert.equal(check.ok, true, check.defects.join(" | "));
  assert.equal((pkg.summary.match(/[.!?]+/g) || []).length, 2);
  assert.match(pkg.image_prompt, /no watermarks/i);
  assert.match(pkg.image_prompt, /cinematic|strong contrast/i);
});

test("mergeSocialPostsManifest does not mix weekly posts into the social manifest", () => {
  const merged = mergeSocialPostsManifest({ items: [{ title: "Weekly post should not travel", url: "https://jonathan-harris.online/blog/posts/2026-w18-weekly-post/", path: "/blog/posts/2026-w18-weekly-post/", summary: "Weekly summary.", published_at: "2026-05-05T08:00:00.000Z" }, { id: "daily-2026-05-05", slug: "2026-05-05-social-post", title: "Yesterday's social post survives", summary: "First sentence. Second sentence.", social_caption: "Useful caption.", hook: "A hook.", takeaway: "A judgement.", url: "https://jonathan-harris.online/blog/social/posts/2026-05-05-social-post/", path: "/blog/social/posts/2026-05-05-social-post/", published_at: "2026-05-05T08:00:00.000Z", hashtags: ["#AIReality", "#AIBusiness", "#AIRegulation"] }] }, { id: "daily-2026-05-06", slug: "2026-05-06-social-post", title: "Today's social post arrives", summary: "First sentence. Second sentence.", social_caption: "Useful caption.", hook: "A hook.", takeaway: "A judgement.", url: "https://jonathan-harris.online/blog/social/posts/2026-05-06-social-post/", path: "/blog/social/posts/2026-05-06-social-post/", published_at: "2026-05-06T08:00:00.000Z", hashtags: ["#AIReality", "#AIBusiness", "#AIRegulation"] });
  assert.equal(merged.items.length, 2);
  assert.equal(merged.items[0].id, "daily-2026-05-06");
  assert.equal(merged.items[1].id, "daily-2026-05-05");
  assert.ok(merged.items.every((item) => item.path.startsWith("/blog/social/posts/")));
});

test("consecutive daily social runs are not blocked by the previous post publication timestamp", () => {
  const manifest = {
    items: [{
      id: "daily-2026-06-10",
      slug: "2026-06-10-yesterdays-social-briefing",
      title: "Yesterday's social briefing",
      summary: "First sentence. Second sentence.",
      social_caption: "Useful caption.",
      hook: "A hook.",
      takeaway: "A judgement.",
      url: "https://jonathan-harris.online/blog/social/posts/2026-06-10-yesterdays-social-briefing/",
      path: "/blog/social/posts/2026-06-10-yesterdays-social-briefing/",
      date_label: "2026-06-10",
      published_at: "2026-06-11T08:30:00.000Z",
      hashtags: ["#AIReality", "#AIBusiness", "#AIRegulation"],
    }],
  };

  assert.equal(findExistingSocialPostForDate(manifest, "2026-06-11"), undefined);
  assert.equal(findExistingSocialPostForDate(manifest, "2026-06-10")?.id, "daily-2026-06-10");
});

test("validateSocialBlogPackageForBrand catches weak social output", () => {
  const result = validateSocialBlogPackageForBrand({ title: "AI: The future of AI", summary: "AI is transforming everything.", social_caption: "This is huge. Don't miss this groundbreaking update.", hook: "You need to know this now!", body_sections: [{ heading: "News", paragraphs: ["A short paragraph."] }], takeaway: "It remains to be seen.", hashtags: ["#AI", "#Technology", "#Innovation"], image_prompt: "Generic AI wallpaper with a glowing brain.", themes: ["AI"] });
  assert.equal(result.ok, false);
  assert.match(result.defects.join(" "), /Title|Summary|social_caption|body_sections|Image|hype/i);
});
