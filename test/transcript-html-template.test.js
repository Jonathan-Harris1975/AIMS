import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTranscriptHtml } from '../services/script/utils/generateTranscriptHtml.js';

const siteShell = {
  manifest: {
    releaseSha: "abc1234567",
    stylesheetUrl: "https://jonathan-harris.online/assets/css/site.css?v=abc1234567",
    siteUiScriptUrl: "https://jonathan-harris.online/assets/js/site-ui.min.js?v=abc1234567",
  },
  headerHtml: '<!-- JH_SITE_SHELL_HEADER_START release=abc1234567 --><a class="skip-link" href="#main">Skip</a><header class="jh-header" id="site-primary-nav"><span class="jh-\
logo-wrap"><img class="jh-header__logo" alt=""/></span><a href="https://jonathan-harris.online/ebooks/">Browse Books</a></header><!-- JH_SITE_SHELL_HEADER_END -->',
  footerHtml: '<!-- JH_SITE_SHELL_FOOTER_START release=abc1234567 --><footer class="site-footer"><a href="https://jonathan-harris.online/blog/">Read the blog</a></footer><!-- \
JH_SITE_SHELL_FOOTER_END -->',
};

test('generateTranscriptHtml uses on-brand header, governed scripts, and square logo shell', () => {
  const html = generateTranscriptHtml(
    'TT-2026-04-10',
    'First paragraph.\n\nSecond paragraph.',
    {
      title: "OpenAI's Four-Day Week, AI Governance, and Memory Problems",
      description: 'A grounded weekly AI briefing.',
      artUrl: 'https://images.jonathan-harris.online/podcast-img',
      episodeNumber: 18,
      pubDate: '2026-04-10T00:00:00Z',
      podcastUrl: 'https://pub.example.com/TT-2026-04-10.mp3',
      episodePageUrl: 'https://jonathan-harris.online/podcast/episodes/openai-four-day-week-ai-governance-and-memory-problems/',
      transcriptHtmlUrl: 'https://jonathan-harris.online/transcripts/TT-2026-04-10.html',
      transcriptTextUrl: 'https://transcripts.jonathan-harris.online/TT-2026-04-10.txt',
      plannedDurationSeconds: 1800,
      keywords: ['ai governance', 'artificial intelligence', 'ai podcast'],
    },
    'https://jonathan-harris.online/transcripts',
    siteShell
  );

  assert.match(html, /class="jh-header"/);
  assert.match(html, /class="jh-logo-wrap"/);
  assert.doesNotMatch(html, /jh-logo-wrap--circle/);
  assert.match(html, /assets\/js\/script-governance\.min\.js/);
  assert.match(html, /assets\/js\/site-ui\.min\.js/);
  assert.doesNotMatch(html, /consent-managed-scripts\.min\.js/);
  assert.match(html, /class="hero hero--has-fixed-nav transcript-hero"/);
  assert.match(html, /data-jh-header-reveal-anchor/);
  assert.match(html, /Browse Books/);
  assert.match(html, /Full Episode Transcript/);
  assert.match(html, /<script type="application\/ld\+json">/);
  assert.match(html, /"@type": "PodcastEpisode"/);
  assert.match(html, /"contentUrl": "https:\/\/pub.example.com\/TT-2026-04-10.mp3"/);
  assert.match(html, /<meta name="keywords" content="ai governance, artificial intelligence, ai podcast"\/>/);
  assert.doesNotMatch(html, /36 eBooks|Daily AI newsletter|every Friday/);
  assert.match(html, /jh-site-shell-version/);
});


test('generateTranscriptHtml prefers canonical main-domain transcript URL and archive links', () => {
  const html = generateTranscriptHtml(
    'TT-2026-04-11',
    'Only paragraph.',
    {
      title: 'Test Episode',
      transcriptHtmlUrl: 'https://jonathan-harris.online/transcripts/TT-2026-04-11.html',
      transcriptTextUrl: 'https://transcripts.jonathan-harris.online/TT-2026-04-11.txt',
    },
    'https://transcripts.jonathan-harris.online',
    siteShell
  );

  assert.match(html, /rel="canonical" href="https:\/\/jonathan-harris\.online\/transcripts\/TT-2026-04-11\.html"/);
  assert.match(html, /Transcript archive/);
  assert.match(html, /https:\/\/jonathan-harris\.online\/transcripts\//);
});
