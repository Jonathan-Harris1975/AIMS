// Fetch source-owned article text to improve factual grounding beyond RSS teasers.
// Treat all retrieved prose as untrusted evidence, never as instructions.
import { fetchTextWithTimeout } from '../../shared/http-client.js';
import { warn } from '../../../logger.js';

function decodeEntities(text) {
  return String(text).replace(/&(?:nbsp|amp|lt|gt|quot|apos|rsquo|lsquo|ldquo|rdquo|mdash|ndash|#39|#x27);/gi, (entity) => {
    const value = entity.toLowerCase();
    return ({
      '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
      '&rsquo;': "'", '&lsquo;': "'", '&ldquo;': '"', '&rdquo;': '"', '&mdash;': ' - ',
      '&ndash;': '-', '&#39;': "'", '&#x27;': "'",
    })[value] || entity;
  }).replace(/\s+/g, ' ').trim();
}

// A small tag scanner extracts visible paragraphs without regex-based HTML
// sanitisation. The result is untrusted evidence, never rendered as HTML.
function visibleParagraphs(markup) {
  const input = String(markup || '').slice(0, 500000);
  const lower = input.toLowerCase();
  const skipBlocks = new Set(['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript']);
  const paragraphs = [];
  let current = '';
  let inParagraph = false;
  let index = 0;
  while (index < input.length && paragraphs.length < 160) {
    const open = input.indexOf('<', index);
    const endText = open < 0 ? input.length : open;
    if (inParagraph) current += input.slice(index, endText);
    if (open < 0) break;
    if (input.startsWith('<!--', open)) {
      const commentEnd = input.indexOf('-->', open + 4);
      index = commentEnd < 0 ? input.length : commentEnd + 3;
      continue;
    }
    let close = open + 1;
    let quote = null;
    for (; close < input.length; close += 1) {
      const char = input[close];
      if (quote) { if (char === quote) quote = null; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (close >= input.length) break;
    const tagText = input.slice(open + 1, close).trim();
    const tag = tagText.match(/^\/?\s*([a-z][a-z0-9]*)/i)?.[1]?.toLowerCase();
    const closing = tagText.startsWith('/');
    if (tag && !closing && skipBlocks.has(tag)) {
      const closingTag = lower.indexOf('</' + tag, close + 1);
      index = closingTag < 0 ? input.length : closingTag;
      if (closingTag >= 0) {
        const closingEnd = input.indexOf('>', closingTag);
        index = closingEnd < 0 ? input.length : closingEnd + 1;
      }
      continue;
    }
    if (tag === 'p') {
      if (closing) {
        if (inParagraph) {
          const text = decodeEntities(current);
          if (text.length >= 45 && text.length <= 1700) paragraphs.push(text);
        }
        current = '';
        inParagraph = false;
      } else {
        current = '';
        inParagraph = true;
      }
    } else if (inParagraph && ['br', 'li'].includes(tag)) current += ' ';
    index = close + 1;
  }
  return [...new Set(paragraphs)];
}

export function extractArticleEvidence(html, maxChars = 5500) {
  const unique = visibleParagraphs(html);
  if (unique.join(' ').length < 300) return null;
  const head = unique.slice(0, 6).join('\n').slice(0, 2100);
  const numeric = unique.filter((p) => /\b(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s*(?:million|billion|thousand|percent|per cent))\b/i.test(p))
    .slice(0, 7).join('\n').slice(0, 2200);
  return [head, numeric].filter(Boolean).join('\n').slice(0, maxChars);
}

export function isSafeArticleUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')
      || hostname.endsWith('.internal') || hostname === '0.0.0.0'
      || hostname === '[::1]' || /^\d+(?:\.\d+){3}$/.test(hostname)) return false;
    return hostname.includes('.');
  } catch {
    return false;
  }
}

export async function fetchArticleEvidence(item, { fetchText = fetchTextWithTimeout } = {}) {
  if (!isSafeArticleUrl(item.link)) return { ...item, evidenceVerified: false };
  try {
    // Reject redirects to avoid RSS-supplied URLs redirecting to internal services.
    const { response, text } = await fetchText(item.link, {
      timeout: 5500, redirect: 'error',
      headers: { accept: 'text/html' },
    });
    if (!response.ok || !/html/i.test(response.headers?.get?.('content-type') || '')) {
      return { ...item, evidenceVerified: false };
    }
    const evidence = extractArticleEvidence(text);
    return evidence ? { ...item, evidence, evidenceVerified: true }
      : { ...item, evidenceVerified: false };
  } catch (error) {
    warn('newsletter.article_evidence.unavailable', { source: new URL(item.link).hostname, error: String(error?.message || error).slice(0, 160) });
    return { ...item, evidenceVerified: false };
  }
}

export async function enrichArticleEvidence(items, { fetchOne = fetchArticleEvidence, parallel = 3 } = {}) {
  const result = [...items];
  for (let start = 0; start < items.length; start += parallel) {
    // Approved weekday checkpoints already contain fetched evidence. Reuse it
    // rather than paying the latency and risk of re-fetching a publisher.
    const batch = await Promise.all(items.slice(start, start + parallel).map((item) =>
      item?.evidenceVerified === true && typeof item.evidence === "string" && item.evidence.length >= 300
        ? item : fetchOne(item)));
    batch.forEach((enriched, index) => { result[start + index] = enriched; });
  }
  return result;
}
