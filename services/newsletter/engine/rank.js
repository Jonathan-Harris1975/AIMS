// Rank for newsworthiness, reader impact, source quality and freshness,
// rather than merely counting AI keywords in vendor RSS headlines.
import { canonicalStoryUrl, canonicalStoryTitle } from './editorialHistory.js';

const SIGNAL_TERMS = [
  'openai', 'anthropic', 'claude', 'gpt', 'gemini', 'llm', 'large language model',
  'artificial intelligence', 'machine learning', 'generative ai', 'chatgpt',
  'microsoft ai', 'google ai', 'meta ai', 'nvidia', 'deepmind', 'mistral',
  'copilot', 'agent', 'model release', 'foundation model',
];
const TRUSTED_EDITORIAL = /(^|\.)((technologyreview|nature|bbc|reuters|apnews|arstechnica|theverge|wired)\.com|bbc\.co\.uk|reuters\.com|spectrum\.ieee\.org|aihub\.org|oreilly\.com)$/i;
const PRIMARY_RESEARCH = /(^|\.)(openai\.com|anthropic\.com|deepmind\.google|huggingface\.co|arxiv\.org|acm\.org|ieee\.org)$/i;
const COMMERCIAL_COPY = /\b(complete guide|ultimate guide|top \d+|best practices|our solution|our platform|services? provider|why you should buy|book a demo|contact sales|buy now)\b/i;
const SIGNIFICANT_RELEASE = /\b(launch(?:es|ed)?|releas(?:e|ed)|introduc(?:es|ed)|unveil(?:s|ed)|announc(?:es|ed)|ship(?:s|ped)|general availability)\b/i;
const TECHNOLOGY = /\b(claude|gemini|gpt|chatgpt|llm|model|agent|inference|open.weight|AI)\b/i;
const IMPACT = /\b(independent study|benchmark|safety|security|law|regulat|research|scientist|energy|healthcare|education|jobs|copyright|court|cost|pricing|privacy|accessibility)\b/i;

function sourceDomain(item) {
  try { return new URL(item.link).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return String(item.sourceFeed || '').toLowerCase(); }
}

export function scoreNewsletterStory(item, { now = new Date() } = {}) {
  let score = 0;
  if (item.publishedAt) {
    const age = Math.max(0, (now - new Date(item.publishedAt)) / 3600000);
    score += Math.max(0, 36 - age) * 1.5;
  }
  const title = String(item.title || '');
  const body = String(item.summary || '');
  const haystack = (title + ' ' + body).toLowerCase();
  score += Math.min(5, SIGNAL_TERMS.filter((term) => haystack.includes(term)).length) * 4;
  if (body.length > 120) score += 3;
  const domain = sourceDomain(item);
  if (TRUSTED_EDITORIAL.test(domain)) score += 15;
  if (PRIMARY_RESEARCH.test(domain)) score += 17;
  if (SIGNIFICANT_RELEASE.test(title) && TECHNOLOGY.test(title)) score += 42;
  if (IMPACT.test(title)) score += 18;
  if (/\b(first|independent|study|data|benchmark|trial|evidence)\b/i.test(title)) score += 10;
  if (COMMERCIAL_COPY.test(title) || COMMERCIAL_COPY.test(body.slice(0, 200))) score -= 42;
  if (/\b(sponsored|partner content|advertorial|paid post)\b/i.test(haystack)) score -= 60;
  return score;
}

export function rankAndSelectStories(items, {
  storyCount, maxPerSourceFeed = 3, maxPerDomain = 3, now = new Date(),
  recentLinks = new Set(), recentTitles = new Set(),
} = {}) {
  if (!Array.isArray(items) || !items.length) {
    return { lead: null, stories: [], droppedForDiversity: [], droppedRecentlyCovered: [] };
  }
  const scored = items.map((item) => ({ item, score: scoreNewsletterStory(item, { now }) }))
    .sort((a, b) => b.score - a.score);
  const perFeed = new Map();
  const perDomain = new Map();
  const selected = [];
  const droppedForDiversity = [];
  const droppedRecentlyCovered = [];
  const seenLinks = new Set();
  const seenTitles = new Set();
  for (const { item, score } of scored) {
    const urlKey = canonicalStoryUrl(item.link);
    const titleKey = canonicalStoryTitle(item.title);
    if (recentLinks.has(urlKey) || recentTitles.has(titleKey) || seenLinks.has(urlKey) || seenTitles.has(titleKey)) {
      droppedRecentlyCovered.push(item);
      continue;
    }
    const domain = sourceDomain(item);
    const feedCount = perFeed.get(item.sourceFeed) || 0;
    const domainCount = perDomain.get(domain) || 0;
    if (feedCount >= maxPerSourceFeed || domainCount >= maxPerDomain) {
      droppedForDiversity.push(item);
      continue;
    }
    seenLinks.add(urlKey);
    seenTitles.add(titleKey);
    perFeed.set(item.sourceFeed, feedCount + 1);
    perDomain.set(domain, domainCount + 1);
    selected.push({ ...item, rankScore: score });
    if (selected.length >= (storyCount ?? 8) + 1) break;
  }
  const [lead, ...stories] = selected;
  return {
    lead: lead || null, stories, droppedForDiversity, droppedRecentlyCovered,
    totalCandidates: items.length,
  };
}

export default { rankAndSelectStories, scoreNewsletterStory };
