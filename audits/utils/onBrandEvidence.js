import { XMLParser } from "fast-xml-parser";
import { listScheduledPosts } from "../../services/oneup/utils/oneupClient.js";
import { getObjectAsText, listKeys, buildPublicUrl } from "../../services/shared/utils/r2-client.js";
import { RSS_PROMPTS } from "../../services/rss-feed-creator/utils/rss-prompts.js";

const REPO_FILES_INSPECTED = [
  "services/oneup/utils/oneupClient.js",
  "services/oneup/utils/socialScheduler.js",
  "services/oneup/utils/state.js",
  "services/oneup/routes/social.js",
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

function normaliseOneUpRow(row = {}) {
  const when = sourceDate(row);
  return {
    title: cleanText(row.title || row.post_title || row.name || ""),
    topic: cleanText(row.topic || row.category_name || row.category || ""),
    content: cleanText(row.content || row.post || row.caption || row.message || ""),
    firstComment: cleanText(row.first_comment || row.firstComment || row.comment || ""),
    platform: cleanText(row.platform || row.social_network || row.social_network_name || ""),
    account: cleanText(row.account || row.account_name || row.social_account || ""),
    status: cleanText(row.status || row.post_status || "scheduled"),
    scheduledOrPublishedAt: when ? toIso(when) : cleanText(row.date_time || row.scheduled_date_time || ""),
    sourceMethod: "OneUp getscheduledposts endpoint exposed by existing oneupClient.js",
    rawMetadata: compactObject(row, 2500),
  };
}

export async function collectOneUpEvidence({ include, windowStart, windowEnd, lookbackDays, maxPages = 4 } = {}) {
  if (!include) {
    return { sourceType: "oneup_blog_social", status: "blocked", items: [], evidenceMethod: "disabled by request", limitations: ["includeOneUp was false."] };
  }
  if (!process.env.ONEUP_API_KEY) {
    return { sourceType: "oneup_blog_social", status: "blocked", items: [], evidenceMethod: "OneUp API not called", limitations: ["ONEUP_API_KEY is not configured, so OneUp evidence could not be retrieved."] };
  }

  try {
    const rows = [];
    for (let page = 0; page < maxPages; page += 1) {
      const result = await listScheduledPosts({ start: page * 50 });
      const data = Array.isArray(result?.data) ? result.data : [];
      rows.push(...data);
      if (data.length < 50) break;
    }

    const posts = rows
      .map(normaliseOneUpRow)
      .filter((post) => {
        const date = safeDate(post.scheduledOrPublishedAt);
        return date ? inWindow(date, windowStart, windowEnd) : true;
      });

    return {
      sourceType: "oneup_blog_social",
      status: "partial",
      items: posts,
      evidenceMethod: `OneUp getscheduledposts paginated scan for the previous ${lookbackDays} day(s).`,
      limitations: [
        "The existing OneUp client exposes getscheduledposts only; historic published-post retrieval is not confirmed in this repo.",
        "Rows without parseable dates are retained as evidence but cannot be proven to sit inside the lookback window.",
      ],
    };
  } catch (error) {
    return {
      sourceType: "oneup_blog_social",
      status: "blocked",
      items: [],
      evidenceMethod: "OneUp getscheduledposts attempt failed",
      limitations: [error?.message || "OneUp evidence retrieval failed."],
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
    const keys = await listKeys("transcript", "");
    const transcriptKeys = keys
      .filter((key) => /\.txt$/i.test(key))
      .sort()
      .reverse();

    if (!transcriptKeys.length) {
      return {
        sourceType: "podcast_transcript",
        status: "partial",
        items: [],
        evidenceMethod: "R2 transcript bucket key scan",
        limitations: ["No .txt transcript objects were discovered in the transcript bucket."],
      };
    }

    const items = [];
    for (const key of transcriptKeys.slice(0, 12)) {
      const sessionId = sessionFromTranscriptKey(key);
      const meta = await readJsonMaybe("meta", `${sessionId}.json`);
      const knownDate = metaDate(meta || { sessionId }) || dateFromText(key);
      if (knownDate && !inWindow(knownDate, windowStart, windowEnd)) continue;
      const text = await getObjectAsText("transcript", key);
      const htmlKey = key.replace(/\.txt$/i, ".html");
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
        textExcerpt: excerpt(text, 10000),
        textCharCount: cleanText(text).length,
        discoveryMethod: "R2 transcript key scan plus matching meta JSON where available.",
      });
      if (items.length >= maxTranscripts) break;
    }

    return {
      sourceType: "podcast_transcript",
      status: items.length ? "partial" : "partial",
      items,
      evidenceMethod: "R2 transcript bucket key scan, transcript text read, optional meta bucket lookup.",
      limitations: [
        "The shared R2 listKeys helper returns keys only, not LastModified, so transcript recency depends on session IDs or metadata dates.",
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
    verificationMethod: finding.verificationMethod || "Rerun the on-brand audit and confirm the exact phrase no longer appears.",
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
      exactRemediation: `Remove the '${prefix}:' prefix and rewrite the headline as a specific editorial angle.`,
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
      exactRemediation: "Re-angle the headline around the concrete tension or consequence in the item.",
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
      exactRemediation: "Cut the title to one clear angle, ideally 5 to 12 words.",
    });
  }
}

function checkText(findings, { text, sourceType, itemTitleOrId, field = "copy" }) {
  const cleaned = cleanText(text);
  if (!cleaned) return;
  for (const phrase of CORPORATE_FILLER) {
    if (cleaned.toLowerCase().includes(phrase)) {
      addFinding(findings, {
        severity: ["groundbreaking", "transformative", "game-changer", "paradigm shift"].includes(phrase) ? "high" : "medium",
        sourceType,
        itemTitleOrId,
        issueType: "corporate filler or hype leakage",
        exactEvidence: phrase,
        whyItIsOffBrand: `The ${field} uses generic AI/newsroom phrasing rather than plain, sceptical editorial judgement.`,
        violatedRule: "No hype, no corporate wallpaper, no generic AI summary tone.",
        exactRemediation: `Replace '${phrase}' with the concrete fact, risk, or consequence being described.`,
      });
    }
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
      exactRemediation: "Strip the leaked label and add a validator gate before publication.",
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
      exactRemediation: "Strip or render HTML before the item reaches the model or report.",
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
      exactRemediation: "Strip wrapper CTA anchors before brand analysis.",
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
      exactRemediation: "Use the British spelling where natural, for example optimise, centre, behaviour, colour, analyse.",
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
      exactRemediation: "Split the line into two shorter spoken sentences and cut abstract padding.",
      verificationMethod: "Read the sentence aloud or run the transcript QA audit; it should survive TTS without breathless pacing.",
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
      exactRemediation: "Vary or remove the transition; connect the ideas with editorial causality instead.",
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
      exactRemediation: "Replace source-order signposting with a thematic transition that explains why the next item matters.",
    });
  }
}

export function runDeterministicPreflight(evidence) {
  const findings = [];
  for (const item of evidence?.oneUpBlogSocial?.items || []) {
    const id = item.title || item.topic || item.scheduledOrPublishedAt || "OneUp post";
    checkTitle(findings, { title: item.title, sourceType: "oneup_blog_social", itemTitleOrId: id });
    checkText(findings, { text: `${item.content}\n${item.firstComment}`, sourceType: "oneup_blog_social", itemTitleOrId: id, field: "post" });
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
        exactRemediation: "Keep the validator finding blocking and tighten the prompt or rewrite retry path if the issue recurs.",
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

  const [oneUpBlogSocial, podcastTranscripts, rss] = await Promise.all([
    collectOneUpEvidence({ include: options.includeOneUp !== false, windowStart, windowEnd, lookbackDays }),
    collectPodcastTranscriptEvidence({ include: options.includePodcastTranscripts !== false, windowStart, windowEnd }),
    collectRssEvidence({ include: options.includeRss !== false, lookbackDays }),
  ]);

  const sourceReports = [oneUpBlogSocial, podcastTranscripts, rss];
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
    oneUpBlogSocial,
    podcastTranscripts,
    rss,
  };
  evidence.deterministicPreflight = runDeterministicPreflight(evidence);
  return evidence;
}

export const __testing = {
  cleanText,
  runDeterministicPreflight,
  collectOneUpEvidence,
  collectPodcastTranscriptEvidence,
  collectRssEvidence,
};
