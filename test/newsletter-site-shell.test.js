import test from "node:test";
import assert from "node:assert/strict";
import { renderNewsletterHtml, renderNewsletterWebHtml } from "../services/newsletter/engine/render.js";

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
  promotion: { type: "podcast", eyebrow: "Thursday podcast preview", title: "Turing's Torch: AI Weekly", url: "https://jonathan-harris.online/podcast/", blurb: "New episode Friday.", ctaLabel: "Follow Turing's Torch" },
  footer: { text: "Jonathan Harris" },
};
const shell = {
  manifest: { releaseSha: "abc1234567", stylesheetUrl: "https://jonathan-harris.online/assets/css/site.css?v=abc1234567", siteUiScriptUrl: "https://jonathan-harris.online/assets/js/site-ui.min.js?v=abc1234567", scriptGovernanceUrl: "https://jonathan-harris.online/assets/js/script-governance.min.js?v=abc1234567" },
  headerHtml: '<!-- JH_SITE_SHELL_HEADER_START release=abc1234567 --><header class="jh-header" id="site-primary-nav">Header</header><!-- JH_SITE_SHELL_HEADER_END -->',
  footerHtml: '<!-- JH_SITE_SHELL_FOOTER_START release=abc1234567 --><footer class="site-footer">Footer</footer><!-- JH_SITE_SHELL_FOOTER_END -->',
};

test("newsletter keeps email-safe HTML separate from website shell archive", () => {
  const email = renderNewsletterHtml({ profile, newsletter });
  const web = renderNewsletterWebHtml({ profile, newsletter, siteShell: shell });
  assert.doesNotMatch(email, /jh-site-shell-version|site-ui\.min\.js|site-primary-nav/);
  assert.match(email, /The Big Three/);
  assert.match(email, /Reality Check/);
  assert.match(email, /Thursday podcast preview/);
  assert.match(web, /jh-site-shell-version/);
  assert.match(web, /site-primary-nav/);
  assert.match(web, /site-footer/);
  assert.match(web, /script-governance\.min\.js/);
});
