import test from "node:test";
import assert from "node:assert/strict";
import { applySiteShellToHtml } from "../services/shared/utils/siteShell.js";

const shell = {
  manifest: {
    releaseSha: "abc1234567",
    stylesheetUrl: "https://jonathan-harris.online/assets/css/site.css?v=abc1234567",
    siteUiScriptUrl: "https://jonathan-harris.online/assets/js/site-ui.min.js?v=abc1234567",
    scriptGovernanceUrl: "https://jonathan-harris.online/assets/js/script-governance.min.js?v=abc1234567",
  },
  headerHtml: '<!-- JH_SITE_SHELL_HEADER_START release=abc1234567 -->\n<a class="skip-link" href="#main">Skip</a><header class="jh-header" id="site-primary-nav"><a href="https://jonathan-harris.online/">Jonathan Harris</a></header>\n<!-- JH_SITE_SHELL_HEADER_END -->',
  footerHtml: '<!-- JH_SITE_SHELL_FOOTER_START release=abc1234567 -->\n<footer class="site-footer"><a href="https://jonathan-harris.online/blog/">Read the blog</a></footer>\n<!-- JH_SITE_SHELL_FOOTER_END -->',
};

test("site shell replaces legacy hard-coded chrome and pins assets to the same release", () => {
  const legacy = `<!doctype html><html><head><title>Old</title></head><body>
<a class="skip-link" href="#main">Skip</a><header class="jh-header" id="site-primary-nav"><a>Old nav</a></header>
<main id="main">Content</main><footer class="site-footer">Old footer</footer>
<script defer src="https://jonathan-harris.online/assets/js/site-ui.min.js"></script></body></html>`;
  const result = applySiteShellToHtml(legacy, shell);
  assert.match(result, /JH_SITE_SHELL_HEADER_START/);
  assert.match(result, /Read the blog/);
  assert.doesNotMatch(result, /Old nav|Old footer/);
  assert.match(result, /jh-site-shell-version" content="abc1234567/);
  assert.match(result, /site\.css\?v=abc1234567/);
  assert.match(result, /site-ui\.min\.js\?v=abc1234567/);
  assert.match(result, /script-governance\.min\.js\?v=abc1234567/);
});

test("site shell can wrap legacy newsletter archive HTML that had no website chrome", () => {
  const emailArchive = '<!doctype html><html><head><title>Issue</title></head><body><table><tr><td>Issue content</td></tr></table></body></html>';
  const result = applySiteShellToHtml(emailArchive, shell);
  assert.match(result, /site-primary-nav/);
  assert.match(result, /Issue content/);
  assert.match(result, /site-footer/);
});
