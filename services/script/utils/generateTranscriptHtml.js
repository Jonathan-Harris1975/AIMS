// ============================================================
// generateTranscriptHtml.js
// Builds a branded HTML transcript page for a podcast episode.
// Stored alongside the .txt version in the transcript R2 bucket.
// ============================================================

/**
 * Convert plain transcript text into HTML paragraphs.
 * Splits on double-newlines; falls back to single newlines for
 * feeds that don't use blank-line paragraph separators.
 */
function textToParagraphs(text) {
  const cleaned = text.trim();
  const blocks = cleaned.includes("\n\n")
    ? cleaned.split(/\n\n+/)
    : cleaned.split(/\n+/);

  return blocks
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
    .map((b) => `  <p class="transcript-para">${escapeHtml(b)}</p>`)
    .join("\n");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normaliseWhitespace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateForMeta(value = "", max = 160) {
  const cleaned = normaliseWhitespace(value);
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).replace(/[\s,;:.]+$/, "")}…`;
}

function escapeJsonForScript(value) {
  return JSON.stringify(value, null, 2).replace(/<\/script/gi, "<\\/script");
}

function formatIsoDuration(totalSeconds) {
  const seconds = Number(totalSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";

  const sec = Math.max(0, Math.round(seconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;

  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${s || (!h && !m) ? `${s}S` : ""}`;
}

function listFromValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normaliseWhitespace(item)).filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map((item) => normaliseWhitespace(item))
    .filter(Boolean);
}

function formatPubDate(pubDateStr) {
  if (!pubDateStr) return "";
  try {
    const date = new Date(pubDateStr);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function toIsoDate(value) {
  if (!value) return undefined;
  try {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  } catch {
    return undefined;
  }
}

function absoluteUrl(url, fallback) {
  const candidate = String(url || "").trim();
  return /^https?:\/\//i.test(candidate) ? candidate : fallback;
}

function renderPrimaryHeader() {
  return `<a class="skip-link" href="#main">Skip to main content</a>

<header aria-label="Primary site header" class="jh-header" id="site-primary-nav" role="banner">
<div class="jh-header__inner">
<a aria-label="Jonathan Harris – home" class="jh-brand" href="https://jonathan-harris.online/">
<span aria-hidden="true" class="jh-logo-wrap">
<img alt="" aria-hidden="true" class="jh-header__logo" decoding="async" fetchpriority="high" height="32" loading="eager" src="https://images.jonathan-harris.online/site-logo" width="32"/>
</span>
<span class="jh-brand__text">Jonathan Harris</span>
</a>
<nav aria-label="Primary navigation">
<ul class="jh-topnav">
<li><a href="https://jonathan-harris.online/">Home</a></li>
<li><a href="https://jonathan-harris.online/ebooks/">eBooks</a></li>
<li><a aria-current="page" href="https://jonathan-harris.online/podcast/">Podcast</a></li>
<li><a href="https://jonathan-harris.online/newsletter/">Newsletter</a></li>
<li><a href="https://jonathan-harris.online/topics/">Topics</a></li>
<li><a href="https://jonathan-harris.online/bio/">About</a></li>
<li class="jh-nav-dropdown">
<button aria-expanded="false" aria-haspopup="true" class="jh-nav-dropdown__btn">Resources <svg aria-hidden="true" fill="none" focusable="false" height="10" viewbox="0 0 10 6" width="10" xmlns="http://www.w3.org/2000/svg"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"></path></svg></button>
<ul class="jh-nav-dropdown__menu" role="menu">
<li role="none"><a href="https://jonathan-harris.online/blog/" role="menuitem">Blog</a></li>
<li role="none"><a href="https://jonathan-harris.online/glossary/" role="menuitem">Glossary</a></li>
<li role="none"><a href="https://jonathan-harris.online/topics/" role="menuitem">Topics</a></li>
<li role="none"><a href="https://jonathan-harris.online/compare/" role="menuitem">Comparisons</a></li>
</ul>
</li>
<li><a href="https://jonathan-harris.online/contact/">Contact</a></li>
<li><a class="jh-topnav__cta" href="https://jonathan-harris.online/ebooks/">Browse Books</a></li>
</ul>
</nav>
<button aria-controls="jh-mobile-nav" aria-expanded="false" aria-label="Open navigation menu" class="jh-hamburger"><svg aria-hidden="true" fill="none" focusable="false" height="20" stroke="currentColor" stroke-linecap="round" stroke-width="2.5" viewbox="0 0 24 24" width="20" xmlns="http://www.w3.org/2000/svg"><line x1="3" x2="21" y1="6" y2="6"></line><line x1="3" x2="21" y1="12" y2="12"></line><line x1="3" x2="21" y1="18" y2="18"></line></svg> <span class="jh-hamburger__label">Menu</span></button>
</div>
<nav aria-label="Mobile navigation" class="jh-mobile-nav" hidden="" id="jh-mobile-nav">
<a aria-label="Jonathan Harris – home" class="jh-mobile-nav__brand" href="https://jonathan-harris.online/">
<span aria-hidden="true" class="jh-logo-wrap">
<img alt="" aria-hidden="true" class="jh-mobile-nav__brand-logo" decoding="async" height="32" loading="lazy" src="https://images.jonathan-harris.online/site-logo" width="32"/>
</span>
<span class="jh-mobile-nav__brand-text">Jonathan Harris</span>
</a>
<a href="https://jonathan-harris.online/">Home</a>
<a href="https://jonathan-harris.online/ebooks/">eBooks</a>
<a href="https://jonathan-harris.online/podcast/">Podcast</a>
<a href="https://jonathan-harris.online/newsletter/">Newsletter</a>
<a href="https://jonathan-harris.online/topics/">Topics</a>
<a href="https://jonathan-harris.online/bio/">About</a>
<div class="jh-mobile-nav__group">
<span class="jh-mobile-nav__group-label">Resources</span>
<div class="jh-mobile-nav__group-links">
<a href="https://jonathan-harris.online/blog/">Blog</a>
<a href="https://jonathan-harris.online/glossary/">Glossary</a>
<a href="https://jonathan-harris.online/topics/">Topics</a>
<a href="https://jonathan-harris.online/compare/">Comparisons</a>
</div>
</div>
<a href="https://jonathan-harris.online/contact/">Contact</a>
<a class="jh-mobile-nav__cta" href="https://jonathan-harris.online/ebooks/">Browse Books</a>
</nav>
</header>`;
}

function renderFooter() {
  const year = new Date().getFullYear();
  return `<footer aria-label="Website footer" class="site-footer" role="contentinfo">
<div class="wrap footer-shell">
<div class="footer-grid">
<section aria-label="Brand summary" class="footer-panel footer-panel--brand">
<a class="footer-brand" href="https://jonathan-harris.online/">Jonathan Harris</a>
<p class="footer-copy">AI analysis for grown-ups. eBooks, podcast episodes, and a daily weekday newsletter built for readers who prefer signal over noise.</p>
<div aria-label="Core site areas" class="footer-badges">
<a href="https://jonathan-harris.online/ebooks/">36 eBooks</a>
<a href="https://jonathan-harris.online/podcast/">Weekly podcast</a>
<a href="https://jonathan-harris.online/newsletter/">Daily AI newsletter</a>
</div>
</section>
<nav aria-label="Navigate" class="footer-panel">
<h2>Navigate</h2>
<ul class="footer-links">
<li><a href="https://jonathan-harris.online/">Home</a></li>
<li><a href="https://jonathan-harris.online/ebooks/">Browse eBooks</a></li>
<li><a href="https://jonathan-harris.online/podcast/">Listen to the podcast</a></li>
<li><a href="https://jonathan-harris.online/newsletter/">Join the newsletter</a></li>
<li><a href="https://jonathan-harris.online/topics/">Explore AI topics</a></li>
<li><a href="https://jonathan-harris.online/bio/">About Jonathan Harris</a></li>
<li><a href="https://jonathan-harris.online/contact/">Contact</a></li>
</ul>
</nav>
<nav aria-label="Discover" class="footer-panel footer-panel--discover">
<h2>Discover</h2>
<div class="footer-link-group">
<p class="footer-panel__label">Explore the catalogue</p>
<ul class="footer-links">
<li><a href="https://jonathan-harris.online/glossary/">Glossary</a></li>
<li><a href="https://jonathan-harris.online/topics/">Topics</a></li>
<li><a href="https://jonathan-harris.online/compare/">Comparisons</a></li>
<li><a href="https://jonathan-harris.online/catalogue/artificial-intelligence/">Artificial Intelligence</a></li>
<li><a href="https://jonathan-harris.online/catalogue/healthcare/">Healthcare</a></li>
<li><a href="https://jonathan-harris.online/catalogue/ethics/">Ethics</a></li>
<li><a href="https://jonathan-harris.online/catalogue/law/">Law</a></li>
</ul>
</div>
</nav>
<section aria-label="Legal" class="footer-panel">
<h2>Legal</h2>
<ul class="footer-links footer-links--legal">
<li><a href="https://jonathan-harris.online/privacy-policy/">Privacy Policy</a></li>
<li><a href="https://jonathan-harris.online/terms-of-use/">Terms of Use</a></li>
</ul>
</section>
</div>
<div class="footer-meta">© ${year} Jonathan Harris. All rights reserved.</div>
</div>
</footer>`;
}

function buildPodcastEpisodeJsonLd({
  title,
  description,
  artUrl,
  htmlUrl,
  audioUrl,
  episodePageUrl,
  episodeNumber,
  pubDateRaw,
  durationSeconds,
  keywords = [],
}) {
  const url = htmlUrl || episodePageUrl || "https://jonathan-harris.online/podcast/";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "PodcastEpisode",
    name: title,
    description,
    url,
    transcript: htmlUrl || undefined,
    image: artUrl || undefined,
    episodeNumber: episodeNumber || undefined,
    datePublished: toIsoDate(pubDateRaw),
    duration: formatIsoDuration(durationSeconds),
    keywords: keywords.length ? keywords.join(", ") : undefined,
    associatedMedia: audioUrl
      ? {
          "@type": "AudioObject",
          contentUrl: audioUrl,
          encodingFormat: "audio/mpeg",
        }
      : undefined,
    partOfSeries: {
      "@type": "PodcastSeries",
      name: "Turing's Torch: AI Weekly",
      url: "https://jonathan-harris.online/podcast/",
    },
    author: {
      "@type": "Person",
      name: "Jonathan Harris",
      url: "https://jonathan-harris.online/bio/",
    },
  };

  return Object.fromEntries(
    Object.entries(jsonLd).filter(([, value]) => value !== undefined && value !== "")
  );
}

/**
 * @param {string} sessionId    - e.g. "TT-2026-04-10"
 * @param {string} transcriptText - raw plain-text content
 * @param {object} meta         - episode metadata from the meta bucket
 * @param {string} transcriptHtmlBaseUrl - public transcript HTML base URL
 * @returns {string} complete HTML document
 */
export function generateTranscriptHtml(sessionId, transcriptText, meta, transcriptHtmlBaseUrl) {
  const title = meta?.title || `Turing's Torch AI Weekly — ${sessionId}`;
  const description = meta?.description || "A sharp, no-hype take on the latest in artificial intelligence.";
  const artUrl = meta?.artUrl || "https://podcast-coverart.jonathan-harris.online/cover-art.png";
  const episodeNum = meta?.episodeNumber ? `Episode ${meta.episodeNumber}` : "";
  const pubDateRaw = meta?.pubDate || meta?.session?.date || "";
  const pubDate = formatPubDate(pubDateRaw);
  const keywords = listFromValue(meta?.keywords || meta?.seoKeywordCandidates).slice(0, 14);
  const metaDescription = truncateForMeta(description || `Full transcript: ${title}. Turing's Torch: AI Weekly, hosted by Jonathan Harris.`, 160);
  const siteBaseUrl = String(meta?.siteBaseUrl || process.env.SITE_BASE_URL || "https://jonathan-harris.online").replace(/\/$/, "");
  const htmlBase = String(transcriptHtmlBaseUrl || "").replace(/\/$/, "");
  const rawTranscriptBase = String(process.env.R2_PUBLIC_BASE_URL_TRANSCRIPT || "").replace(/\/$/, "");
  const archiveUrl = `${siteBaseUrl}/transcripts/`;
  const htmlUrl = absoluteUrl(meta?.transcriptHtmlUrl, htmlBase ? `${htmlBase}/${sessionId}.html` : `${archiveUrl}${sessionId}.html`);
  const audioUrl = absoluteUrl(meta?.podcastUrl, "");
  const listenUrl = audioUrl || "https://open.spotify.com/show/4NluRPjuAIGK59vVf7GcoF";
  const episodePageUrl = absoluteUrl(meta?.episodePageUrl, `${siteBaseUrl}/podcast/`);
  const transcriptTextUrl = absoluteUrl(meta?.transcriptTextUrl, rawTranscriptBase ? `${rawTranscriptBase}/${sessionId}.txt` : "");

  const metaDate = pubDate ? `${episodeNum}${episodeNum && pubDate ? " · " : ""}${pubDate}` : episodeNum;
  const paragraphs = textToParagraphs(transcriptText);
  const podcastEpisodeJsonLd = buildPodcastEpisodeJsonLd({
    title,
    description,
    artUrl,
    htmlUrl,
    audioUrl,
    episodePageUrl,
    episodeNumber: meta?.episodeNumber,
    pubDateRaw,
    durationSeconds: meta?.duration || meta?.plannedDurationSeconds,
    keywords,
  });

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0, viewport-fit=cover" name="viewport"/>
<title>${escapeHtml(title)} – Transcript | Turing's Torch: AI Weekly</title>
<meta name="description" content="${escapeHtml(metaDescription)}"/>
${keywords.length ? `<meta name="keywords" content="${escapeHtml(keywords.join(", "))}"/>` : ""}
<meta name="robots" content="index,follow"/>
<meta name="theme-color" content="#0D1420"/>
${htmlUrl ? `<link rel="canonical" href="${escapeHtml(htmlUrl)}"/>` : ""}
<meta property="og:type" content="article"/>
<meta property="og:title" content="${escapeHtml(title)} – Transcript"/>
<meta property="og:description" content="${escapeHtml(metaDescription)}"/>
<meta property="og:image" content="${escapeHtml(artUrl)}"/>
${htmlUrl ? `<meta property="og:url" content="${escapeHtml(htmlUrl)}"/>` : ""}
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtml(title)} – Transcript"/>
<meta name="twitter:description" content="${escapeHtml(metaDescription)}"/>
<meta name="twitter:image" content="${escapeHtml(artUrl)}"/>
<link href="https://assets.jonathan-harris.online/favicon.ico" rel="icon" type="image/x-icon"/>
<link href="https://images.jonathan-harris.online" rel="preconnect"/>
<link href="https://assets.jonathan-harris.online" rel="preconnect"/>
<link href="https://fonts.googleapis.com" rel="preconnect"/>
<link crossorigin="" href="https://fonts.gstatic.com" rel="preconnect"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,600;0,700;0,800&amp;display=swap" rel="stylesheet"/>
<link href="https://jonathan-harris.online/assets/css/site.css" rel="stylesheet"/>
<link href="https://cdn-cookieyes.com" rel="dns-prefetch"/>
<link href="https://tracker.metricool.com" rel="dns-prefetch"/>
<link href="https://botsailor.com" rel="dns-prefetch"/>
<style>
  .transcript-hero {
    background: linear-gradient(160deg, #0d1420 0, #140d29 100%);
    padding-top: calc(var(--header-h, 72px) + 54px);
    padding-bottom: 36px;
    text-align: center;
  }
  .transcript-hero .wrap { max-width: 860px; }
  .transcript-artwork {
    width: 140px;
    height: 140px;
    border-radius: 18px;
    border: 2px solid rgba(255,255,255,0.12);
    box-shadow: 0 18px 48px rgba(0,0,0,0.45);
    display: block;
    margin: 0 auto 22px;
    object-fit: cover;
  }
  .transcript-hero h1 {
    margin: 0 0 10px;
    font-size: clamp(1.45rem, 3vw, 2.1rem);
    line-height: 1.2;
    color: #93c5fd;
    letter-spacing: -.2px;
  }
  .transcript-hero .meta-line {
    color: #9ca3af;
    font-size: .95rem;
    margin: 0 0 6px;
  }
  .transcript-hero .ep-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border-radius: 999px;
    background: rgba(79,70,229,0.20);
    border: 1px solid rgba(79,70,229,0.35);
    color: #a5b4fc;
    font-size: .82rem;
    font-weight: 700;
    letter-spacing: .04em;
    text-transform: uppercase;
    margin-bottom: 16px;
  }
  .transcript-body {
    max-width: 860px;
    margin: 0 auto;
    padding: 0 18px 56px;
  }
  .transcript-nav {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    padding: 20px 0 0;
    margin-bottom: 24px;
    border-bottom: 1px solid #e5e7eb;
  }
  .transcript-nav a {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 700;
    font-size: .9rem;
    text-decoration: none;
    color: #4f46e5;
    padding: 7px 14px;
    border-radius: 999px;
    border: 1px solid rgba(79,70,229,0.28);
    background: #fff;
    min-height: 38px;
  }
  .transcript-nav a:hover { background: #eef2ff; text-decoration: none; }
  .transcript-description {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 18px;
    box-shadow: 0 10px 26px rgba(0,0,0,0.06);
    padding: 22px 24px;
    margin-bottom: 28px;
  }
  .transcript-description p {
    margin: 0 0 14px;
    color: #374151;
    line-height: 1.7;
    font-size: 1rem;
  }
  .transcript-description p:last-child { margin-bottom: 0; }
  .transcript-description .listen-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid #e5e7eb;
  }
  .transcript-heading {
    font-size: 1.1rem;
    font-weight: 800;
    color: #4f46e5;
    margin: 0 0 18px;
    padding-bottom: 10px;
    border-bottom: 2px solid rgba(79,70,229,0.15);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .transcript-text {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 18px;
    box-shadow: 0 10px 26px rgba(0,0,0,0.06);
    padding: 28px 28px 32px;
  }
  .transcript-para {
    color: #374151;
    font-size: 1.02rem;
    line-height: 1.82;
    margin: 0 0 1.4em;
    max-width: 72ch;
  }
  .transcript-para:last-child { margin-bottom: 0; }
  .transcript-cta {
    background: linear-gradient(135deg, #1e1b4b 0, #312e81 60%, #1a1040 100%);
    border: 1px solid rgba(147,197,253,0.15);
    border-radius: 20px;
    padding: 32px 28px;
    text-align: center;
    margin-top: 32px;
  }
  .transcript-cta h2 {
    color: #e0e7ff;
    font-size: 1.35rem;
    margin: 0 0 10px;
  }
  .transcript-cta p {
    color: #a5b4fc;
    margin: 0 0 20px;
    font-size: .97rem;
  }
  .transcript-cta .cta-row {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
  }
  @media (max-width: 640px) {
    .transcript-text { padding: 20px 16px 24px; }
    .transcript-description { padding: 18px 16px; }
    .transcript-cta { padding: 24px 16px; }
  }
</style>
<script>document.documentElement.classList.add('js-enabled');</script>
<!-- CookieYes -->
<script async="" id="cookieyes" src="https://cdn-cookieyes.com/client_data/c981d18033783598d2216add/script.js" type="text/javascript"></script>
<script defer="" data-cookieyes="ignore" data-cookieconsent="ignore" src="https://jonathan-harris.online/assets/js/script-governance.min.js"></script>
<script type="application/ld+json">${escapeJsonForScript(podcastEpisodeJsonLd)}</script>
</head>
<body class="page-podcast page-podcast-transcript">
${renderPrimaryHeader()}
<section aria-label="Episode transcript" class="hero hero--has-fixed-nav transcript-hero" data-jh-header-reveal-anchor>
<div class="wrap">
${episodeNum ? `<span class="ep-badge">🎙 ${escapeHtml(episodeNum)}</span>` : ""}
<img
  alt="${escapeHtml(title)} episode artwork"
  class="transcript-artwork"
  decoding="async"
  fetchpriority="high"
  height="140"
  loading="eager"
  src="${escapeHtml(artUrl)}"
  width="140"
/>
<h1>${escapeHtml(title)}</h1>
${metaDate ? `<p class="meta-line">${escapeHtml(metaDate)}</p>` : ""}
<p class="meta-line">Hosted by Jonathan Harris · Turing's Torch: AI Weekly</p>
</div>
</section>
<main id="main" role="main">
<div class="transcript-body">
  <nav aria-label="Transcript navigation" class="transcript-nav">
    <a href="https://jonathan-harris.online/podcast/">← Back to Podcast</a>
    <a href="${escapeHtml(archiveUrl)}">Transcript archive</a>
    <a href="${escapeHtml(listenUrl)}" rel="noopener noreferrer" target="_blank">Listen to this episode</a>
    <a href="https://podcasts.apple.com/gb/podcast/turings-torch-ai-weekly/id1862839712" rel="noopener noreferrer" target="_blank">Apple Podcasts</a>
    ${transcriptTextUrl ? `<a href="${escapeHtml(transcriptTextUrl)}" rel="noopener noreferrer" target="_blank">Plain text version</a>` : ""}
  </nav>

  <div class="transcript-description">
    <p>${escapeHtml(description)}</p>
    <div class="listen-row">
      <a class="button" href="${escapeHtml(listenUrl)}" rel="noopener noreferrer" target="_blank">▶ Listen to this episode</a>
      <a class="button secondary" href="${escapeHtml(episodePageUrl)}">Open episode page</a>
      <a class="button secondary" href="https://podcast-rss-feeds.jonathan-harris.online/turing-torch.xml" rel="noopener noreferrer" target="_blank">Subscribe via RSS</a>
    </div>
  </div>

  <section aria-label="Transcript text" class="transcript-text">
    <h2 class="transcript-heading">
      <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" stroke-width="2" viewbox="0 0 24 24" width="18" xmlns="http://www.w3.org/2000/svg"><path d="M4 6h16M4 10h16M4 14h10"/></svg>
      Full Episode Transcript
    </h2>
${paragraphs}
  </section>

  <aside class="transcript-cta" aria-label="Subscribe to Turing's Torch">
    <h2>Enjoyed this episode?</h2>
    <p>Subscribe for a sharp, no-hype take on AI every Friday. Zero buzzwords. Zero hand-wringing.</p>
    <div class="cta-row">
      <a class="button" href="${escapeHtml(listenUrl)}" rel="noopener noreferrer" target="_blank">Listen to this episode</a>
      <a class="button secondary" href="${escapeHtml(archiveUrl)}">Browse transcript archive</a>
      <a class="button secondary" href="https://jonathan-harris.online/newsletter/">Get the Newsletter</a>
    </div>
  </aside>
</div>
</main>
${renderFooter()}
<script defer="" src="https://jonathan-harris.online/assets/js/site-ui.min.js"></script>
</body>
</html>`;
}
