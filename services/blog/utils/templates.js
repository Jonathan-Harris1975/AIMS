// services/blog/utils/templates.js

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
  const safeModified = safePublished;
  const safeDateLabel = escapeHtml(dateLabel || formatHumanDate(publishedAt));

  return `<!DOCTYPE html>
<html lang="en">
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
<link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,600;0,700;0,800&display=swap" rel="stylesheet"/>
<link as="style" href="/assets/css/site.css" rel="preload"/>
<script>document.documentElement.classList.add('js-enabled');</script><link href="/assets/css/site.css" rel="stylesheet"/>
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
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BlogPosting","headline":${jsonString(title || "Blog")},"description":${jsonString(description || "")},"image":${jsonString(imageUrl || "https://images.jonathan-harris.online/site-logo")},"datePublished":${jsonString(publishedAt || "")},"dateModified":${jsonString(publishedAt || "")},"author":{"@type":"Person","@id":"https://jonathan-harris.online/#person","name":"Jonathan Harris"},"publisher":{"@type":"Person","@id":"https://jonathan-harris.online/#person","name":"Jonathan Harris"},"mainEntityOfPage":{"@type":"WebPage","@id":${jsonString(canonicalUrl || "")}}}</script>
</head>
<body>
<a class="skip-link" href="#main">Skip to main content</a>
<header aria-label="Primary site header" class="jh-header" id="site-primary-nav" role="banner">
<div class="jh-header__inner">
<a aria-label="Jonathan Harris – home" class="jh-brand" href="/">
<span aria-hidden="true" class="jh-logo-wrap">
<img alt="" aria-hidden="true" class="jh-header__logo" decoding="async" fetchpriority="high" height="32" loading="eager" src="https://images.jonathan-harris.online/site-logo" width="32"/>
</span>
<span class="jh-brand__text">Jonathan Harris</span>
</a>
<nav aria-label="Primary navigation">
<ul class="jh-topnav">
<li><a href="/">Home</a></li>
<li><a href="/ebooks/">eBooks</a></li>
<li><a href="/podcast/">Podcast</a></li>
<li><a href="/newsletter/">Newsletter</a></li>
<li><a href="/topics/">Topics</a></li>
<li><a href="/bio/">About</a></li>
<li class="jh-nav-dropdown">
<button aria-expanded="false" aria-haspopup="true" class="jh-nav-dropdown__btn">Resources <svg aria-hidden="true" fill="none" focusable="false" height="10" viewbox="0 0 10 6" width="10" xmlns="http://www.w3.org/2000/svg"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path></svg></button>
<ul class="jh-nav-dropdown__menu" role="menu">
<li role="none"><a href="/blog/" role="menuitem">Blog</a></li>
<li role="none"><a href="/glossary/" role="menuitem">Glossary</a></li>
<li role="none"><a href="/topics/" role="menuitem">Topics</a></li>
<li role="none"><a href="/compare/" role="menuitem">Comparisons</a></li>
</ul>
</li>
<li><a href="/contact/">Contact</a></li>
<li><a class="jh-topnav__cta" href="/ebooks/">Browse Books</a></li>
</ul>
</nav>
<button aria-controls="jh-mobile-nav" aria-expanded="false" aria-label="Open navigation menu" class="jh-hamburger"><svg aria-hidden="true" fill="none" focusable="false" height="20" stroke="currentColor" stroke-linecap="round" stroke-width="2.5" viewbox="0 0 24 24" width="20" xmlns="http://www.w3.org/2000/svg"><line x1="3" x2="21" y1="6" y2="6"></line><line x1="3" x2="21" y1="12" y2="12"></line><line x1="3" x2="21" y1="18" y2="18"></line></svg> <span class="jh-hamburger__label">Menu</span></button>
</div>
<nav aria-label="Mobile navigation" class="jh-mobile-nav" hidden="" id="jh-mobile-nav">
<a aria-label="Jonathan Harris – home" class="jh-mobile-nav__brand" href="/">
<span aria-hidden="true" class="jh-logo-wrap">
<img alt="" aria-hidden="true" class="jh-mobile-nav__brand-logo" decoding="async" height="32" loading="lazy" src="https://images.jonathan-harris.online/site-logo" width="32"/>
</span>
<span class="jh-mobile-nav__brand-text">Jonathan Harris</span>
</a>
<a href="/">Home</a>
<a href="/ebooks/">eBooks</a>
<a href="/podcast/">Podcast</a>
<a href="/newsletter/">Newsletter</a>
<a href="/topics/">Topics</a>
<a href="/bio/">About</a>
<div class="jh-mobile-nav__group">
<span class="jh-mobile-nav__group-label">Resources</span>
<div class="jh-mobile-nav__group-links">
<a href="/blog/">Blog</a>
<a href="/glossary/">Glossary</a>
<a href="/topics/">Topics</a>
<a href="/compare/">Comparisons</a>
</div>
</div>
<a href="/contact/">Contact</a>
<a class="jh-mobile-nav__cta" href="/ebooks/">Browse Books</a>
</nav>
</header>
<header class="hero hero--has-fixed-nav" role="region">
<div class="wrap">
<p class="tag u-s58">${safeDateLabel}</p>
<h1 class="u-s59">${safeTitle}</h1>
<p class="muted">${safeDesc}</p>
<div class="cta-row">
<a class="button secondary" href="/blog/weekly/">Weekly briefings</a>
<a class="button" href="/newsletter/">Get AI Edge</a>
</div>
</div>
</header>
<main class="wrap" id="main" role="main">
${contentHtml}
<section class="card u-s60">
<h2 class="u-s02">Keep going without the AI pageant</h2>
<p>The blog is the fast read. The newsletter keeps pace through the week, the podcast handles the audio version, and the topic pages give you the longer route when a briefing is not enough.</p>
<div class="cta-row">
<a class="button secondary" href="/newsletter/">Newsletter</a>
<a class="button secondary" href="/podcast/">Podcast</a>
<a class="button secondary" href="/topics/">Topics</a>
</div>
</section>
</main>
<footer aria-label="Website footer" class="site-footer" role="contentinfo">
<div class="wrap footer-shell">
<div class="footer-grid">
<section aria-label="Brand summary" class="footer-panel footer-panel--brand">
<a class="footer-brand" href="/">Jonathan Harris</a>
<p class="footer-copy">AI analysis for grown-ups. eBooks, podcast episodes, and a daily weekday newsletter built for readers who prefer signal over noise.</p>
<div aria-label="Core site areas" class="footer-badges">
<a href="/ebooks/">36 eBooks</a>
<a href="/podcast/">Weekly podcast</a>
<a href="/newsletter/">Daily AI newsletter</a>
</div>
</section>
<nav aria-label="Navigate" class="footer-panel">
<h2>Navigate</h2>
<ul class="footer-links">
<li><a href="/">Home</a></li>
<li><a href="/ebooks/">Browse eBooks</a></li>
<li><a href="/podcast/">Listen to the podcast</a></li>
<li><a href="/newsletter/">Join the newsletter</a></li>
<li><a href="/topics/">Explore AI topics</a></li>
<li><a href="/bio/">About Jonathan Harris</a></li>
<li><a href="/contact/">Contact</a></li>
</ul>
</nav>
<nav aria-label="Discover" class="footer-panel footer-panel--discover">
<h2>Discover</h2>
<div class="footer-link-group">
<p class="footer-panel__label">Explore the catalogue</p>
<ul class="footer-links">
<li><a href="/glossary/">Glossary</a></li>
<li><a href="/topics/">Topics</a></li>
<li><a href="/compare/">Comparisons</a></li>
<li><a href="/catalogue/artificial-intelligence/">Artificial Intelligence</a></li>
<li><a href="/catalogue/healthcare/">Healthcare</a></li>
<li><a href="/catalogue/ethics/">Ethics</a></li>
<li><a href="/catalogue/law/">Law</a></li>
</ul>
</div>
</nav>
<section aria-label="Legal" class="footer-panel">
<h2>Legal</h2>
<ul class="footer-links footer-links--legal">
<li><a href="/privacy-policy/">Privacy Policy</a></li>
<li><a href="/terms-of-use/">Terms of Use</a></li>
</ul>
</section>
</div>
<div class="footer-meta">© 2026 Jonathan Harris. All rights reserved.</div>
</div>
</footer>
<script defer="" src="/assets/js/site-ui.min.js"></script>
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
    ${summary ? `<p class="u-s09">${escapeHtml(summary)}</p>` : ""}
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
    ${summary ? `<p class="u-s09">${escapeHtml(summary)}</p>` : ""}
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
