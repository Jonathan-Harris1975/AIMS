// services/blog/utils/templates.js

import { mainSiteUrl } from "./mainSiteLinks.js";

export function pageTemplate({
  title,
  description,
  canonicalUrl,
  imageUrl,
  publishedAt,
  dateLabel,
  contentHtml,
}) {
  const safeTitle = escapeHtml(title || "Blog");
  const safeDesc = escapeHtml(description || "");
  const safeCanonical = escapeHtml(canonicalUrl || "");
  const safeImage = escapeHtml(imageUrl || "https://images.jonathan-harris.online/site-logo");
  const safePublished = escapeHtml(publishedAt || "");
  const safeDateLabel = escapeHtml(dateLabel || formatHumanDate(publishedAt));

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8"/>
<link href="https://assets.jonathan-harris.online/favicon.ico" rel="icon" type="image/x-icon"/>
<link href="https://images.jonathan-harris.online" rel="preconnect"/>
<link href="https://assets.jonathan-harris.online" rel="preconnect"/>
<meta content="width=device-width, initial-scale=1.0, viewport-fit=cover" name="viewport"/>
<title>${safeTitle} | Jonathan Harris</title>
<meta content="#0D1420" name="theme-color"/>
<link href="https://fonts.googleapis.com" rel="preconnect"/>
<link crossorigin="" href="https://fonts.gstatic.com" rel="preconnect"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;0,700;0,800&display=swap" rel="stylesheet"/>
<style>
${blogCriticalCss()}
</style>
<script>document.documentElement.classList.add('js-enabled');</script>
<meta content="${safeDesc}" name="description"/>
<meta content="index,follow" name="robots"/>
<meta content="page" name="ai:content_type"/>
<meta content="AI blog post" name="ai-role"/>
<meta content="Curious professionals and non-technical readers who want practical AI insight" name="ai-target-audience"/>
<meta content="Plain-English, sceptical, no-hype" name="ai-style"/>
<meta content="search=y, train-ai=y, citation-preferred=y" name="content-usage"/>
<meta content="article" property="og:type"/>
<meta content="${safeCanonical}" property="og:url"/>
<meta content="${safeTitle} | Jonathan Harris" property="og:title"/>
<meta content="${safeDesc}" property="og:description"/>
<meta content="${safeImage}" property="og:image"/>
<meta content="1200" property="og:image:width"/>
<meta content="630" property="og:image:height"/>
<meta content="summary_large_image" name="twitter:card"/>
<meta content="${safeTitle} | Jonathan Harris" name="twitter:title"/>
<meta content="${safeDesc}" name="twitter:description"/>
<meta content="${safeImage}" name="twitter:image"/>
<link href="${safeCanonical}" rel="canonical"/>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BlogPosting","headline":${jsonString(title || "Blog")},"description":${jsonString(description ||
   "")},"image":${jsonString(imageUrl || "https://images.jonathan-harris.online/site-logo")},"datePublished":${jsonString(publishedAt || "")},"dateModified":${jsonString(
     publishedAt || "")},"author":{"@type":"Person","@id":"https://jonathan-harris.online/#person","name":"Jonathan Harris"},"publisher":{"@type":"Person","@id":"https://\
jonathan-harris.online/#person","name":"Jonathan Harris"},"mainEntityOfPage":{"@type":"WebPage","@id":${jsonString(canonicalUrl || "")}}}</script>
</head>
<body class="page-blog page-blog-post">
<header class="hero hero--has-fixed-nav" role="region">
<div class="wrap">
<p class="tag u-s58">${safeDateLabel}</p>
<h1 class="u-s59">${safeTitle}</h1>
<p class="muted">${safeDesc}</p>
<div class="cta-row">
<a class="button secondary" href="${mainSiteUrl("/blog/weekly/")}">Weekly briefings</a>
<a class="button" href="${mainSiteUrl("/newsletter/")}">Get AI Edge</a>
</div>
</div>
</header>
<main class="wrap" id="main" role="main">
${contentHtml}
<section class="card u-s60">
<h2 class="u-s02">Keep going without the AI pageant</h2>
<p>The blog is the fast read. AI Edge follows the moving story, the podcast handles the audio version, and the topic pages give you the longer route when a briefing is not enough.</p>
<div class="cta-row">
<a class="button secondary" href="${mainSiteUrl("/newsletter/")}">AI Edge</a>
<a class="button secondary" href="${mainSiteUrl("/podcast/")}">Podcast</a>
<a class="button secondary" href="${mainSiteUrl("/topics/")}">Topics</a>
</div>
</section>
</main>
</body>
</html>`;
}

export function weeklyPostBody({ title, summary, dateLabel, imageUrl, html, sources = [] }) {
  const sourcesHtml = sources
    .map((source) => {
      const safeTitle = escapeHtml(source.title || source.link || "Source");
      const safeLink = escapeHtml(source.link || "#");
      const safeDate = escapeHtml(source.pubDate || "");
      const suffix = safeDate ? ` <span class="subtle">${safeDate}</span>` : "";
      return `<li><a href="${safeLink}" rel="noopener noreferrer" target="_blank">${safeTitle}</a>${suffix}</li>`;
    })
    .join("\n");

  return `
<article class="card u-s04">
  ${imageUrl ? `<img alt="${escapeHtml(title)}" class="cover" decoding="async" fetchpriority="high" loading="eager" src="${escapeHtml(imageUrl)}"/>` : ""}
  <div class="u-s06">
    ${dateLabel ? `<p class="tag u-s07">${escapeHtml(dateLabel)}</p>` : ""}
    ${html}
  </div>
</article>
<section class="card u-s60">
  <h2 class="u-s02">Sources behind this briefing</h2>
  <p class="u-s09">These are the source items used to build the weekly piece. No robot incense. Just the trail.</p>
  <ul class="u-s09">${sourcesHtml || "<li>Source links were not available for this briefing.</li>"}</ul>
</section>`;
}

export function socialPostBody({ title, summary, dateLabel, imageUrl, html, sources = [], socialCaption = "", hashtags = [] }) {
  const sourcesHtml = sources
    .map((source) => {
      const safeTitle = escapeHtml(source.title || source.link || "Source");
      const safeLink = escapeHtml(source.link || "#");
      const safeDate = escapeHtml(source.pubDate || "");
      const suffix = safeDate ? ` <span class="subtle">${safeDate}</span>` : "";
      return `<li><a href="${safeLink}" rel="noopener noreferrer" target="_blank">${safeTitle}</a>${suffix}</li>`;
    })
    .join("\n");

  const hashtagsHtml = Array.isArray(hashtags) && hashtags.length
    ? `<p class="tag u-s07">${hashtags.map((tag) => escapeHtml(tag)).join(" ")}</p>`
    : "";

  return `
<article class="card u-s04">
  ${imageUrl ? `<img alt="${escapeHtml(title)}" class="cover" decoding="async" fetchpriority="high" loading="eager" src="${escapeHtml(imageUrl)}"/>` : ""}
  <div class="u-s06">
    ${dateLabel ? `<p class="tag u-s07">${escapeHtml(dateLabel)}</p>` : ""}
    ${socialCaption ? `<p>${escapeHtml(socialCaption)}</p>` : ""}
    ${html}
    ${hashtagsHtml}
  </div>
</article>
<section class="card u-s60">
  <h2 class="u-s02">Sources behind this briefing</h2>
  <p class="u-s09">These are the rewritten RSS items used to build the daily social piece. Same rule as ever: signal first, theatre last.</p>
  <ul class="u-s09">${sourcesHtml || "<li>Source links were not available for this briefing.</li>"}</ul>
</section>`;
}

function blogCriticalCss() {
  return `
:root {
  --jh-bg: #0D1420;
  --jh-bg-2: #111827;
  --jh-panel: rgba(17, 24, 39, 0.88);
  --jh-panel-2: rgba(15, 23, 42, 0.96);
  --jh-text: #E5ECF6;
  --jh-muted: #AAB7C8;
  --jh-faint: #738299;
  --jh-teal: #38E8D1;
  --jh-teal-2: #22C7B8;
  --jh-purple: #8F7AFF;
  --jh-purple-2: #A78BFA;
  --jh-border: rgba(148, 163, 184, 0.22);
  --jh-shadow: 0 24px 70px rgba(0, 0, 0, 0.38);
  --jh-radius: 24px;
  color-scheme: dark;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
  background: var(--jh-bg);
}

body {
  margin: 0;
  min-height: 100vh;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: var(--jh-text);
  background:
    radial-gradient(circle at 12% 0%, rgba(56, 232, 209, 0.16), transparent 34rem),
    radial-gradient(circle at 88% 12%, rgba(143, 122, 255, 0.18), transparent 34rem),
    linear-gradient(180deg, #07111D 0%, #0D1420 42%, #08111D 100%);
  line-height: 1.68;
  text-rendering: optimizeLegibility;
}

body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
  background-size: 42px 42px;
  mask-image: linear-gradient(to bottom, rgba(0,0,0,.72), transparent 72%);
}

img,
svg {
  max-width: 100%;
}

a {
  color: var(--jh-teal);
  text-decoration: none;
}

a:hover {
  color: #BFFAF3;
  text-decoration: underline;
}

p {
  margin: 0 0 1.05rem;
}

ul {
  padding-left: 1.2rem;
}

[hidden] {
  display: none !important;
}

.wrap {
  width: min(1120px, calc(100% - 32px));
  margin-inline: auto;
}


.hero {
  position: relative;
  overflow: hidden;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
  background:
    linear-gradient(135deg, rgba(13, 20, 32, .92), rgba(19, 13, 41, .84)),
    radial-gradient(circle at 18% 8%, rgba(56, 232, 209, 0.20), transparent 26rem),
    radial-gradient(circle at 86% 24%, rgba(143, 122, 255, 0.22), transparent 30rem);
}

.hero::after {
  content: "";
  position: absolute;
  inset: auto 0 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(56, 232, 209, .58), rgba(143, 122, 255, .52), transparent);
}

.hero .wrap {
  position: relative;
  z-index: 1;
  max-width: 880px;
  padding-top: 70px;
  padding-bottom: 56px;
}

.hero h1 {
  margin: 0 0 16px;
  color: #FFFFFF;
  font-size: clamp(2rem, 6vw, 4.7rem);
  line-height: .98;
  letter-spacing: -0.06em;
  text-wrap: balance;
}

.hero .muted {
  max-width: 760px;
  margin: 0;
  color: #C6D3E3;
  font-size: clamp(1.02rem, 2.5vw, 1.22rem);
  line-height: 1.72;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  margin: 0 0 16px;
  padding: 7px 12px;
  border: 1px solid rgba(56, 232, 209, .28);
  border-radius: 999px;
  color: #BFFAF3;
  background: rgba(56, 232, 209, .10);
  font-size: .78rem;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.muted,
.subtle {
  color: var(--jh-muted);
}

.cta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 22px;
}

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 11px 18px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #031018;
  background: linear-gradient(135deg, var(--jh-teal), var(--jh-purple-2));
  font-weight: 850;
  box-shadow: 0 16px 38px rgba(56, 232, 209, .16);
}

.button:hover {
  color: #031018;
  transform: translateY(-1px);
  text-decoration: none;
}

.button.secondary {
  color: #EAF2FF;
  background: rgba(255, 255, 255, .08);
  box-shadow: none;
}

main.wrap {
  padding-top: 34px;
  padding-bottom: 58px;
}

.card {
  border: 1px solid var(--jh-border);
  border-radius: var(--jh-radius);
  background:
    linear-gradient(180deg, rgba(17, 24, 39, 0.94), rgba(10, 18, 31, 0.96)),
    radial-gradient(circle at 100% 0%, rgba(143, 122, 255, .12), transparent 24rem);
  box-shadow: var(--jh-shadow);
  overflow: hidden;
}

.card + .card,
.card + section,
section + .card {
  margin-top: 26px;
}

.cover {
  display: block;
  width: 100%;
  max-height: 620px;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  background: #020817;
  border-bottom: 1px solid rgba(148, 163, 184, .18);
}

.u-s04 {
  max-width: 920px;
  margin-inline: auto;
}

.u-s06 {
  padding: clamp(22px, 4vw, 42px);
}

.u-s09 {
  color: #D8E3F2;
  font-size: clamp(1rem, 2vw, 1.11rem);
  line-height: 1.78;
}

.u-s60 {
  max-width: 920px;
  margin-inline: auto;
  padding: clamp(22px, 4vw, 34px);
}

.u-s02 {
  margin: 0 0 14px;
  color: #FFFFFF;
  font-size: clamp(1.35rem, 3vw, 2rem);
  line-height: 1.12;
  letter-spacing: -0.035em;
}

.weekly-section,
.social-section {
  padding-top: 8px;
  margin-top: 30px;
  border-top: 1px solid rgba(148, 163, 184, .16);
}

.weekly-section h2,
.social-section h2 {
  margin: 0 0 12px;
  color: #FFFFFF;
  font-size: clamp(1.25rem, 2.6vw, 1.75rem);
  line-height: 1.15;
  letter-spacing: -0.03em;
}

.weekly-section p,
.social-section p,
.card p,
.card li {
  color: #CBD7E7;
}

.card ul {
  display: grid;
  gap: 10px;
  margin-bottom: 0;
}


@media (max-width: 900px) {
  .hero .wrap {
    padding-top: 48px;
    padding-bottom: 42px;
  }

}

@media (max-width: 640px) {
  .wrap {
    width: min(100% - 24px, 1120px);
  }

  .hero h1 {
    font-size: clamp(2rem, 10vw, 3rem);
  }

  .cover {
    max-height: 420px;
    aspect-ratio: 4 / 3;
  }

  .u-s06,
  .u-s60 {
    padding: 20px;
  }

  .button {
    width: 100%;
  }

  .cta-row {
    width: 100%;
  }
}
`.trim();
}


function formatHumanDate(value) {
  const parsed = value ? new Date(value) : null;

  if (!parsed || Number.isNaN(parsed.getTime())) {
    return "Weekly briefing";
  }

  return parsed.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function jsonString(value) {
  return JSON.stringify(String(value || ""));
}
