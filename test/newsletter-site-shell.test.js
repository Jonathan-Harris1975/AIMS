import test from "node:test";
import assert from "node:assert/strict";
import { renderNewsletterHtml, renderNewsletterWebHtml } from "../services/newsletter/engine/render.js";

const profile = { id: "ai-edge", displayName: "AI Edge", featuredContent: { enabled: false } };
const newsletter = {
  subject: "AI Edge test",
  previewText: "Preview",
  heroHeadline: "A useful AI story",
  leadArticleHtml: "<p>Useful analysis.</p>",
  heroImageUrl: "",
  sourceLink: "https://example.com/source",
  stories: [{ title: "Second story", summary: "Summary", link: "https://example.com/second" }],
  footer: { text: "Jonathan Harris" },
};
const shell = {
  manifest: {
    releaseSha: "abc1234567",
    stylesheetUrl: "https://jonathan-harris.online/assets/css/site.css?v=abc1234567",
    siteUiScriptUrl: "https://jonathan-harris.online/assets/js/site-ui.min.js?v=abc1234567",
  },
  headerHtml: '<!-- JH_SITE_SHELL_HEADER_START release=abc1234567 --><header class="jh-header" id="site-primary-nav">Header</header><!-- JH_SITE_SHELL_HEADER_END -->',
  footerHtml: '<!-- JH_SITE_SHELL_FOOTER_START release=abc1234567 --><footer class="site-footer">Footer</footer><!-- JH_SITE_SHELL_FOOTER_END -->',
};

test("newsletter keeps email-safe HTML separate from website shell archive", () => {
  const email = renderNewsletterHtml({ profile, newsletter });
  const web = renderNewsletterWebHtml({ profile, newsletter, siteShell: shell });
  assert.doesNotMatch(email, /jh-site-shell-version|site-ui\.min\.js|site-primary-nav/);
  assert.match(email, /role="presentation"/);
  assert.match(web, /jh-site-shell-version/);
  assert.match(web, /site-primary-nav/);
  assert.match(web, /site-footer/);
  assert.match(web, /site\.css\?v=abc1234567/);
});
