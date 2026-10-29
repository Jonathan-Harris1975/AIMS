import test from "node:test";
import assert from "node:assert/strict";
import { renderNewsletterHtml, renderNewsletterPlaintext } from "../services/newsletter/engine/render.js";

const profile = { id: "ai-edge", displayName: "AI Edge" };
const newsletter = {
  subject: "AI Edge test",
  previewText: "Preview",
  heroHeadline: "A useful AI story",
  openingNoteHtml: "<p>Useful analysis.</p>",
  heroImageUrl: "",
  bigThree: [1,2,3].map((n) => ({ title: `Story ${n}`, link: `https://example.com/${n}`, whatHappened: "What happened.", whyItMatters: "Why it matters.", jonathanTake: "Jonathan's take." })),
  worthUsing: { title: "Tool", link: "https://example.com/tool", label: "Worth Using", summary: "Summary", whyUseful: "Useful" },
  onRadar: [{ title: "Radar", link: "https://example.com/radar", summary: "Summary" }],
  realityCheck: { claim: "Claim", assessment: "Assessment", link: "https://example.com/1" },
  yourTurn: "What do you think?",
  promotion: { type: "podcast", eyebrow: "Thursday podcast preview", title: "Turing's Torch: AI Weekly", url: "https://jonathan-harris.online/podcast/", blurb:
     "New episode Friday.", ctaLabel: "Follow Turing's Torch" },
  footer: { text: "Jonathan Harris" },
};
test("email edition has no website shell or retired engagement closer", () => {
  const email = renderNewsletterHtml({ profile, newsletter });
  const text = renderNewsletterPlaintext({ profile, newsletter });
  assert.doesNotMatch(email, /jh-site-shell-version|site-ui\.min\.js|site-primary-nav|Your Turn|What do you think/);
  assert.doesNotMatch(text, /YOUR TURN|What do you think/);
  assert.match(email, /The Big Three/);
  assert.match(email, /Reality Check/);
  assert.match(email, /Thursday podcast preview/);
});
