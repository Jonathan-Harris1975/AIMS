import { XMLParser } from "fast-xml-parser";
import { fetchPublishedPostsHistory } from "../../services/zernio/utils/zernioClient.js";
import * as r2Client from "../../services/shared/utils/r2-client.js";
import { RSS_PROMPTS } from "../../services/rss-feed-creator/utils/rss-prompts.js";
import { buildOnBrandSkillPreflightFindings } from "./seoGeoSkillLenses.js";

const REPO_FILES_INSPECTED = [
  "services/zernio/utils/zernioClient.js",
  "services/zernio/utils/socialScheduler.js",
  "services/zernio/utils/state.js",
  "services/zernio/routes/social.js",
  "services/script/routes/composeScript.js",
  "services/script/utils/generateTranscriptHtml.js",
  "services/podcast/",
  "services/rss-feed-podcast/",
  "services/shared/utils/r2-client.js",
  "services/rss-feed-creator/utils/rss-prompts.js",
  "services/rss-feed-creator/utils/models.js",
  "services/rss-feed-creator/rewrite-pipeline.js",
  "services/rss-feed-creator/utils/feedGenerator.js",
];

const BANNED_TITLE_PREFIXES = ["Title", "AI", "OpenAI", "Report", "Study", "Analysis", "Briefing", "Update", "What to know"];
const FORMULA_STARTS = [/^why\b/i, /^how\b/i, /^everything you need to know\b/i, /^the future of\b/i, /^.+\s+as\s+.+/i];
const CORPORATE_FILLER = [
  "in a significant development", "in a move that", "rapidly evolving", "groundbreaking", "transformative",
  "cutting-edge", "game-changer", "paradigm shift", "delve", "landscape", "underscores", "showcases",
  "notably", "it remains to be seen", "this could pave the way", "robust data fabric", "seamless data integration",
  "meaningful business value", "competitive advantage", "holistic approach", "pivotal moment",
];
const AMERICANISMS = ["optimize", "optimized", "optimization", "center", "behavior", "color", "favorite", "analyze", "analyzed", "defense"];
const TRANSITIONS = ["that said", "more importantly", "at the same time", "meanwhile", "in short", "ultimately"];
const LOCAL_METADATA_LEAKS = [/\btitle\s*:/i, /\bsummary\s*:/i, /\bnote\s*:/i, /\bcharacter\s*count\s*:/i, /\bword\s*count\s*:/i];

const getObjectAsText = (...args) => r2Client.getObjectAsText(...args);
const buildPublicUrl = (...args) => r2Client.buildPublicUrl(...args);

async function listObjectsCompat(bucketKey, prefix = "") {
  if (typeof r2Client.listObjects === "function") {
    return r2Client.listObjects(bucketKey, prefix);
  }
  if (typeof r2Client.listKeys === "function") {
    const keys = await r2Client.listKeys(bucketKey, prefix);
    return (Array.isArray(keys) ? keys : []).map((key) => ({
      key,
      Key: key,
      lastModified: null,
      LastModified: null,
      size: null,
      Size: null,
    }));
  }
  throw new Error("R2 client does not expose listObjects or listKeys for transcript discovery.");
}

function toIso(date) {
  return date.toISOString();
}

function safeDate(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function cleanText(value = "") {
  return String(value || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function compactObject(value, maxLength = 3000) {
  try {
    const json = JSON.stringify(value || {}, null, 2);
    return json.length > maxLength ? `${json.slice(0, maxLength)}...` : json;
  } catch {
    return "";
  }
}

function excerpt(value = "", maxChars = 9000) {
  const text = cleanText(value);
  return text.length > maxChars ? `${text.slice(0, maxChars).trim()}...` : text;
}

function classBlockRegex(tagName, className) {
  return new RegExp(`<${tagName}\\b(?=[^>]*\\bclass\\s*=\\s*["'][^"']*\\b${className}\\b[^"']*["'])[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi");
}

function firstClassBlock(value = "", tagName, className) {
  const regex = classBlockRegex(tagName, className);
  const match = regex.exec(String(value || ""));
  return match?.[1] || "";
}

function allClassBlocks(value = "", tagName, className) {
  const regex = classBlockRegex(tagName, className);
  const blocks = [];
  let match;
  while ((match = regex.exec(String(value || ""))) !== null) {
    blocks.push(match[1] || "");
  }
  return blocks;
}

function stripTranscriptBoilerplate(value = "") {
  let text = cleanText(value);
  const startMarkers = [
    "Full Episode Transcript",
    "Full transcript",
  ];
  for (const marker of startMarkers) {
    const index = text.toLowerCase().indexOf(marker.toLowerCase());
    if (index >= 0) {
      text = text.slice(index + marker.length).trim();
      break;
    }
  }

  const endMarkers = [
    "Enjoyed this episode?",
    "Subscribe for a sharp",
    "Browse transcript archive",
    "© ",
  ];
  const endIndexes = endMarkers
    .map((marker) => text.toLowerCase().indexOf(marker.toLowerCase()))
    .filter((index) => index > 0);
  if (endIndexes.length) {
    text = text.slice(0, Math.min(...endIndexes)).trim();
  }

  return text
    .replace(/\bSkip to main content\b/gi, " ")
    .replace(/\bJonathan Harris Home eBooks Podcast Newsletter Topics About Resources Blog Glossary Topics Comparisons Contact Browse Books\b/gi, " ")
    .replace(/\bMenu Jonathan Harris Home eBooks Podcast Newsletter Topics About Resources Blog Glossary Topics Comparisons Contact Browse Books\b/gi, " ")
    .replace(/\bBack to Podcast Transcript archive Listen to this episode Apple Podcasts Plain text version\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTranscriptText(value = "", { isHtml = false } = {}) {
  if (!isHtml) return cleanText(value);

  const paragraphs = allClassBlocks(value, "p", "transcript-para");
  if (paragraphs.length) {
    return paragraphs.map((block) => cleanText(block)).filter(Boolean).join("\n\n");
  }

  const transcriptSection = firstClassBlock(value, "section", "transcript-text");
  if (transcriptSection) {
    const withoutHeading = transcriptSection.replace(/<h[1-6]\b[\s\S]*?<\/h[1-6]>/gi, " ");
    return stripTranscriptBoilerplate(withoutHeading);
  }

  const mainMatch = String(value || "").match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  return stripTranscriptBoilerplate(mainMatch?.[1] || value);
}

function sourceDate(row = {}) {
  const candidates = [
    row.date_time,
    row.scheduled_date_time,
    row.scheduledAt,
    row.scheduled_at,
    row.publishDate,
    row.published_at,
    row.publishedAt,
    row.created_at,
    row.createdAt,
  ];
  for (const candidate of candidates) {
    const date = safeDate(candidate);
    if (date) return date;
  }
  return null;
}

function inWindow(date, windowStart, windowEnd) {
  if (!date) return false;
  return date.getTime() >= windowStart.getTime() && date.getTime() <= windowEnd.getTime();
}

// LIMITATION (see migration notes): Zernio's documented analytics/posts
// listing does not expose a per-post title, first-comment, or profile/category
// name the way OneUp's getpublishedposts did — only content, status,
// scheduledFor/publishedAt, and per-platform analytics rows. Fields with no
// documented Zernio equivalent are left blank rather than guessed.
function normaliseZernioRow(row = {}, sourceMethod = "Zernio API") {
  const when = sourceDate(row);
  const firstPlatform = Array.isArray(row.platformAnalytics) ? row.platformAnalytics[0] : null;
  return {
    title: "",
    topic: "",
    content: cleanText(row.content || ""),
    firstComment: "",
    platform: cleanText(row.platform || firstPlatform?.platform || ""),
    account: cleanText(firstPlatform?.accountUsername || firstPlatform?.accountId || ""),
    status: cleanText(row.status || "published"),
    postId: cleanText(row.postId || ""),
    sourceUrl: cleanText(row.platformPostUrl || firstPlatform?.platformPostUrl || ""),
    imageUrl: "",
    scheduledOrPublishedAt: when ? toIso(when) : cleanText(row.publishedAt || row.scheduledFor || ""),
    sourceMethod,
    rawMetadata: compactObject(row, 2500),
  };
}

export async function collectZernioEvidence({ include, windowStart, windowEnd, lookbackDays, maxPages = 4 } = {}) {
  if (!include) {
    return { sourceType: "zernio_blog_social", status: "blocked", items: [], evidenceMethod: "disabled by request", limitations: ["includeZernio was false."] };
  }
  if (!process.env.ZERNIO_META_API_KEY) {
    return { sourceType: "zernio_blog_social", status: "blocked", items: [], evidenceMethod: "Zernio API not called", limitations: ["ZERNIO_META_API_KEY is not configured, so Zernio evidence could not be retrieved."] };
  }

  try {
    const result = await fetchPublishedPostsHistory({
      maxPages,
      lookbackDays,
      windowStart,
      windowEnd,
    });

    const rows = Array.isArray(result?.data) ? result.data : [];
    const posts = rows.map((row) => normaliseZernioRow(row, "Zernio analytics historic published-post listing"));

    return {
      sourceType: "zernio_blog_social",
      status: "complete",
      items: posts,
      evidenceMethod: `Zernio analytics paginated historic scan for the previous ${lookbackDays} day(s).`,
      limitations: [
        ...(posts.length ? [] : ["Zernio analytics returned no rows inside the requested lookback window."]),
        ...(Number(result?.unknownDateCount || 0) > 0
          ? [`${Number(result.unknownDateCount)} Zernio row(s) had no parseable published date and were retained rather than silently discarded.`]
          : []),
      ],
      pagination: {
        pagesScanned: result?.pagesScanned || 0,
        rawCount: result?.rawCount || 0,
        filteredCount: result?.filteredCount || posts.length,
        unknownDateCount: result?.unknownDateCount || 0,
      },
    };
  } catch (error) {
    return {
      sourceType: "zernio_blog_social",
      status: "blocked",
      items: [],
      evidenceMethod: "Zernio analytics historic scan failed",
      limitations: [error?.message || "Zernio evidence retrieval failed."],
    };
  }
}

function sessionFromTranscriptKey(key = "") {
  return String(key).split("/").pop()?.replace(/\.(txt|html)$/i, "") || "";
}

function dateFromText(value = "") {
  const match = String(value).match(/20\d{2}-\d{2}-\d{2}/);
  return match ? safeDate(match[0]) : null;
}

function metaDate(meta = {}) {
  return safeDate(meta.pubDate || meta.date || meta.updatedAt || meta.generatedAt || meta.createdAt) || dateFromText(meta.sessionId || meta.title || "");
}

function transcriptObjectDate(object = {}) {
  return safeDate(object.lastModified) || dateFromText(object.key || "");
}

function transcriptExtension(key = "") {
  const match = String(key || "").match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : "";
}

function normaliseTranscriptObjects(objects = []) {
  const bySession = new Map();
  for (const object of objects || []) {
    const key = object?.key || object?.Key || "";
    if (!/\.(txt|html)$/i.test(key)) continue;
    const sessionId = sessionFromTranscriptKey(key);
    if (!sessionId) continue;
    const date = transcriptObjectDate({ ...object, key });
    const row = {
      key,
      sessionId,
      extension: transcriptExtension(key),
      lastModified: object?.lastModified || object?.LastModified || null,
      size: Number.isFinite(Number(object?.size ?? object?.Size)) ? Number(object?.size ?? object?.Size) : null,
      sortTime: date ? date.getTime() : 0,
    };
    const existing = bySession.get(sessionId);
    if (!existing || row.sortTime > existing.sortTime || (row.sortTime === existing.sortTime && row.extension === "html" && existing.extension !== "html")) {
      bySession.set(sessionId, row);
    }
  }
  return [...bySession.values()].sort((a, b) => {
    if (b.sortTime !== a.sortTime) return b.sortTime - a.sortTime;
    return b.key.localeCompare(a.key);
  });
}

async function readJsonMaybe(bucket, key) {
  try {
    return JSON.parse(await getObjectAsText(bucket, key));
  } catch {
    return null;
  }
}

export async function collectPodcastTranscriptEvidence({ include, windowStart, windowEnd, maxTranscripts = 3 } = {}) {
  if (!include) {
    return { sourceType: "podcast_transcript", status: "blocked", items: [], evidenceMethod: "disabled by request", limitations: ["includePodcastTranscripts was false."] };
  }

  try {
    const objects = await listObjectsCompat("transcript", "");
    const transcriptObjects = normaliseTranscriptObjects(objects);

    if (!transcriptObjects.length) {
      return {
        sourceType: "podcast_transcript",
        status: "partial",
        items: [],
        evidenceMethod: "R2 transcript bucket object scan with LastModified metadata",
        limitations: ["No .html or .txt transcript objects were discovered in the transcript bucket."],
      };
    }

    const items = [];
    for (const object of transcriptObjects.slice(0, 20)) {
      const key = object.key;
      const sessionId = object.sessionId;
      const meta = await readJsonMaybe("meta", `${sessionId}.json`);
      const knownDate = transcriptObjectDate(object) || metaDate(meta || { sessionId }) || dateFromText(key);
      if (knownDate && !inWindow(knownDate, windowStart, windowEnd)) continue;
      const rawText = await getObjectAsText("transcript", key);
      const isHtml = /\.html$/i.test(key);
      const transcriptText = extractTranscriptText(rawText, { isHtml });
      const canonicalMatch = rawText.match(/<link\b(?=[^>]*rel=["']canonical["'])(?=[^>]*href=["']([^"']+)["'])[^>]*>/i);
      const metaDescriptionMatch = rawText.match(/<meta\b(?=[^>]*name=["']description["'])(?=[^>]*content=["']([^"']+)["'])[^>]*>/i);
      const titleMatch = rawText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const h1Matches = rawText.match(/<h1\b/gi) || [];
      const htmlFeatureFlags = isHtml ? {
        hasAeoSummaryBlock: /class=["'][^"']*transcript-aeo/i.test(rawText) || /id=["']episode-summary["']/i.test(rawText),
        hasFullTranscriptAnchor: /id=["']full-transcript["']/i.test(rawText),
        hasFaqJsonLd: /FAQPage/i.test(rawText),
        hasPodcastEpisodeJsonLd: /PodcastEpisode/i.test(rawText),
        hasJsonLd: /application\/ld\+json/i.test(rawText),
        hasBreadcrumbJsonLd: /BreadcrumbList/i.test(rawText),
        hasCanonicalLink: Boolean(canonicalMatch),
        canonicalHref: canonicalMatch?.[1] || "",
        hasMetaDescription: Boolean(metaDescriptionMatch),
        metaDescriptionLength: cleanText(metaDescriptionMatch?.[1] || "").length,
        titleTagText: cleanText(titleMatch?.[1] || ""),
        h1Count: h1Matches.length,
        hasRelatedBookLink: /href=["'][^"']*\/(ebooks|books|book)\b/i.test(rawText) || /related\s+(book|ebook)/i.test(rawText),
        hasTopicLink: /href=["'][^"']*\/(topics|topic|glossary)\b/i.test(rawText),
        hasNewsletterCta: /newsletter/i.test(rawText),
        hasInternalLink: /href=["'](?:https?:\/\/jonathan-harris\.online|\/)(?!\/)/i.test(rawText),
      } : null;
      const htmlKey = isHtml ? key : key.replace(/\.txt$/i, ".html");
      const publicUrl = buildPublicUrl("transcript", key);
      const htmlUrl = buildPublicUrl("transcript", htmlKey);
      items.push({
        title: cleanText(meta?.title || `Podcast transcript ${sessionId}`),
        sessionId,
        episodeMetadata: meta || {},
        r2Key: key,
        publicUrl,
        htmlUrl,
        date: knownDate ? toIso(knownDate) : null,
        lastModified: object.lastModified || null,
        sourceFormat: isHtml ? "html" : "txt",
        textExcerpt: excerpt(transcriptText, 10000),
        textCharCount: transcriptText.length,
        htmlFeatureFlags,
        discoveryMethod: "R2 transcript object scan sorted by LastModified; latest .html or .txt object wins per session; HTML transcript pages are reduced to the transcript body before audit.",
      });
      if (items.length >= maxTranscripts) break;
    }

    return {
      sourceType: "podcast_transcript",
      status: items.length ? "complete" : "partial",
      items,
      evidenceMethod: "R2 transcript bucket object scan, LastModified sort, latest .html/.txt read, transcript-body extraction for HTML, optional meta bucket lookup.",
      limitations: [
        ...(items.length ? [] : ["Transcript objects exist, but none fell inside the requested lookback window."]),
        "Only compact transcript excerpts are included to keep the audit payload within model limits.",
      ],
    };
  } catch (error) {
    return {
      sourceType: "podcast_transcript",
      status: "blocked",
      items: [],
      evidenceMethod: "R2 transcript discovery failed",
      limitations: [error?.message || "Transcript evidence retrieval failed."],
    };
  }
}

function descriptionToText(description) {
  if (typeof description === "string") return cleanText(description);
  return cleanText(description?.__cdata || description?.["#text"] || description || "");
}

function normaliseRssItem(item = {}) {
  const guid = typeof item.guid === "object" ? item.guid?.["#text"] : item.guid;
  const title = cleanText(item.title || item.shortTitle || "Untitled");
  const summary = descriptionToText(item.description || item.summary || item.rewritten || "");
  const validation = RSS_PROMPTS.validateOutput(title, summary, {
    maxTitleWords: 12,
    minChars: 120,
    maxChars: RSS_PROMPTS.MAX_SUMMARY_CHARS,
  });
  return {
    title,
    summary,
    pubDate: cleanText(item.pubDate || ""),
    link: cleanText(item.link || ""),
    guid: cleanText(guid || ""),
    source: cleanText(item.source || item.sourceName || ""),
    validationFindings: [...validation.errors, ...validation.warnings],
  };
}

async function loadRssFromR2Json() {
  const raw = await getObjectAsText("rss", "feed.json");
  const feed = JSON.parse(raw);
  const itemRaw = feed?.rss?.channel?.item || [];
  return {
    method: "R2 rss/feed.json",
    feedUrl: buildPublicUrl("rss", "feed.xml"),
    items: (Array.isArray(itemRaw) ? itemRaw : [itemRaw]).map(normaliseRssItem),
  };
}

async function loadRssFromPublicXml() {
  const base = String(process.env.R2_PUBLIC_BASE_URL_RSS || process.env.R2_PUBLIC_BASE_URL_RSS_FEEDS || "").replace(/\/+$/, "");
  if (!base) throw new Error("No R2_PUBLIC_BASE_URL_RSS or R2_PUBLIC_BASE_URL_RSS_FEEDS configured for RSS fallback.");
  const feedUrl = `${base}/feed.xml`;
  const response = await fetch(feedUrl);
  if (!response.ok) throw new Error(`RSS public XML fetch failed with ${response.status}`);
  const xml = await response.text();
  const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml);
  const itemRaw = parsed?.rss?.channel?.item || [];
  return {
    method: "public feed.xml fetch",
    feedUrl,
    items: (Array.isArray(itemRaw) ? itemRaw : [itemRaw]).map(normaliseRssItem),
  };
}

export async function collectRssEvidence({ include, lookbackDays, maxItems = 30 } = {}) {
  if (!include) {
    return { sourceType: "rss_feed", status: "blocked", items: [], evidenceMethod: "disabled by request", limitations: ["includeRss was false."] };
  }

  const limitations = [];
  try {
    let loaded;
    try {
      loaded = await loadRssFromR2Json();
    } catch (r2Error) {
      limitations.push(`R2 feed.json read failed: ${r2Error?.message || r2Error}`);
      loaded = await loadRssFromPublicXml();
    }

    const items = loaded.items
      .filter((item) => {
        const date = safeDate(item.pubDate);
        if (!date) return true;
        return Date.now() - date.getTime() <= Number(lookbackDays || 7) * 86400000;
      })
      .slice(0, maxItems);

    return {
      sourceType: "rss_feed",
      status: "complete",
      feedUrl: loaded.feedUrl,
      items,
      evidenceMethod: loaded.method,
      limitations,
    };
  } catch (error) {
    return {
      sourceType: "rss_feed",
      status: "blocked",
      items: [],
      evidenceMethod: "R2 feed.json and public feed.xml attempts failed",
      limitations: [error?.message || "RSS evidence retrieval failed.", ...limitations],
    };
  }
}

function addFinding(findings, finding) {
  findings.push({
    issueId: finding.issueId || `OB-${String(findings.length + 1).padStart(3, "0")}`,
    severity: finding.severity || "medium",
    confidence: finding.confidence || "confirmed",
    sourceType: finding.sourceType,
    itemTitleOrId: finding.itemTitleOrId || "Not verified from supplied evidence",
    issueType: finding.issueType,
    exactEvidence: finding.exactEvidence,
    whyItIsOffBrand: finding.whyItIsOffBrand,
    violatedRule: finding.violatedRule,
    rootCauseLevel: finding.rootCauseLevel || "content",
    exactRemediation: finding.exactRemediation,
    improvedExample: finding.improvedExample || "",
    verificationMethod: finding.verificationMethod || "Generate fresh output, rerun the on-brand audit, and confirm the exact pattern does not recur.",
  });
}

function sentenceWordCount(sentence = "") {
  return cleanText(sentence).split(/\s+/).filter(Boolean).length;
}

function firstLongSentence(text = "", minWords = 36) {
  const sentences = String(text || "").split(/(?<=[.!?])\s+/).map(cleanText).filter(Boolean);
  return sentences.find((sentence) => sentenceWordCount(sentence) >= minWords) || "";
}

function checkTitle(findings, { title, sourceType, itemTitleOrId }) {
  const cleaned = cleanText(title);
  if (!cleaned) return;
  const prefix = BANNED_TITLE_PREFIXES.find((value) => new RegExp(`^${value.replace(/ /g, "\\s+")}\\s*:`, "i").test(cleaned));
  if (prefix) {
    addFinding(findings, {
      severity: "high",
      sourceType,
      itemTitleOrId,
      issueType: "banned title prefix",
      exactEvidence: cleaned,
      whyItIsOffBrand: "The title opens with a publisher-style label rather than a human editorial headline.",
      violatedRule: "No title prefixes or category labels.",
      exactRemediation: `For future titles, remove the '${prefix}:' prefix and rewrite the headline as a specific editorial angle.`,
      improvedExample: cleaned.replace(new RegExp(`^${prefix}\\s*:\\s*`, "i"), "").trim(),
    });
  }
  if (FORMULA_STARTS.some((pattern) => pattern.test(cleaned))) {
    addFinding(findings, {
      severity: "medium",
      sourceType,
      itemTitleOrId,
      issueType: "formulaic headline start",
      exactEvidence: cleaned,
      whyItIsOffBrand: "The title uses explainer scaffolding that feels closer to SEO middleware than Jonathan Harris editorial judgement.",
      violatedRule: "Avoid formula starts such as Why, How, Everything you need to know, X as Y, and The future of.",
      exactRemediation: "For future titles, re-angle the headline around the concrete tension or consequence in the item.",
    });
  }
  const words = cleaned.split(/\s+/).filter(Boolean).length;
  if (words > 14) {
    addFinding(findings, {
      severity: "low",
      sourceType,
      itemTitleOrId,
      issueType: "title length issue",
      exactEvidence: cleaned,
      whyItIsOffBrand: "The title is carrying too many clauses for a premium, calm editorial feed.",
      violatedRule: "Keep titles concise and specific.",
      exactRemediation: "For future titles, cut the headline to one clear angle, ideally 5 to 12 words.",
    });
  }
}

function checkText(findings, { text, sourceType, itemTitleOrId, field = "copy" }) {
  const cleaned = cleanText(text);
  if (!cleaned) return;
  const lower = cleaned.toLowerCase();
  const fillerPhrases = CORPORATE_FILLER.filter((phrase) => lower.includes(phrase));
  if (fillerPhrases.length) {
    const highRiskPhrases = new Set(["groundbreaking", "transformative", "game-changer", "paradigm shift"]);
    const phraseList = fillerPhrases.map((phrase) => `'${phrase}'`).join(", ");
    addFinding(findings, {
      severity: fillerPhrases.some((phrase) => highRiskPhrases.has(phrase)) ? "high" : "medium",
      sourceType,
      itemTitleOrId,
      issueType: "future anti-hype phrase guardrail",
      exactEvidence: phraseList,
      whyItIsOffBrand: `The ${field} contains generic AI/newsroom phrasing that should be treated as calibration evidence for future output, not as a retroactive rewrite ticket.`,
      violatedRule: "No hype, no corporate wallpaper, no generic AI summary tone.",
      rootCauseLevel: "validator",
      exactRemediation: `For future ${field}, add or tighten an anti-hype guardrail covering ${phraseList}; require the generator to replace those patterns with the concrete fact, risk, or consequence being described.`,
      verificationMethod: `Generate fresh ${field} and rerun the audit; the next outputs should not repeat the grouped anti-hype phrase pattern.`,
    });
  }
  const metadataLeaks = [
    ...RSS_PROMPTS.findMetadataLeaks(cleaned),
    ...LOCAL_METADATA_LEAKS
      .map((pattern) => cleaned.match(pattern)?.[0])
      .filter(Boolean),
  ];
  for (const leak of Array.from(new Set(metadataLeaks))) {
    addFinding(findings, {
      severity: "high",
      sourceType,
      itemTitleOrId,
      issueType: "metadata leak",
      exactEvidence: leak,
      whyItIsOffBrand: "Prompt scaffolding or editorial metadata leaked into user-facing copy.",
      violatedRule: "Never output labels, notes, character counts, or prompt metadata.",
      exactRemediation: "For future output, strip leaked labels and keep a validator gate before publication.",
    });
  }
  if (/<[^>]+>/.test(String(text || ""))) {
    addFinding(findings, {
      severity: "medium",
      sourceType,
      itemTitleOrId,
      issueType: "HTML leakage",
      exactEvidence: String(text).match(/<[^>]+>/)?.[0] || "HTML tag",
      whyItIsOffBrand: "Raw markup in editorial copy makes the output feel machine-piped rather than published.",
      violatedRule: "All audit copy fields should be plain text unless the field is intentionally HTML.",
      exactRemediation: "For future output, strip or render HTML before the item reaches the model or report.",
    });
  }
  if (/Read on Jonathan-Harris RSS Feed/i.test(cleaned)) {
    addFinding(findings, {
      severity: "medium",
      sourceType,
      itemTitleOrId,
      issueType: "RSS wrapper CTA leakage",
      exactEvidence: "Read on Jonathan-Harris RSS Feed",
      whyItIsOffBrand: "Wrapper CTA text is being treated as editorial evidence.",
      violatedRule: "No CTA leakage in RSS summaries or audit inputs.",
      exactRemediation: "For future RSS audits, strip wrapper CTA anchors before brand analysis.",
    });
  }
  const american = AMERICANISMS.find((word) => new RegExp(`\\b${word}\\b`, "i").test(cleaned));
  if (american) {
    addFinding(findings, {
      severity: "low",
      sourceType,
      itemTitleOrId,
      issueType: "American spelling",
      exactEvidence: american,
      whyItIsOffBrand: "The ecosystem standard is British English.",
      violatedRule: "British English spelling.",
      exactRemediation: "For future output, use British spelling where natural, for example optimise, centre, behaviour, colour, analyse.",
    });
  }
}

function checkTranscript(findings, item = {}) {
  const id = item.title || item.sessionId || item.r2Key;
  const text = cleanText(item.textExcerpt || "");
  const longSentence = firstLongSentence(text);
  if (longSentence) {
    addFinding(findings, {
      severity: "medium",
      sourceType: "podcast_transcript",
      itemTitleOrId: id,
      issueType: "overlong podcast sentence",
      exactEvidence: longSentence,
      whyItIsOffBrand: "The sentence is too packed for TTS and weakens the dry, conversational delivery.",
      violatedRule: "Podcast copy should be spoken, natural, and rhythmically clean.",
      exactRemediation: "For future podcast transcripts, split comparable lines into two shorter spoken sentences and cut abstract padding.",
      verificationMethod: "Generate a fresh transcript, read the comparable sentence aloud or run the transcript QA audit; it should survive TTS without breathless pacing.",
    });
  }
  const repeated = TRANSITIONS.filter((phrase) => (text.toLowerCase().match(new RegExp(`\\b${phrase}\\b`, "g")) || []).length >= 3);
  for (const phrase of repeated) {
    addFinding(findings, {
      severity: "low",
      sourceType: "podcast_transcript",
      itemTitleOrId: id,
      issueType: "repeated transition phrase",
      exactEvidence: phrase,
      whyItIsOffBrand: "Repeated transition furniture makes the episode sound assembled from source blocks.",
      violatedRule: "Avoid repeated transitions and source-digest sequencing smell.",
      exactRemediation: "For future podcast scripts, vary or remove the transition and connect the ideas with editorial causality instead.",
    });
  }
  if (/\b(first|next|finally),?\s+(story|item|article)\b/i.test(text)) {
    addFinding(findings, {
      severity: "medium",
      sourceType: "podcast_transcript",
      itemTitleOrId: id,
      issueType: "source-digest sequencing smell",
      exactEvidence: cleanText(text.match(/\b(first|next|finally),?\s+(story|item|article)\b[^.?!]*/i)?.[0] || "source sequencing"),
      whyItIsOffBrand: "The transcript sounds like rewritten source material being read in order rather than an editorial show.",
      violatedRule: "The podcast should feel like informed commentary, not a stitched digest.",
      exactRemediation: "For future podcast scripts, replace source-order signposting with a thematic transition that explains why the next item matters.",
    });
  }
}

export function runDeterministicPreflight(evidence) {
  const findings = [];
  for (const item of evidence?.zernioBlogSocial?.items || []) {
    const id = item.title || item.topic || item.scheduledOrPublishedAt || "Zernio post";
    checkTitle(findings, { title: item.title, sourceType: "zernio_blog_social", itemTitleOrId: id });
    checkText(findings, { text: `${item.content}\n${item.firstComment}`, sourceType: "zernio_blog_social", itemTitleOrId: id, field: "post" });
  }
  for (const item of evidence?.rss?.items || []) {
    const id = item.title || item.guid || item.link || "RSS item";
    checkTitle(findings, { title: item.title, sourceType: "rss_feed", itemTitleOrId: id });
    checkText(findings, { text: item.summary, sourceType: "rss_feed", itemTitleOrId: id, field: "summary" });
    for (const validationFinding of item.validationFindings || []) {
      addFinding(findings, {
        severity: /banned|metadata|HTML|filler/i.test(validationFinding) ? "high" : "medium",
        sourceType: "rss_feed",
        itemTitleOrId: id,
        issueType: "existing RSS validator finding",
        exactEvidence: validationFinding,
        whyItIsOffBrand: "The existing RSS brand validator identified a rule breach.",
        violatedRule: "RSS prompt and feedGenerator publication rules.",
        rootCauseLevel: "validator",
        exactRemediation: "For future RSS output, keep the validator finding blocking and tighten the prompt or rewrite retry path if the issue recurs.",
      });
    }
  }
  for (const item of evidence?.podcastTranscripts?.items || []) {
    checkText(findings, { text: item.textExcerpt, sourceType: "podcast_transcript", itemTitleOrId: item.title || item.sessionId, field: "transcript" });
    checkTranscript(findings, item);
  }
  return findings;
}

export async function collectOnBrandEvidence(options = {}) {
  const lookbackDays = Math.max(1, Math.min(31, Number(options.lookbackDays || 7)));
  const windowEnd = options.windowEnd ? new Date(options.windowEnd) : new Date();
  const windowStart = options.windowStart ? new Date(options.windowStart) : new Date(windowEnd.getTime() - lookbackDays * 86400000);

  const [zernioBlogSocial, podcastTranscripts, rss] = await Promise.all([
    collectZernioEvidence({ include: options.includeZernio !== false, windowStart, windowEnd, lookbackDays }),
    collectPodcastTranscriptEvidence({ include: options.includePodcastTranscripts !== false, windowStart, windowEnd }),
    collectRssEvidence({ include: options.includeRss !== false, lookbackDays }),
  ]);

  const sourceReports = [zernioBlogSocial, podcastTranscripts, rss];
  const evidence = {
    metadata: {
      sessionId: options.sessionId,
      generatedAt: toIso(new Date()),
      lookbackDays,
      windowStart: toIso(windowStart),
      windowEnd: toIso(windowEnd),
      includedSources: sourceReports.filter((source) => source.status !== "blocked").map((source) => source.sourceType),
      blockedSources: sourceReports.filter((source) => source.status === "blocked").map((source) => ({ sourceType: source.sourceType, limitations: source.limitations || [] })),
      partialSources: sourceReports.filter((source) => source.status === "partial").map((source) => ({ sourceType: source.sourceType, limitations: source.limitations || [] })),
      repoFilesInspected: REPO_FILES_INSPECTED,
    },
    zernioBlogSocial,
    podcastTranscripts,
    rss,
  };
  evidence.skillLensPreflight = buildOnBrandSkillPreflightFindings(evidence);
  evidence.deterministicPreflight = [
    ...runDeterministicPreflight(evidence),
    ...evidence.skillLensPreflight,
  ];
  return evidence;
}

export const __testing = {
  cleanText,
  runDeterministicPreflight,
  collectZernioEvidence,
  collectPodcastTranscriptEvidence,
  collectRssEvidence,
  normaliseTranscriptObjects,
  normaliseZernioRow,
  extractTranscriptText,
};
