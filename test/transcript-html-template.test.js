import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTranscriptHtml } from '../services/script/utils/generateTranscriptHtml.js';

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
      transcriptTextUrl: 'https://transcripts.jonathan-harris.online/TT-2026-04-10.txt',
    },
    'https://transcripts.jonathan-harris.online'
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
});
