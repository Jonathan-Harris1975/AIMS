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

export function extractArticleEvidence(html, maxChars = 5500) {
  const stripped = String(html || '').slice(0, 500000)
    .replace(/<(?:script|style|nav|footer|header|aside)\b[^>]*>[\s\S]*?<\/(?:script|style|nav|footer|header|aside)>/gi, '');
  const article = stripped.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]
    || stripped.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || stripped;
  const paragraphs = [];
  for (const match of article.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = decodeEntities(match[1].replace(/<[^>]+>/g, ' '));
    if (text.length >= 45 && text.length <= 1700) paragraphs.push(text);
  }
  const unique = [...new Set(paragraphs)];
  if (unique.join(' ').length < 300) return null;
  // Keep introductory context and quantitative evidence from elsewhere in the article.
  const head = unique.slice(0, 9);
  const numeric = unique.slice(9).filter((p) => /\b(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s*(?:million|billion|thousand|percent|per cent|%))\b/i.test(p)).slice(0, 8);
  return [...head, ...numeric].join('\n').slice(0, maxChars);
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
      timeoutMs: 5500, timeout: 5500, redirect: 'error',
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
    const batch = await Promise.all(items.slice(start, start + parallel).map((item) => fetchOne(item)));
    batch.forEach((enriched, index) => { result[start + index] = enriched; });
  }
  return result;
}
