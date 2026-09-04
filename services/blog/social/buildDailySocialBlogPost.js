import { info, error, debug, warn } from "../../../logger.js";
import { getObjectAsText, putText, putJson } from "../../shared/utils/r2-client.js";
import {
  claimPendingEditorialBriefs,
  editorialBriefFingerprint,
  editorialBriefIds,
  editorialBriefPromptContext,
  finaliseEditorialBriefsAfterPublication,
  markEditorialBriefsReconciliationRequired,
  releaseEditorialBriefClaims,
} from "../../comms-hub/contentAutomationQueue.js";
import { loadSiteShell, applySiteShellToHtml } from "../../shared/utils/siteShell.js";
import { resilientRequest } from "../../shared/utils/ai-service.js";
import { slugify } from "../utils/slug.js";
import { pageTemplate, socialPostBody } from "../utils/templates.js";
import { createBlogArtwork } from "../../artwork/createBlogArtwork.js";
import { publishSocialBlogRssFeed } from "./publishSocialBlogRssFeed.js";
import { cleanSourceText, cleanSourceTitle } from "../utils/weeklyPackage.js";
import { recordEditorialEvent } from "../../social/editorialLedger.js";
import { selectSourcesByUrls } from "../../content-quality/topicFidelity.js";
import { fetchWithTimeout } from "../../shared/http-client.js";

import {
  runPhase4AutonomousContentGate,
  buildPhase4QuarantineRecord,
  phase4QuarantineKey,
} from "../../content-quality/phase4AutonomousGates.js";
import {
  runPhase5OrganicGrowthGate,
  buildPhase5QuarantineRecord,
  phase5QuarantineKey,
} from "../../content-quality/phase5OrganicGrowthGates.js";
import { runReviewCouncilGate, buildHousekeepingPlan } from "../../content-quality/reviewCouncil.js";
import {
  parseStructuredSocialBlogPackage,
  normaliseSocialBlogPackage,
  renderSocialBodyHtml,
  buildSocialArtworkPrompt,
  buildSocialPostManifestEntry,
  mergeSocialPostsManifest,
  findExistingSocialPostForDate,
  buildSocialPackagePrompt,
  buildSocialBrandQaPrompt,
  parseSocialBrandQaResponse,
  validateSocialBlogPackageForBrand,
} from "../utils/socialBlogPackage.js";

const DEFAULT_SOCIAL_PREFIX = "social-media-blog";
const SOURCE_RSS_BUCKET_KEY = "rss";
const SOURCE_RSS_FEED_KEY = "feed.json";
const OUT_BLOG_BUCKET_KEY = "blog";
const MS_PER_DAY = 86_400_000;

function normalisePrefix(value = DEFAULT_SOCIAL_PREFIX) {
  return String(value || DEFAULT_SOCIAL_PREFIX).trim().replace(/^\/+|\/+$/g, "") || DEFAULT_SOCIAL_PREFIX;
}

function parsePubDate(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function renderPageWithSiteShell(siteShell, options) {
  return applySiteShellToHtml(pageTemplate(options), siteShell);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatHumanDate(date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function parseDateStart(dateString) {
  const match = String(dateString || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const date = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    0,
    0,
    0,
    0,
  ));

  return Number.isNaN(date.getTime()) ? null : date;
}

export function buildDailySocialWindow({ now = new Date(), date, days = 1 } = {}) {
  const safeDays = Math.min(Math.max(Number.parseInt(days, 10) || 1, 1), 7);

  if (date) {
    const dayStart = parseDateStart(date);
    if (!dayStart) throw new Error(`Invalid date '${date}'. Expected YYYY-MM-DD.`);

    const end = new Date(dayStart.getTime() + MS_PER_DAY);
    const start = new Date(end.getTime() - safeDays * MS_PER_DAY);
    const dateId = formatIsoDate(dayStart);

    return {
      start,
      end,
      days: safeDays,
      dateId,
      dateLabel: safeDays === 1
        ? dateId
        : `${formatHumanDate(start)} to ${formatHumanDate(new Date(end.getTime() - MS_PER_DAY))}`,
      mode: "utc-date-window",
    };
  }

  const end = new Date(now);
  const start = new Date(end.getTime() - safeDays * MS_PER_DAY);
  // The source evidence is the trailing N-hour window, but the published
  // package belongs to the day it is actually created. Using yesterday's date
  // here made a live Tuesday build appear to be Monday's daily post.
  const dateId = formatIsoDate(end);

  return {
    start,
    end,
    days: safeDays,
    dateId,
    dateLabel: safeDays === 1
      ? dateId
      : `${formatHumanDate(start)} to ${formatHumanDate(new Date(end.getTime() - MS_PER_DAY))}`,
    mode: "rolling-previous-hours",
  };
}

function readItemDescription(item = {}) {
  const description = item?.description;

  if (typeof description === "string") return description;
  if (description?.__cdata) return description.__cdata;
  if (description?._text) return description._text;
  if (item?.content?.__cdata) return item.content.__cdata;
  if (item?.summary) return item.summary;

  return "";
}

function normaliseFeedItems(feed, window) {
  const channel = feed?.rss?.channel || feed?.channel || {};
  const itemsRaw = channel?.item || feed?.items || [];
  const itemsArray = Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw];

  return itemsArray
    .map((item) => {
      const pubDateRaw = item?.pubDate || item?.published || item?.published_at || item?.date;
      const pubDate = parsePubDate(pubDateRaw);

      return {
        title: cleanSourceTitle(item?.title || item?.shortTitle || item?.headline || "Untitled"),
        link: String(item?.link || item?.url || "").trim(),
        pubDate,
        pubDateRaw,
        rewritten: cleanSourceText(readItemDescription(item)),
      };
    })
    .filter((item) => item.pubDate && item.pubDate >= window.start && item.pubDate < window.end && item.rewritten)
    .sort((a, b) => b.pubDate - a.pubDate);
}

async function loadExistingPostsManifest(bucketKey, key) {
  try {
    const raw = await getObjectAsText(bucketKey, key);
    const parsed = JSON.parse(raw);

    return parsed && typeof parsed === "object"
      ? parsed
      : { schema_version: 1, updated_at: null, items: [] };
  } catch {
    return { schema_version: 1, updated_at: null, items: [] };
  }
}

function joinUrl(base, path) {
  return `${String(base || "").replace(/\/$/, "")}/${String(path || "").replace(/^\//, "")}`;
}

function buildSiteSocialUrls(slug) {
  const publicBaseUrl = String(
    process.env.BLOG_SOCIAL_PUBLIC_BASE_URL ||
    "https://blog.jonathan-harris.online/social-media-blog"
  ).replace(/\/$/, "");
  const publicPostsBaseUrl = String(
    process.env.BLOG_SOCIAL_PUBLIC_POSTS_BASE_URL ||
    `${publicBaseUrl}/posts`
  ).replace(/\/$/, "");
  const encodedSlug = encodeURIComponent(slug);
  const postPath = `/blog/social/posts/${encodedSlug}/`;
  const postUrl = `${publicPostsBaseUrl}/${encodedSlug}/index.html`;

  // The public URL must point at content that exists now. The main website may
  // later ingest the same manifest, but AIMS must never report an unbuilt alias
  // as a successful post URL.
  return {
    siteBaseUrl: publicBaseUrl,
    socialHubUrl: publicBaseUrl,
    postPath,
    canonicalUrl: postUrl,
    postUrl,
    postMetaUrl: `${publicPostsBaseUrl}/${encodedSlug}/post.json`,
    postsManifestUrl: `${publicBaseUrl}/posts.json`,
  };
}

async function triggerWebsiteRebuild() {
  const hooks = [
    String(process.env.WEBSITE_REBUILD_HOOK || "").trim(),
    String(process.env.WEBSITE_REBUILD_HOOK_FALLBACK || "").trim(),
  ].filter(Boolean);

  if (!hooks.length) {
    return { ok: false, skipped: true, reason: "missing-hook-url" };
  }

  let lastError = null;

  for (const hookUrl of hooks) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        info("blog.social.rebuild.start", { hookUrl, attempt });

        const response = await fetchWithTimeout(hookUrl, { method: "POST" });
        const body = await response.text().catch(() => "");

        if (response.ok) {
          info("blog.social.rebuild.success", { hookUrl, attempt, status: response.status });
          return { ok: true, status: response.status, hookUrl, attempt, body };
        }

        lastError = new Error(`non-2xx response ${response.status}`);
        warn("blog.social.rebuild.nonOk", {
          hookUrl,
          attempt,
          status: response.status,
          body: body.slice(0, 500),
        });
      } catch (rebuildError) {
        lastError = rebuildError;
        warn("blog.social.rebuild.fail", {
          hookUrl,
          attempt,
          error: rebuildError?.message || "Unknown rebuild trigger error",
        });
      }
    }
  }

  return { ok: false, error: lastError?.message || "Unknown rebuild trigger error" };
}


async function quarantinePhase5SocialPost({ gate, dateId, socialPackage, cleanedSources, publishedObjects, context, dryRun }) {
  const key = phase5QuarantineKey("organic-visual-social", dateId);
  const record = buildPhase5QuarantineRecord({
    gate,
    contentType: "organic-visual-social",
    identifier: dateId,
    generated: socialPackage,
    sources: cleanedSources,
    context,
  });

  if (!dryRun) {
    await putJson(OUT_BLOG_BUCKET_KEY, key, record);
  }

  warn("blog.social.daily.phase5.quarantined", {
    dateId,
    quarantineKey: key,
    score: gate.score,
    defects: gate.defects.slice(0, 8),
  });

  return {
    ok: false,
    quarantined: true,
    phase: "5A/5B",
    reason: "phase-5-organic-growth-gate-failed",
    dateId,
    quarantineKey: key,
    phase5Gate: gate,
    package: socialPackage,
    publishedObjects,
  };
}

async function quarantineSocialPost({ gate, dateId, socialPackage, cleanedSources, publishedObjects, context, dryRun }) {
  const record = buildPhase4QuarantineRecord({
    gate,
    contentType: "social-content",
    identifier: dateId,
    generated: socialPackage,
    sources: cleanedSources,
    publishedObjects,
    context,
  });
  const key = phase4QuarantineKey("social-content", dateId);

  if (!dryRun) {
    await putJson(OUT_BLOG_BUCKET_KEY, key, record);
  }

  warn("blog.social.phase4.quarantined", { dateId, key, dryRun: Boolean(dryRun), defects: gate.defects.slice(0, 12) });

  return {
    ok: false,
    quarantined: true,
    dryRun: Boolean(dryRun),
    reason: "phase-4-autonomous-gate-failed",
    dateId,
    quarantineKey: key,
    gate,
  };
}

function blogSocialQaEnabled() {
  return String(process.env.BLOG_SOCIAL_QA_ENABLED || "true").trim().toLowerCase() !== "false";
}

function groundSocialArtworkPrompt(basePrompt, sources = []) {
  const evidence = (Array.isArray(sources) ? sources : []).slice(0, 3).map((source) => ({
    title: cleanSourceTitle(source?.title || ""),
    summary: cleanSourceText(source?.rewritten || source?.summary || source?.description || "").slice(0, 500),
    url: String(source?.link || source?.url || "").trim(),
  }));
  return [
    basePrompt,
    evidence.length ? `Exact source evidence for visual grounding: ${JSON.stringify(evidence)}` : "",
    "Depict one concrete person, place, object, technical action or consequence that is explicitly supported by the source evidence. Do not substitute generic AI symbolism.",
  ].filter(Boolean).join(" ");
}

async function resolveSocialArtwork({ sessionId, imagePrompt, dateId, prefix }) {
  const art = await createBlogArtwork({ sessionId, prompt: imagePrompt, keyPrefix: prefix, date: dateId, mode: "social-blog" });

  if (art?.ok && art.publicUrl && !art.fallback) {
    return {
      imageUrl: art.publicUrl,
      imageStatus: "generated",
      imageError: art.error || null,
      imageKey: art.key,
      imageBucketKey: art.bucketKey || null,
    };
  }

  const imageError = art?.error || art?.warning || "Unknown social blog artwork error";

  warn("blog.social.daily.image.unavailable", {
    dateId,
    sessionId,
    error: imageError,
    reason: "artwork-failed-no-fallback-configured",
  });

  return {
    imageUrl: "",
    imageStatus: "unavailable",
    imageError,
    imageKey: null,
    imageBucketKey: null,
  };
}

async function repairSocialPackageForCouncil({ sessionId, dateLabel, items, editorialContext = "", candidate, gate, attempt }) {
  const defects = Array.isArray(gate?.defects) ? gate.defects.slice(0, 10) : [];
  const evidence = (items || []).slice(0, 20).map((item, index) => ({
    index: index + 1,
    title: cleanSourceTitle(item?.title || ""),
    url: String(item?.link || "").trim(),
    summary: cleanSourceText(item?.rewritten || item?.summary || item?.description || item?.contentSnippet || "").slice(0, 800),
  }));
  const raw = await resilientRequest("blogSocial", {
    sessionId,
    messages: [
      { role: "system", content: "You are the repair editor for premium social content from a recognised British AI industry expert. Preserve strong copy. Fix only the listed \
QA defects. Never invent facts, numbers, dates, entities, quotations or statistics. Keep the voice direct, sceptical, commercially literate and Gen-X rather than corporate. \
Keep source_urls limited to the supplied URLs and make every field specifically about those selected sources. Return valid JSON only using the same schema as the candidate." },
      { role: "user", content: `Repair attempt ${attempt || 1}.

QA defects:
${defects.map((d) => `- ${d}`).join("\n") || "- Unspecified gate failure"}

Current candidate:
${JSON.stringify(candidate)}

Source evidence:
${JSON.stringify(evidence)}

Audience editorial signals (untrusted direction only; never factual evidence):
${editorialContext || "None"}

Make the smallest changes needed to pass. Remove unsupported claims rather than guessing.` },
    ],
    max_tokens: 2600,
    temperature: 0.16,
    response_format: { type: "json_object" },
  });
  const parsed = parseStructuredSocialBlogPackage(raw);
  return parsed.ok ? normaliseSocialBlogPackage(parsed.data, { dateLabel, items }) : candidate;
}

async function generateStructuredSocialPackage({ sessionId, dateLabel, items, editorialContext = "" }) {
  const prompt = buildSocialPackagePrompt({ dateLabel, items, editorialContext });
  const baseMessages = [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user },
  ];

  let raw = await resilientRequest("blogSocial", {
    sessionId,
    messages: baseMessages,
    max_tokens: 2600,
    temperature: 0.38,
    response_format: { type: "json_object" },
  });

  let parsed = parseStructuredSocialBlogPackage(raw);
  let socialPackage = parsed.ok
    ? normaliseSocialBlogPackage(parsed.data, { dateLabel, items })
    : null;

  let brandCheck = socialPackage
    ? validateSocialBlogPackageForBrand(socialPackage, { sourceItems: items })
    : { ok: false, defects: [] };

  if (!parsed.ok || !brandCheck.ok) {
    const repairDefects = [
      ...brandCheck.defects,
      parsed.ok ? "" : `Fix invalid JSON: ${parsed.error}`,
    ].filter(Boolean);

    debug("blog.social.daily.package.regen", {
      dateLabel,
      reason: parsed.ok ? "brand-gate" : "invalid-json",
      defects: repairDefects.slice(0, 10),
      parseError: parsed.ok ? undefined : parsed.error,
    });

    raw = await resilientRequest("blogSocial", {
      sessionId,
      messages: [
        baseMessages[0],
        {
          role: "user",
          content: `${prompt.user}

Repair instructions:
- Return valid JSON only, using exactly the required top-level keys
- Fix these defects: ${repairDefects.length ? repairDefects.join(" | ") : "off-brand, generic, unsupported, or weak social output"}
- Keep all claims traceable to the supplied rewritten RSS material
- Do not emit HTML, markdown, code fences, notes, or extra keys`,
        },
      ],
      max_tokens: 2600,
      temperature: 0.28,
      response_format: { type: "json_object" },
    });

    parsed = parseStructuredSocialBlogPackage(raw);
    socialPackage = parsed.ok
      ? normaliseSocialBlogPackage(parsed.data, { dateLabel, items })
      : null;

    brandCheck = socialPackage
      ? validateSocialBlogPackageForBrand(socialPackage, { sourceItems: items })
      : { ok: false, defects: [] };
  }

  if (!parsed.ok) {
    warn("blog.social.daily.package.parseFallback", { dateLabel, error: parsed.error });
    const fallback = normaliseSocialBlogPackage({}, { dateLabel, items });
    const fallbackCheck = validateSocialBlogPackageForBrand(fallback, { sourceItems: items });
    if (!fallbackCheck.ok) {
      const err = new Error(`Social blog fallback failed brand/topicality QA: ${fallbackCheck.defects.join(" | ")}`);
      err.statusCode = 422;
      err.socialBlogGate = fallbackCheck;
      throw err;
    }
    return { ...fallback, topic_fidelity: fallbackCheck.topicFidelity };
  }

  if (blogSocialQaEnabled()) {
    const qaPrompt = buildSocialBrandQaPrompt({ items, generatedJson: socialPackage });

    try {
      const qaRaw = await resilientRequest("blogSocial", {
        sessionId,
        messages: [
          { role: "system", content: qaPrompt.system },
          { role: "user", content: qaPrompt.user },
        ],
        max_tokens: 2400,
        temperature: 0.18,
      });

      const qa = parseSocialBrandQaResponse(qaRaw);

      if (qa.ok && qa.pass) {
        debug("blog.social.daily.package.qaPass", { dateLabel });
      } else if (qa.ok && qa.data) {
        const corrected = normaliseSocialBlogPackage(qa.data, { dateLabel, items });
        const correctedCheck = validateSocialBlogPackageForBrand(corrected, { sourceItems: items });

        if (correctedCheck.defects.length <= brandCheck.defects.length) {
          socialPackage = corrected;
          brandCheck = correctedCheck;
          info("blog.social.daily.package.qaCorrected", { dateLabel });
        } else {
          warn("blog.social.daily.package.qaCorrectionRejected", {
            dateLabel,
            defects: correctedCheck.defects.slice(0, 10),
          });
        }
      } else {
        warn("blog.social.daily.package.qaUnclear", {
          dateLabel,
          error: qa.error,
          feedback: qa.feedback?.slice(0, 500),
        });
      }
    } catch (qaError) {
      warn("blog.social.daily.package.qaFailed", {
        dateLabel,
        error: qaError?.message || "Unknown QA error",
      });
    }
  }

  if (!brandCheck.ok) {
    warn("blog.social.daily.package.brandResidual", {
      dateLabel,
      defects: brandCheck.defects.slice(0, 10),
      topicalScore: brandCheck.topicFidelity?.score ?? null,
    });
    const err = new Error(`Social blog package failed brand/topicality QA: ${brandCheck.defects.join(" | ")}`);
    err.statusCode = 422;
    err.socialBlogGate = brandCheck;
    throw err;
  }

  return { ...socialPackage, topic_fidelity: brandCheck.topicFidelity };
}

export async function buildDailySocialBlogPost({
  date,
  days = 1,
  dryRun = false,
  force = false,
} = {}) {
  const prefix = normalisePrefix(process.env.BLOG_SOCIAL_PREFIX || DEFAULT_SOCIAL_PREFIX);
  const manifestKey = `${prefix}/posts.json`;
  const window = buildDailySocialWindow({ now: new Date(), date, days });
  const sessionId = `BLOG-SOCIAL-${window.dateId}`;
  const createdAt = new Date().toISOString();
  let editorialBriefEntries = [];
  let editorialContext = "";
  let editorialBriefFinalised = false;
  let irreversiblePublicationReference = null;

  try {
    editorialBriefEntries = await claimPendingEditorialBriefs("social", {
      limit: Number(process.env.COMMS_HUB_CONTENT_AUTOMATION_BRIEF_LIMIT || 3),
      consumerId: sessionId,
    });
    editorialContext = editorialBriefPromptContext(editorialBriefEntries);
    info("blog.social.daily.build.start", {
      date: date || null,
      dateId: window.dateId,
      days: window.days,
      mode: window.mode,
      dateLabel: window.dateLabel,
      dryRun: Boolean(dryRun),
      force: Boolean(force),
      rssBucketKey: SOURCE_RSS_BUCKET_KEY,
      feedKey: SOURCE_RSS_FEED_KEY,
      prefix,
    });

    const existingManifest = await loadExistingPostsManifest(OUT_BLOG_BUCKET_KEY, manifestKey);
    const existingPost = findExistingSocialPostForDate(existingManifest, window.dateId);

    if (existingPost && !force) {
      const reason = `Daily social blog post already exists for ${window.dateId}. Pass force:true to rebuild it.`;
      info("blog.social.daily.build.skipped", {
        dateId: window.dateId,
        reason: "existing-post",
        existingId: existingPost.id,
        existingDateLabel: existingPost.date_label,
        existingPublishedAt: existingPost.published_at,
        manifestKey,
      });

      return {
        ok: true,
        skipped: true,
        reason,
        existing: existingPost,
        manifestKey,
      };
    }

    const rawFeed = await getObjectAsText(SOURCE_RSS_BUCKET_KEY, SOURCE_RSS_FEED_KEY);
    const items = normaliseFeedItems(JSON.parse(rawFeed), window);

    if (!items.length) {
      info("blog.social.daily.build.skipped", {
        dateId: window.dateId,
        dateLabel: window.dateLabel,
        reason: "no-feed-items-in-window",
        windowStart: window.start.toISOString(),
        windowEnd: window.end.toISOString(),
        rssBucketKey: SOURCE_RSS_BUCKET_KEY,
        feedKey: SOURCE_RSS_FEED_KEY,
      });

      return {
        ok: true,
        skipped: true,
        reason: `No rewritten RSS items found for ${window.dateLabel}.`,
        dateId: window.dateId,
        sourceCount: 0,
        window: {
          start: window.start.toISOString(),
          end: window.end.toISOString(),
          label: window.dateLabel,
          mode: window.mode,
        },
      };
    }

    const siteShell = await loadSiteShell();

    let socialPackage = await generateStructuredSocialPackage({
      sessionId,
      dateLabel: window.dateLabel,
      items,
      editorialContext,
    });

    let title = socialPackage.title;
    let slug = slugify(`${window.dateId}-${title}`);
    let dir = `${prefix}/posts/${slug}`;
    let urls = buildSiteSocialUrls(slug);
    let bodyHtml = renderSocialBodyHtml(socialPackage, { escapeHtml });

    let imagePrompt = buildSocialArtworkPrompt({
      title,
      summary: socialPackage.summary,
      themes: socialPackage.themes,
      generatedPrompt: socialPackage.image_prompt,
      date: window.dateId,
    });

    const selectedItems = selectSourcesByUrls(socialPackage.source_urls, items);
    if (!selectedItems.length) {
      const err = new Error("Social blog package did not select any valid source URLs.");
      err.statusCode = 422;
      throw err;
    }

    const cleanedSources = selectedItems.map((item) => ({
      title: item.title,
      link: item.link,
      pubDate: item.pubDateRaw,
    }));

    const gateSources = selectedItems.map((item) => ({
      title: item.title,
      link: item.link,
      pubDate: item.pubDateRaw,
      rewritten: item.rewritten,
      summary: item.rewritten,
    }));

    imagePrompt = groundSocialArtworkPrompt(imagePrompt, gateSources);

    const dryRunArtwork = {
      imageUrl: "",
      imageStatus: "dry_run",
      imageError: null,
      imageKey: null,
      imageBucketKey: null,
    };

    let artwork = dryRun
      ? dryRunArtwork
      : await resolveSocialArtwork({
        sessionId,
        imagePrompt,
        dateId: window.dateId,
        prefix,
      });

    if (!dryRun && !artwork.imageUrl) {
      return {
        ok: false,
        quarantined: true,
        reason: "artwork-unavailable",
        dateId: window.dateId,
        sessionId,
        error: artwork.imageError || "Social blog did not produce a verified AI-relevant image.",
      };
    }
    let imageUrl = artwork.imageUrl;

    let postEntry = buildSocialPostManifestEntry({
      id: `daily-${window.dateId}`,
      slug,
      title,
      summary: socialPackage.summary,
      socialCaption: socialPackage.social_caption,
      hook: socialPackage.hook,
      bodyHtml,
      takeaway: socialPackage.takeaway,
      postUrl: urls.postUrl,
      canonicalUrl: urls.canonicalUrl,
      path: urls.postPath,
      imageUrl,
      imagePrompt,
      imageStatus: artwork.imageStatus,
      imageError: artwork.imageError,
      imageBucketKey: artwork.imageBucketKey,
      dateLabel: window.dateId,
      themes: socialPackage.themes,
      hashtags: socialPackage.hashtags,
      sources: cleanedSources,
      publishedAt: createdAt,
    });

    let contentHtml = socialPostBody({
      title,
      summary: socialPackage.summary,
      dateLabel: window.dateLabel,
      imageUrl,
      html: bodyHtml,
      sources: cleanedSources,
      socialCaption: socialPackage.social_caption,
      hashtags: socialPackage.hashtags,
    });

    let fullHtml = renderPageWithSiteShell(siteShell, {
      title,
      description: socialPackage.summary,
      canonicalUrl: urls.canonicalUrl,
      imageUrl,
      publishedAt: createdAt,
      dateLabel: window.dateLabel,
      contentHtml,
    });

    let mergedManifest = mergeSocialPostsManifest(existingManifest, postEntry);

    let publishedObjects = {
      postHtmlKey: `${dir}/index.html`,
      postMetaKey: `${dir}/post.json`,
      manifestKey,
      rssFeedKey: process.env.BLOG_SOCIAL_RSS_OBJECT_KEY || `${prefix}/feed.xml`,
      imageKey: artwork.imageKey,
      imageBucketKey: artwork.imageBucketKey,
    };

    let phase4Gate = runPhase4AutonomousContentGate({
      contentType: "social-content",
      generated: socialPackage,
      html: fullHtml,
      sources: gateSources,
      expectedSchemaTypes: ["BlogPosting"],
    });

    if (!phase4Gate.ok) {
      const reviewed = await runReviewCouncilGate({
        councilKey: "blog-phase45",
        gate: phase4Gate,
        artifact: socialPackage,
        contentType: "social-content",
        repairArtifact: (candidatePackage, { gate, attempt } = {}) => repairSocialPackageForCouncil({
          sessionId,
          dateLabel: window.dateLabel,
          items: gateSources,
          candidate: candidatePackage,
          gate,
          attempt,
        }),
        validate: (candidatePackage) => {
          const brandGate = validateSocialBlogPackageForBrand(candidatePackage, { sourceItems: gateSources });
          if (!brandGate.ok) {
            return { ok: false, score: brandGate.topicFidelity?.score || 0, defects: brandGate.defects, warnings: [], contentType: "social-content" };
          }
          const candidateBodyHtml = renderSocialBodyHtml(candidatePackage, { escapeHtml });
          const candidateContentHtml = socialPostBody({
            title: candidatePackage.title,
            summary: candidatePackage.summary,
            dateLabel: window.dateLabel,
            imageUrl,
            html: candidateBodyHtml,
            sources: cleanedSources,
            socialCaption: candidatePackage.social_caption,
            hashtags: candidatePackage.hashtags,
          });
          const candidateFullHtml = renderPageWithSiteShell(siteShell, {
            title: candidatePackage.title,
            description: candidatePackage.summary,
            canonicalUrl: urls.canonicalUrl,
            imageUrl,
            publishedAt: createdAt,
            dateLabel: window.dateLabel,
            contentHtml: candidateContentHtml,
          });
          return runPhase4AutonomousContentGate({
            contentType: "social-content",
            generated: candidatePackage,
            html: candidateFullHtml,
            sources: gateSources,
            expectedSchemaTypes: ["BlogPosting"],
          });
        },
      });

      if (!reviewed.ok) {
        return await quarantineSocialPost({
          gate: reviewed.gate,
          dateId: window.dateId,
          socialPackage: reviewed.artifact,
          cleanedSources: gateSources,
          publishedObjects,
          context: { dateLabel: window.dateLabel, prefix, slug, postUrl: urls.postUrl, housekeeping: buildHousekeepingPlan({ lane: "daily-social-blog", artefacts:
             Object.values(publishedObjects).filter(Boolean) }) },
          dryRun,
        });
      }

      socialPackage = reviewed.artifact;
      title = socialPackage.title;
      slug = slugify(`${window.dateId}-${title}`);
      dir = `${prefix}/posts/${slug}`;
      urls = buildSiteSocialUrls(slug);
      bodyHtml = renderSocialBodyHtml(socialPackage, { escapeHtml });
      imagePrompt = groundSocialArtworkPrompt(buildSocialArtworkPrompt({
        title,
        summary: socialPackage.summary,
        themes: socialPackage.themes,
        generatedPrompt: socialPackage.image_prompt,
        date: window.dateId,
      }), gateSources);
      postEntry = buildSocialPostManifestEntry({
        id: `daily-${window.dateId}`,
        slug,
        title,
        summary: socialPackage.summary,
        socialCaption: socialPackage.social_caption,
        hook: socialPackage.hook,
        bodyHtml,
        takeaway: socialPackage.takeaway,
        postUrl: urls.postUrl,
        canonicalUrl: urls.canonicalUrl,
        path: urls.postPath,
        imageUrl,
        imagePrompt,
        imageStatus: artwork.imageStatus,
        imageError: artwork.imageError,
        imageBucketKey: artwork.imageBucketKey,
        dateLabel: window.dateId,
        themes: socialPackage.themes,
        hashtags: socialPackage.hashtags,
        sources: cleanedSources,
        publishedAt: createdAt,
      });
      contentHtml = socialPostBody({
        title,
        summary: socialPackage.summary,
        dateLabel: window.dateLabel,
        imageUrl,
        html: bodyHtml,
        sources: cleanedSources,
        socialCaption: socialPackage.social_caption,
        hashtags: socialPackage.hashtags,
      });
      fullHtml = renderPageWithSiteShell(siteShell, {
        title,
        description: socialPackage.summary,
        canonicalUrl: urls.canonicalUrl,
        imageUrl,
        publishedAt: createdAt,
        dateLabel: window.dateLabel,
        contentHtml,
      });
      mergedManifest = mergeSocialPostsManifest(existingManifest, postEntry);
      publishedObjects = {
        postHtmlKey: `${dir}/index.html`,
        postMetaKey: `${dir}/post.json`,
        manifestKey,
        rssFeedKey: process.env.BLOG_SOCIAL_RSS_OBJECT_KEY || `${prefix}/feed.xml`,
        imageKey: artwork.imageKey,
        imageBucketKey: artwork.imageBucketKey,
      };
      phase4Gate = reviewed.gate;
    }

    let phase5Gate = runPhase5OrganicGrowthGate({
      contentType: "organic-visual-social",
      generated: {
        ...socialPackage,
        imagePrompt,
        imageUrl,
        caption: socialPackage.social_caption,
      },
      sources: gateSources,
      platforms: ["facebook", "instagram", "tiktok"],
    });

    if (!phase5Gate.ok) {
      const reviewed = await runReviewCouncilGate({
        councilKey: "blog-phase45",
        gate: phase5Gate,
        artifact: { ...socialPackage, imagePrompt, imageUrl, caption: socialPackage.social_caption },
        contentType: "organic-visual-social",
        repairArtifact: (candidate, { gate, attempt } = {}) => repairSocialPackageForCouncil({
          sessionId,
          dateLabel: window.dateLabel,
          items: gateSources,
          candidate,
          gate,
          attempt,
        }),
        validate: (candidate) => {
          const brandGate = validateSocialBlogPackageForBrand(candidate, { sourceItems: gateSources });
          if (!brandGate.ok) return { ok: false, score: brandGate.topicFidelity?.score || 0, defects: brandGate.defects, warnings: [], contentType: "organic-visual-social" };

          const candidateBodyHtml = renderSocialBodyHtml(candidate, { escapeHtml });
          const candidateContentHtml = socialPostBody({
            title: candidate.title,
            summary: candidate.summary,
            dateLabel: window.dateLabel,
            imageUrl,
            html: candidateBodyHtml,
            sources: cleanedSources,
            socialCaption: candidate.social_caption,
            hashtags: candidate.hashtags,
          });
          const candidateFullHtml = renderPageWithSiteShell(siteShell, {
            title: candidate.title,
            description: candidate.summary,
            canonicalUrl: urls.canonicalUrl,
            imageUrl,
            publishedAt: createdAt,
            dateLabel: window.dateLabel,
            contentHtml: candidateContentHtml,
          });
          const candidatePhase4 = runPhase4AutonomousContentGate({
            contentType: "social-content",
            generated: candidate,
            html: candidateFullHtml,
            sources: gateSources,
            expectedSchemaTypes: ["BlogPosting"],
          });
          if (!candidatePhase4.ok) return candidatePhase4;

          return runPhase5OrganicGrowthGate({
            contentType: "organic-visual-social",
            generated: candidate,
            sources: gateSources,
            platforms: ["facebook", "instagram", "tiktok"],
          });
        },
      });

      if (!reviewed.ok) {
        return await quarantinePhase5SocialPost({
          gate: reviewed.gate,
          dateId: window.dateId,
          socialPackage: reviewed.artifact,
          cleanedSources: gateSources,
          publishedObjects,
          context: { dateLabel: window.dateLabel, prefix, slug, postUrl: urls.postUrl, housekeeping: buildHousekeepingPlan({ lane: "daily-social-blog-phase5", artefacts:
             Object.values(publishedObjects).filter(Boolean) }) },
          dryRun,
        });
      }

      const previousImagePrompt = imagePrompt;
      socialPackage = normaliseSocialBlogPackage({ ...socialPackage, ...reviewed.artifact }, { dateLabel: window.dateLabel, items: gateSources });
      const finalBrandGate = validateSocialBlogPackageForBrand(socialPackage, { sourceItems: gateSources });
      if (!finalBrandGate.ok) {
        return await quarantinePhase5SocialPost({
          gate: { ok: false, score: finalBrandGate.topicFidelity?.score || 0, defects: finalBrandGate.defects, warnings: [], contentType: "organic-visual-social" },
          dateId: window.dateId,
          socialPackage,
          cleanedSources: gateSources,
          publishedObjects,
          context: { dateLabel: window.dateLabel, prefix, slug, postUrl: urls.postUrl, reason: "post-review-brand-topic-regression" },
          dryRun,
        });
      }
      socialPackage.topic_fidelity = finalBrandGate.topicFidelity;

      title = socialPackage.title;
      slug = slugify(`${window.dateId}-${title}`);
      dir = `${prefix}/posts/${slug}`;
      urls = buildSiteSocialUrls(slug);
      bodyHtml = renderSocialBodyHtml(socialPackage, { escapeHtml });
      imagePrompt = groundSocialArtworkPrompt(buildSocialArtworkPrompt({
        title,
        summary: socialPackage.summary,
        themes: socialPackage.themes,
        generatedPrompt: socialPackage.image_prompt,
        date: window.dateId,
      }), gateSources);

      if (!dryRun && imagePrompt !== previousImagePrompt) {
        artwork = await resolveSocialArtwork({
          sessionId: `${sessionId}-phase5-repair`,
          imagePrompt,
          dateId: window.dateId,
          prefix,
        });
        imageUrl = artwork.imageUrl;
      }

      postEntry = buildSocialPostManifestEntry({
        id: `daily-${window.dateId}`,
        slug,
        title,
        summary: socialPackage.summary,
        socialCaption: socialPackage.social_caption,
        hook: socialPackage.hook,
        bodyHtml,
        takeaway: socialPackage.takeaway,
        postUrl: urls.postUrl,
        canonicalUrl: urls.canonicalUrl,
        path: urls.postPath,
        imageUrl,
        imagePrompt,
        imageStatus: artwork.imageStatus,
        imageError: artwork.imageError,
        imageBucketKey: artwork.imageBucketKey,
        dateLabel: window.dateId,
        themes: socialPackage.themes,
        hashtags: socialPackage.hashtags,
        sources: cleanedSources,
        publishedAt: createdAt,
      });
      contentHtml = socialPostBody({
        title,
        summary: socialPackage.summary,
        dateLabel: window.dateLabel,
        imageUrl,
        html: bodyHtml,
        sources: cleanedSources,
        socialCaption: socialPackage.social_caption,
        hashtags: socialPackage.hashtags,
      });
      fullHtml = renderPageWithSiteShell(siteShell, {
        title,
        description: socialPackage.summary,
        canonicalUrl: urls.canonicalUrl,
        imageUrl,
        publishedAt: createdAt,
        dateLabel: window.dateLabel,
        contentHtml,
      });
      mergedManifest = mergeSocialPostsManifest(existingManifest, postEntry);
      publishedObjects = {
        postHtmlKey: `${dir}/index.html`,
        postMetaKey: `${dir}/post.json`,
        manifestKey,
        rssFeedKey: process.env.BLOG_SOCIAL_RSS_OBJECT_KEY || `${prefix}/feed.xml`,
        imageKey: artwork.imageKey,
        imageBucketKey: artwork.imageBucketKey,
      };

      phase4Gate = runPhase4AutonomousContentGate({
        contentType: "social-content",
        generated: socialPackage,
        html: fullHtml,
        sources: gateSources,
        expectedSchemaTypes: ["BlogPosting"],
      });
      if (!phase4Gate.ok) {
        return await quarantineSocialPost({
          gate: phase4Gate,
          dateId: window.dateId,
          socialPackage,
          cleanedSources: gateSources,
          publishedObjects,
          context: { dateLabel: window.dateLabel, prefix, slug, postUrl: urls.postUrl, reason: "phase5-repair-regressed-phase4" },
          dryRun,
        });
      }

      phase5Gate = runPhase5OrganicGrowthGate({
        contentType: "organic-visual-social",
        generated: { ...socialPackage, imagePrompt, imageUrl, caption: socialPackage.social_caption },
        sources: gateSources,
        platforms: ["facebook", "instagram", "tiktok"],
      });
      if (!phase5Gate.ok) {
        return await quarantinePhase5SocialPost({
          gate: phase5Gate,
          dateId: window.dateId,
          socialPackage,
          cleanedSources: gateSources,
          publishedObjects,
          context: { dateLabel: window.dateLabel, prefix, slug, postUrl: urls.postUrl, reason: "phase5-repair-final-validation-failed" },
          dryRun,
        });
      }
    }

    if (dryRun) {
      recordEditorialEvent({
        pipeline: "blog-social",
        lane: "daily-social-blog",
        audienceIntent: "daily-social-blog-briefing",
        source: cleanedSources[0],
        angle: socialPackage.themes?.[0] || title,
        scheduledDateTime: createdAt,
        text: socialPackage.social_caption,
        meta: { contentType: "daily-social-blog", dryRun: true, qaMode: socialPackage.qa_mode || "model-package" },
      });

      const released = await releaseEditorialBriefClaims(editorialBriefEntries, {
        consumerId: sessionId,
        reason: "social_blog_dry_run",
      });
      editorialBriefFinalised = true;
      const briefHandoff = editorialBriefEntries.length
        ? { ok: released.every((item) => item.ok === true), status: "released", reason: "dry_run", released }
        : { ok: true, skipped: true, reason: "no_editorial_briefs" };

      return {
        ok: true,
        dryRun: true,
        dateId: window.dateId,
        days: window.days,
        title,
        slug,
        summary: socialPackage.summary,
        social_caption: socialPackage.social_caption,
        postPath: urls.postPath,
        postUrl: urls.postUrl,
        canonicalUrl: urls.canonicalUrl,
        postMetaUrl: urls.postMetaUrl,
        postsManifestUrl: urls.postsManifestUrl,
        imagePrompt,
        imageStatus: artwork.imageStatus,
        imageError: artwork.imageError,
        imageBucketKey: artwork.imageBucketKey,
        sourceCount: cleanedSources.length,
        inputSourceCount: items.length,
        package: socialPackage,
        publishedObjects,
        phase4Gate,
        phase5Gate,
        briefHandoff,
        editorialBriefIds: editorialBriefIds(editorialBriefEntries),
        editorialBriefFingerprint: editorialBriefFingerprint(editorialBriefEntries),
      };
    }

    irreversiblePublicationReference = {
      sessionId,
      postUrl: urls.postUrl,
      canonicalUrl: urls.canonicalUrl,
      postHtmlKey: `${dir}/index.html`,
    };
    await putText(OUT_BLOG_BUCKET_KEY, `${dir}/index.html`, fullHtml, "text/html; charset=utf-8");

    await putJson(OUT_BLOG_BUCKET_KEY, `${dir}/post.json`, {
      schema_version: 1,
      ok: true,
      ...postEntry,
      image_generation_status: artwork.imageStatus,
      image_generation_error: artwork.imageError,
      image_bucket_key: artwork.imageBucketKey,
      days: window.days,
      window: {
        start: window.start.toISOString(),
        end: window.end.toISOString(),
        label: window.dateLabel,
        mode: window.mode,
      },
      created_at: createdAt,
    });

    await putJson(OUT_BLOG_BUCKET_KEY, manifestKey, mergedManifest);

    const publishedManifest = await loadExistingPostsManifest(OUT_BLOG_BUCKET_KEY, manifestKey);
    const rss = await publishSocialBlogRssFeed({ manifest: publishedManifest, prefix });
    const rebuild = { ok: true, skipped: true, reason: "blog-social-r2-rss-does-not-require-website-rebuild" };

    recordEditorialEvent({
      pipeline: "blog-social",
      lane: "daily-social-blog",
      audienceIntent: "daily-social-blog-briefing",
      source: cleanedSources[0],
      angle: socialPackage.themes?.[0] || title,
      scheduledDateTime: createdAt,
      text: socialPackage.social_caption,
      meta: { contentType: "daily-social-blog", postUrl: urls.postUrl, qaMode: socialPackage.qa_mode || "model-package" },
    });

    info("blog.social.daily.build.success", {
      dateId: window.dateId,
      postUrl: urls.postUrl,
      canonicalUrl: urls.canonicalUrl,
      postMetaUrl: urls.postMetaUrl,
      postsManifestUrl: urls.postsManifestUrl,
      rssFeedUrl: rss.feedUrl,
      imageUrl,
      imageStatus: artwork.imageStatus,
      sourceCount: cleanedSources.length,
      inputSourceCount: items.length,
      themeCount: socialPackage.themes.length,
    });

    let briefHandoff = { ok: true, skipped: true, reason: "no_editorial_briefs" };
    if (editorialBriefEntries.length) {
      editorialBriefFinalised = true;
      briefHandoff = await finaliseEditorialBriefsAfterPublication(editorialBriefEntries, {
        consumerId: sessionId,
        resultReference: {
          sessionId,
          postUrl: urls.postUrl,
          rssFeedUrl: rss.feedUrl,
          briefIds: editorialBriefIds(editorialBriefEntries),
          briefFingerprint: editorialBriefFingerprint(editorialBriefEntries),
        },
        reconciliationReason: "social_blog_published_but_brief_archive_failed",
      });
    }

    return {
      ok: true,
      partialFailure: briefHandoff.ok === false || briefHandoff.reconciliationRequired === true,
      dateId: window.dateId,
      days: window.days,
      title,
      slug,
      summary: socialPackage.summary,
      social_caption: socialPackage.social_caption,
      postPath: urls.postPath,
      postUrl: urls.postUrl,
      canonicalUrl: urls.canonicalUrl,
      postMetaUrl: urls.postMetaUrl,
      postsManifestUrl: urls.postsManifestUrl,
      socialHubUrl: urls.socialHubUrl,
      imageUrl,
      imageStatus: artwork.imageStatus,
      imageError: artwork.imageError,
      imageBucketKey: artwork.imageBucketKey,
      rssFeedUrl: rss.feedUrl,
      rss,
      publishedObjects,
      phase4Gate,
      phase5Gate,
      sourceCount: cleanedSources.length,
      inputSourceCount: items.length,
      rebuild,
      briefHandoff,
      editorialBriefIds: editorialBriefIds(editorialBriefEntries),
      editorialBriefFingerprint: editorialBriefFingerprint(editorialBriefEntries),
    };
  } catch (e) {
    error("blog.social.daily.build.fail", {
      error: e.message,
      stack: e.stack,
    });

    let briefHandoff = null;
    if (editorialBriefEntries.length && !editorialBriefFinalised && irreversiblePublicationReference) {
      editorialBriefFinalised = true;
      const reconciliation = await markEditorialBriefsReconciliationRequired(editorialBriefEntries, {
        consumerId: sessionId,
        resultReference: {
          ...irreversiblePublicationReference,
          error: e?.message || String(e),
        },
        reason: "social_blog_failed_after_publication_started",
      });
      briefHandoff = {
        ok: reconciliation.every((item) => item.ok === true),
        status: "reconciliation_required",
        reconciliationRequired: true,
        reconciliation,
      };
    }

    return {
      ok: false,
      partialFailure: Boolean(briefHandoff),
      statusCode: Number(e?.statusCode || 500),
      error: e.message,
      ...(briefHandoff ? { briefHandoff } : {}),
      ...(e?.socialBlogGate ? { socialBlogGate: e.socialBlogGate } : {}),
    };
  } finally {
    if (editorialBriefEntries.length && !editorialBriefFinalised) {
      await releaseEditorialBriefClaims(editorialBriefEntries, {
        consumerId: sessionId,
        reason: "social_blog_failed_before_confirmed_publication",
      }).catch((releaseError) => {
        error("blog.social.daily.brief_release_fail", { error: releaseError?.message || String(releaseError) });
      });
    }
  }
}
