import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRecentEditorialHistory, canonicalStoryUrl } from '../services/newsletter/engine/editorialHistory.js';
import { rankAndSelectStories } from '../services/newsletter/engine/rank.js';
import { extractArticleEvidence, fetchArticleEvidence, isSafeArticleUrl } from '../services/newsletter/engine/articleEvidence.js';
import { validateRecentCoverage, validatePracticalValue, validatePromotionalResidue,
  validateQuantitativeEvidence } from '../services/newsletter/engine/validators.js';
import { renderNewsletterHtml } from '../services/newsletter/engine/render.js';

const NOW = new Date('2026-11-11T12:00:00Z');
function story(title, link, summary = 'A source discusses relevant artificial intelligence developments.') {
  return { title, link, summary, sourceFeed: link + '/feed', publishedAt: NOW.toISOString() };
}
function newsletter() {
  return {
    edition: 'daily', subject: 'AI Edge', previewText: 'Actual developments', heroHeadline: 'News',
    openingNoteHtml: '<p>Here is what matters.</p>',
    bigThree: [{ sourceId: 'S0', title: 'AlphaProof', link: 'https://example.com/proof',
      whatHappened: 'Six million lines were verified.', whyItMatters: 'Important.',
      jonathanTake: 'Proof matters more than a flashy demonstration.' }],
    worthUsing: { sourceId: 'S1', title: 'Tool', link: 'https://example.com/tool', label: 'Worth Using',
      summary: 'A practical tool.', whyUseful: 'Check the access permissions and run a limited test before relying on it for important work.' },
    onRadar: [], realityCheck: { sourceId: 'S0', link: 'https://example.com/proof',
      claim: 'The tool verifies code.', assessment: 'Verify the actual scope.' },
  };
}

describe('AI Edge editorial quality gates', () => {
  test('only dispatched issues are included in seven-day memory, never unsent drafts', async () => {
    const base = 'newsletter/ai-edge/2026-11-10/';
    const prefix = base + 'NL-example/';
    const draft = base + 'NL-draft/';
    const files = {
      [prefix + 'metadata.json']: JSON.stringify({ qa: { passed: true },
        sourceLinks: ['https://www.example.com/news?utm_source=mail'],
        storyTitles: ['A very specific AI launch'] }),
      [prefix + 'campaign.json']: JSON.stringify({ status: 'dispatched' }),
      [draft + 'metadata.json']: JSON.stringify({ qa: { passed: true },
        sourceLinks: ['https://example.com/unsent'], storyTitles: ['Unsent'] }),
      [draft + 'campaign.json']: JSON.stringify({ status: 'created' }),
    };
    const history = await loadRecentEditorialHistory({
      storage: { htmlBucketKey: 'blog', keyPrefix: 'newsletter/ai-edge' }, publicationDate: '2026-11-11',
    }, {
      now: NOW, list: async (_, keyPrefix) => Object.keys(files).filter((key) => key.startsWith(keyPrefix)),
      read: async (_, key) => files[key],
    });
    assert.equal(history.complete, true);
    assert.ok(history.recentLinks.has(canonicalStoryUrl('https://example.com/news')));
    assert.ok(history.recentTitles.has('a very specific ai launch'));
    assert.ok(!history.recentLinks.has(canonicalStoryUrl('https://example.com/unsent')));
    assert.equal(history.recentIssues.length, 1);
  });

  test('recent headlines and URLs cannot be selected again even with tracking parameters', () => {
    const items = [
      story('Already covered', 'https://news.example.com/covered?utm_campaign=mail'),
      story('Unique AI security report', 'https://news.example.com/unique'),
      story('Fresh major launch', 'https://news.example.com/launch'),
    ];
    const ranked = rankAndSelectStories(items, { now: NOW, storyCount: 3,
      recentLinks: new Set([canonicalStoryUrl('https://news.example.com/covered')]) });
    assert.equal(ranked.droppedRecentlyCovered.length, 1);
    assert.ok(![ranked.lead, ...ranked.stories].some((s) => s.link.includes('covered')));
  });

  test('material AI launches outrank commercial vendor guide copy of the same age', () => {
    const items = [
      story('Data Annotation Services: Complete Guide to Providers, Costs and Best Practices',
        'https://vendor.example.com/guide'),
      story('Anthropic releases Claude Fable model with new capabilities',
        'https://www.anthropic.com/news/model'),
    ];
    assert.match(rankAndSelectStories(items, { storyCount: 2, now: NOW }).lead.title, /Anthropic/);
  });

  test('factual grounding prefers original article quantities over a misleading RSS preview', () => {
    const draft = newsletter();
    draft.bigThree[0].whatHappened = 'Three million lines of proof were written.';
    const sources = [{ title: 'AlphaProof', link: 'https://example.com/proof',
      summary: 'Three million lines', evidence: 'Google said six million lines were verified in Lean.',
      evidenceVerified: true }];
    const bad = validateQuantitativeEvidence(draft, { sources });
    assert.equal(bad.pass, false);
    assert.ok(bad.issues.some((issue) => issue.code === 'quantitative_claim_unverified'));
    draft.bigThree[0].whatHappened = 'Six million lines of proof were written.';
    assert.equal(validateQuantitativeEvidence(draft, { sources }).pass, true);
  });

  test('practical advice must be substantive and reader-actionable', () => {
    const draft = newsletter();
    assert.equal(validatePracticalValue(draft).pass, true);
    draft.worthUsing.whyUseful = 'A useful sign of AI adoption.';
    assert.equal(validatePracticalValue(draft).pass, false);
  });

  test('rejects raw commercial feed tails and cross-issue duplicate links', () => {
    const draft = newsletter();
    draft.onRadar.push({ title: 'Promotion', link: 'https://example.com/promote',
      summary: 'The post Product News appeared first on DataRobot.' });
    assert.equal(validatePromotionalResidue(draft).pass, false);
    const history = { recentLinks: new Set([canonicalStoryUrl('https://example.com/proof')]),
      recentTitles: new Set() };
    assert.equal(validateRecentCoverage(draft, { recentHistory: history }).pass, false);
  });

  test('omits empty On the Radar section instead of rendering a blank heading', () => {
    const html = renderNewsletterHtml({ profile: { displayName: 'AI Edge' }, newsletter: newsletter() });
    assert.ok(!html.includes('On the Radar'));
    assert.ok(html.includes('Actually Useful'));
  });

  test('article extraction ignores page chrome and unsafe URLs', async () => {
    const html = '<html><nav><p>Navigation text never goes into the draft as evidence.</p></nav><article>' +
      '<p>Researchers published a detailed account of their software verification work. It includes extensive methods and limitations.</p>' +
      '<p>The system processed six million lines of proof and checked its stated assumptions with an independent validator.</p>' +
      '<p>The authors explain which components received formal verification, and which components were outside the stated scope.</p>' +
      '</article></html>';
    const evidence = extractArticleEvidence(html);
    assert.ok(evidence?.includes('six million'));
    assert.ok(!evidence?.includes('Navigation text'));
    assert.equal(isSafeArticleUrl('http://127.0.0.1/admin'), false);
    assert.equal(isSafeArticleUrl('https://example.com/article'), true);
    const result = await fetchArticleEvidence(story('Proof', 'https://example.com/article'), {
      fetchText: async () => ({ response: { ok: true, headers: { get: () => 'text/html' } }, text: html }),
    });
    assert.equal(result.evidenceVerified, true);
  });
});
