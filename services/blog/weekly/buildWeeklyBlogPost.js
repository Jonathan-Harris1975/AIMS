// services/blog/weekly/buildWeeklyBlogPost.js
import { info, error, debug, warn } from "../../../logger.js";
import { getObjectAsText, putText, putJson } from "../../shared/utils/r2-client.js";
import { loadSiteShell, applySiteShellToHtml } from "../../shared/utils/siteShell.js";
import { resilientRequest } from "../../shared/utils/ai-service.js";
import { slugify } from "../utils/slug.js";
import { pageTemplate, weeklyPostBody } from "../utils/templates.js";
import { createBlogArtwork } from "../../artwork/createBlogArtwork.js";
import { publishBlogRssFeed, verifyPublicBlogRssFeed } from "../rss/publishBlogRssFeed.js";

import {
  runPhase4AutonomousContentGate,
  buildPhase4QuarantineRecord,
  phase4QuarantineKey,
} from "../../content-quality/phase4AutonomousGates.js";
import { runReviewCouncilGate, buildHousekeepingPlan } from "../../content-quality/reviewCouncil.js";
import {
  cleanSourceText,
  cleanSourceTitle,
  parseStructuredWeeklyPackage,
  normaliseWeeklyPackage,
  renderWeeklyBodyHtml,
  buildBlogArtworkPrompt,
  buildPostManifestEntry,
  mergePostsManifest,
  buildWeeklyPackagePrompt,
  buildWeeklyBrandQaPrompt,
  parseWeeklyBrandQaResponse,
  validateWeeklyPackageForBrand,
  hasBannedPhrases,
} from "../utils/weeklyPackage.js";

function isoWeekId(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  const yyyy = date.getUTCFullYear();
  return `${yyyy}-W${String(weekNo).padStart(2, "0")}`;
}

function parseIsoWeekId(weekId) {
  const match = String(weekId || "").match(/^(\d{4})-W(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const week = Number(match[2]);
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const januaryFourthDay = januaryFourth.getUTCDay() || 7;
  const weekStart = new Date(januaryFourth);
  weekStart.setUTCDate(januaryFourth.getUTCDate() - januaryFourthDay + 1 + (week - 1) * 7);
  weekStart.setUTCHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  return {
    weekId: `${year}-W${String(week).padStart(2, "0")}`,
    start: weekStart,
    end: weekEnd,
  };
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

function formatDate(date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function buildWeeklyWindow({ now = new Date(), weekId, days } = {}) {
  if (weekId) {
    const parsedWeek = parseIsoWeekId(weekId);
    if (!parsedWeek) {
      throw new Error(`Invalid weekId '${weekId}'. Expected format YYYY-WNN.`);
    }

    return {
      week: parsedWeek.weekId,
      start: parsedWeek.start,
      end: parsedWeek.end,
      days: Math.round((parsedWeek.end - parsedWeek.start) / 86400000),
      dateLabel: `${formatDate(parsedWeek.start)} to ${formatDate(new Date(parsedWeek.end.getTime() - 86400000))}`,
      mode: "iso-week",
    };
  }

  if (Number.isInteger(days) && days > 0) {
    const end = new Date(now);
    const start = new Date(end.getTime() - days * 86400000);
    return {
      week: isoWeekId(new Date(end.getTime() - 86400000)),
      start,
      end,
      days,
      dateLabel: `${formatDate(start)} to ${formatDate(new Date(end.getTime() - 86400000))}`,
      mode: "rolling-window",
    };
  }

  const utcNow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = utcNow.getUTCDay() || 7;
  const startOfCurrentWeek = new Date(utcNow);
  startOfCurrentWeek.setUTCDate(utcNow.getUTCDate() - day + 1);

  const start = new Date(startOfCurrentWeek);
  start.setUTCDate(start.getUTCDate() - 7);

  const end = new Date(startOfCurrentWeek);

  return {
    week: isoWeekId(start),
    start,
    end,
    days: Math.round((end - start) / 86400000),
    dateLabel: `${formatDate(start)} to ${formatDate(new Date(end.getTime() - 86400000))}`,
    mode: "previous-complete-week",
  };
}

function normaliseFeedItems(feed, window) {
  const channel = feed?.rss?.channel || {};
  const itemsRaw = channel?.item || [];
  const itemsArray = Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw];

  return itemsArray
    .map((item) => {
      const pubDateRaw = item?.pubDate;
      const pubDate = parsePubDate(pubDateRaw);
      const rewritten = cleanSourceText(item?.description?.__cdata || "");
      const title = cleanSourceTitle(item?.title || item?.shortTitle || "Untitled");
      const link = String(item?.link || "").trim();
      return {
        title,
        link,
        pubDate,
        pubDateRaw,
        rewritten,
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

function buildSiteBlogBaseUrls(prefix = "blog") {
  const siteBaseUrl = String(process.env.SITE_BASE_URL || "https://jonathan-harris.online").replace(/\/$/, "");
  const normalisedPrefix = String(prefix || "blog").replace(/^\/+|\/+$/g, "") || "blog";
  const blogBasePath = `/${normalisedPrefix}`;

  return {
    siteBaseUrl,
    blogBasePath,
    blogHubUrl: joinUrl(siteBaseUrl, `${blogBasePath}/`),
    weeklyArchiveUrl: joinUrl(siteBaseUrl, `${blogBasePath}/weekly/`),
  };
}

function buildSiteBlogUrls(slug, prefix = "blog") {
  const baseUrls = buildSiteBlogBaseUrls(prefix);
  const postPath = `${baseUrls.blogBasePath}/posts/${encodeURIComponent(slug)}/`;

  return {
    ...baseUrls,
    postPath,
    postUrl: joinUrl(baseUrls.siteBaseUrl, postPath),
    postMetaUrl: joinUrl(baseUrls.siteBaseUrl, `${postPath}post.json`),
    postsManifestUrl: joinUrl(baseUrls.siteBaseUrl, `${baseUrls.blogBasePath}/posts.json`),
  };
}

async function triggerWebsiteRebuild() {
  const primaryHook = String(process.env.WEBSITE_REBUILD_HOOK || "https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/be062a91-ac03-4d1a-b4fe-c4d99a92b5a6").trim();
  const fallbackHook = String(process.env.WEBSITE_REBUILD_HOOK_FALLBACK || "").trim();
  const hooks = [primaryHook, fallbackHook].filter(Boolean);

  if (!hooks.length) {
    return { ok: false, skipped: true, reason: "missing-hook-url" };
  }

  let lastError = null;

  for (const hookUrl of hooks) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        info("blog.weekly.rebuild.start", { hookUrl, attempt });
        const response = await fetch(hookUrl, { method: "POST" });
        const body = await response.text().catch(() => "");
        const result = { ok: response.ok, status: response.status, hookUrl, attempt, body };

        if (response.ok) {
          info("blog.weekly.rebuild.success", {
            hookUrl,
            attempt,
            status: response.status,
          });
          return result;
        }

        lastError = new Error(`non-2xx response ${response.status}`);
        warn("blog.weekly.rebuild.nonOk", {
          hookUrl,
          attempt,
          status: response.status,
          body: body.slice(0, 500),
        });
      } catch (rebuildError) {
        lastError = rebuildError;
        warn("blog.weekly.rebuild.fail", {
          hookUrl,
          attempt,
          error: rebuildError?.message || "Unknown rebuild trigger error",
        });
      }
    }
  }

  return {
    ok: false,
    error: lastError?.message || "Unknown rebuild trigger error",
  };
}

function blogWeeklyQaEnabled() {
  return String(process.env.BLOG_WEEKLY_QA_ENABLED || "true").trim().toLowerCase() !== "false";
}

async function resolveBlogArtwork({ sessionId, imagePrompt, week, dateLabel }) {
  const art = await createBlogArtwork({ sessionId, prompt: imagePrompt, week, date: dateLabel });

  if (art?.ok && art.publicUrl) {
    return {
      imageUrl: art.publicUrl,
      imageStatus: art.fallback ? "fallback" : "generated",
      imageError: art.error || null,
      imageBucketKey: art.bucketKey || null,
    };
  }

  const imageError = art?.error || "Unknown blog artwork error";

  warn("blog.weekly.image.unavailable", {
    week,
    sessionId,
    error: imageError,
    reason: "artwork-failed-no-fallback-configured",
  });

  return {
    imageUrl: "",
    imageStatus: "unavailable",
    imageError,
    imageBucketKey: null,
  };
}

async function quarantineWeeklyPost({ gate, week, weeklyPackage, cleanedSources, publishedObjects, context }) {
  const key = phase4QuarantineKey("weekly-blog", week);
  const record = buildPhase4QuarantineRecord({
    gate,
    contentType: "weekly-blog",
    identifier: week,
    generated: weeklyPackage,
    sources: cleanedSources,
    publishedObjects,
    context,
  });

  await putJson("blog", key, record);
  warn("blog.weekly.phase4.quarantined", { week, key, defects: gate.defects.slice(0, 12) });

  return {
    ok: false,
    quarantined: true,
    reason: "phase-4-autonomous-gate-failed",
    week,
    quarantineKey: key,
    gate,
  };
}

async function repairWeeklyPackageForCouncil({ sessionId, week, dateLabel, items, candidate, gate, attempt }) {
  const defects = Array.isArray(gate?.defects) ? gate.defects.slice(0, 10) : [];
  const evidence = (items || []).slice(0, 30).map((item, index) => ({
    index: index + 1,
    title: cleanSourceTitle(item?.title || ""),
    summary: cleanSourceText(item?.summary || item?.description || item?.contentSnippet || "").slice(0, 900),
  }));
  const raw = await resilientRequest("blogWeekly", {
    sessionId,
    messages: [
      { role: "system", content: "You are the repair editor for a premium British AI industry blog. Preserve strong copy. Fix only the listed QA defects. Never invent facts, numbers, dates, entities or quotations. Keep a confident, sceptical, commercially literate Gen-X voice. Return valid JSON only using the same schema as the candidate." },
      { role: "user", content: `Repair attempt ${attempt || 1}.

QA defects:
${defects.map((d) => `- ${d}`).join("\n") || "- Unspecified gate failure"}

Current candidate:
${JSON.stringify(candidate)}

Source evidence:
${JSON.stringify(evidence)}

Make the smallest changes needed to pass. Remove an unsupported claim rather than guessing it.` },
    ],
    max_tokens: 3000,
    temperature: 0.18,
    response_format: process.env.BLOG_WEEKLY_JSON_RESPONSE_FORMAT === "false" ? undefined : { type: "json_object" },
  });
  const parsed = parseStructuredWeeklyPackage(raw);
  return parsed.ok ? normaliseWeeklyPackage(parsed.data, { week, dateLabel, items }) : candidate;
}

async function generateStructuredWeeklyPackage({ sessionId, week, dateLabel, items }) {
  const prompt = buildWeeklyPackagePrompt({ week, dateLabel, items });
  const baseMessages = [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user },
  ];

  let raw = await resilientRequest("blogWeekly", {
    sessionId,
    messages: baseMessages,
    max_tokens: 3000,
    temperature: 0.42,
    response_format: process.env.BLOG_WEEKLY_JSON_RESPONSE_FORMAT === "false" ? undefined : { type: "json_object" },
  });

  let parsed = parseStructuredWeeklyPackage(raw);
  let weeklyPackage = parsed.ok ? normaliseWeeklyPackage(parsed.data, { week, dateLabel, items }) : null;
  let bannedMatches = hasBannedPhrases(JSON.stringify(weeklyPackage || {}));
  let brandCheck = weeklyPackage ? validateWeeklyPackageForBrand(weeklyPackage) : { ok: false, defects: [] };

  if (!parsed.ok || bannedMatches.length || !brandCheck.ok) {
    const repairDefects = [
      ...brandCheck.defects,
      ...(bannedMatches.length ? [`Remove these phrases and close variants: ${bannedMatches.join(", ")}.`] : []),
      parsed.ok ? "" : `Fix invalid JSON: ${parsed.error}`,
    ].filter(Boolean);

    debug("blog.weekly.package.regen", {
      week,
      reason: parsed.ok ? "brand-gate" : "invalid-json",
      bannedMatches: bannedMatches.slice(0, 5),
      defects: repairDefects.slice(0, 8),
      parseError: parsed.ok ? undefined : parsed.error,
    });

    raw = await resilientRequest("blogWeekly", {
      sessionId,
      messages: [
        baseMessages[0],
        {
          role: "user",
          content: `${prompt.user}

Repair instructions:
- Return valid JSON only, using exactly the required top-level keys
- Fix these defects: ${repairDefects.length ? repairDefects.join(" | ") : "press-release filler, hype language, roundup boilerplate"}
- Keep all claims traceable to the supplied source material
- Do not emit HTML, markdown, code fences, notes, or extra keys`,
        },
      ],
      max_tokens: 3000,
      temperature: 0.32,
      response_format: process.env.BLOG_WEEKLY_JSON_RESPONSE_FORMAT === "false" ? undefined : { type: "json_object" },
    });

    parsed = parseStructuredWeeklyPackage(raw);
    weeklyPackage = parsed.ok ? normaliseWeeklyPackage(parsed.data, { week, dateLabel, items }) : null;
    bannedMatches = hasBannedPhrases(JSON.stringify(weeklyPackage || {}));
    brandCheck = weeklyPackage ? validateWeeklyPackageForBrand(weeklyPackage) : { ok: false, defects: [] };
  }

  if (!parsed.ok) {
    warn("blog.weekly.package.parseFallback", { week, error: parsed.error });
    return normaliseWeeklyPackage({}, { week, dateLabel, items });
  }

  if (blogWeeklyQaEnabled()) {
    const qaPrompt = buildWeeklyBrandQaPrompt({ items, generatedJson: weeklyPackage });

    try {
      const qaRaw = await resilientRequest("blogWeekly", {
        sessionId,
        messages: [
          { role: "system", content: qaPrompt.system },
          { role: "user", content: qaPrompt.user },
        ],
        max_tokens: 2600,
        temperature: 0.2,
      });

      const qa = parseWeeklyBrandQaResponse(qaRaw);
      if (qa.ok && qa.pass) {
        debug("blog.weekly.package.qaPass", { week });
      } else if (qa.ok && qa.data) {
        const correctedPackage = normaliseWeeklyPackage(qa.data, { week, dateLabel, items });
        const correctedBannedMatches = hasBannedPhrases(JSON.stringify(correctedPackage || {}));
        const correctedBrandCheck = validateWeeklyPackageForBrand(correctedPackage);

        if (!correctedBannedMatches.length && correctedBrandCheck.defects.length <= brandCheck.defects.length) {
          weeklyPackage = correctedPackage;
          bannedMatches = correctedBannedMatches;
          brandCheck = correctedBrandCheck;
          info("blog.weekly.package.qaCorrected", { week });
        } else {
          warn("blog.weekly.package.qaCorrectionRejected", {
            week,
            bannedMatches: correctedBannedMatches.slice(0, 5),
            defects: correctedBrandCheck.defects.slice(0, 8),
          });
        }
      } else {
        warn("blog.weekly.package.qaUnclear", { week, error: qa.error, feedback: qa.feedback?.slice(0, 500) });
      }
    } catch (qaError) {
      warn("blog.weekly.package.qaFailed", { week, error: qaError?.message || "Unknown QA error" });
    }
  }

  if (bannedMatches.length || !brandCheck.ok) {
    warn("blog.weekly.package.brandResidual", {
      week,
      bannedMatches: bannedMatches.slice(0, 5),
      defects: brandCheck.defects.slice(0, 8),
    });
  }

  return weeklyPackage;
}


export async function buildWeeklyBlogPost({ days, weekId } = {}) {
  const prefix = process.env.BLOG_PREFIX || "blog";
  const rssBucketKey = "rss";
  const feedKey = "feed.json";
  const outBucketKey = "blog";
  const window = buildWeeklyWindow({ now: new Date(), weekId, days });
  const sessionId = `BLOG-${window.week}`;
  const createdAt = new Date().toISOString();

  try {
    info("blog.weekly.build.start", {
      days: window.days,
      week: window.week,
      mode: window.mode,
      dateLabel: window.dateLabel,
      rssBucketKey,
      feedKey,
    });

    const rawFeed = await getObjectAsText(rssBucketKey, feedKey);
    const feed = JSON.parse(rawFeed);
    const items = normaliseFeedItems(feed, window);

    if (!items.length) {
      return {
        ok: false,
        error: `No rewritten RSS items found for ${window.dateLabel}.`,
      };
    }

    const siteShell = await loadSiteShell();

    let weeklyPackage = await generateStructuredWeeklyPackage({
      sessionId,
      week: window.week,
      dateLabel: window.dateLabel,
      items,
    });

    let title = weeklyPackage.title;
    let slug = slugify(`${window.week}-${title}`);
    let dir = `${prefix}/posts/${slug}`;

    let bodyHtml = renderWeeklyBodyHtml(weeklyPackage, { escapeHtml });
    let imagePrompt = buildBlogArtworkPrompt({
      week: window.week,
      title,
      summary: weeklyPackage.summary,
      dominantThemes: weeklyPackage.dominantThemes,
      generatedPrompt: weeklyPackage.imagePrompt,
      date: window.dateLabel,
    });

    const artwork = await resolveBlogArtwork({
      sessionId,
      imagePrompt,
      week: window.week,
      dateLabel: window.dateLabel,
    });
    if (!artwork.imageUrl) {
      return {
        ok: false,
        quarantined: true,
        reason: "artwork-unavailable",
        week: window.week,
        sessionId,
        error: artwork.imageError || "Weekly blog did not produce a verified AI-relevant image.",
      };
    }
    const imageUrl = artwork.imageUrl;

    const { postPath, postUrl, postMetaUrl, postsManifestUrl, blogHubUrl, weeklyArchiveUrl } = buildSiteBlogUrls(slug, prefix);

    const cleanedSources = items.map((item) => ({
      title: item.title,
      link: item.link,
      pubDate: item.pubDateRaw,
    }));

    const gateSources = items.map((item) => ({
      title: item.title,
      link: item.link,
      pubDate: item.pubDateRaw,
      rewritten: item.rewritten,
    }));

    let postEntry = buildPostManifestEntry({
      week: window.week,
      slug,
      title,
      summary: weeklyPackage.summary,
      bodyHtml,
      imageUrl,
      imagePrompt,
      imageStatus: artwork.imageStatus,
      imageError: artwork.imageError,
      dateLabel: window.dateLabel,
      postUrl,
      sources: cleanedSources,
      dominantThemes: weeklyPackage.dominantThemes,
      publishedAt: createdAt,
    });

    let contentHtml = weeklyPostBody({
      title,
      summary: weeklyPackage.summary,
      dateLabel: window.dateLabel,
      imageUrl,
      html: bodyHtml,
      sources: cleanedSources,
    });

    let fullHtml = renderPageWithSiteShell(siteShell, {
      title,
      description: weeklyPackage.summary,
      canonicalUrl: postUrl,
      imageUrl,
      publishedAt: createdAt,
      dateLabel: window.dateLabel,
      contentHtml,
    });

    let publishedObjects = {
      postHtmlKey: `${dir}/index.html`,
      postMetaKey: `${dir}/post.json`,
      manifestKey: `${prefix}/posts.json`,
      rssFeedKey: process.env.BLOG_RSS_OBJECT_KEY || `${prefix}/feed.xml`,
      imageBucketKey: artwork.imageBucketKey,
    };

    let phase4Gate = runPhase4AutonomousContentGate({
      contentType: "weekly-blog",
      generated: weeklyPackage,
      html: fullHtml,
      sources: gateSources,
      expectedSchemaTypes: ["BlogPosting"],
    });

    if (!phase4Gate.ok) {
      const reviewed = await runReviewCouncilGate({
        councilKey: "blog-phase45",
        gate: phase4Gate,
        artifact: weeklyPackage,
        contentType: "weekly-blog",
        repairArtifact: (candidatePackage, { gate, attempt } = {}) => repairWeeklyPackageForCouncil({
          sessionId,
          week: window.week,
          dateLabel: window.dateLabel,
          items: cleanedSources,
          candidate: candidatePackage,
          gate,
          attempt,
        }),
        validate: (candidatePackage) => {
          const candidateBodyHtml = renderWeeklyBodyHtml(candidatePackage, { escapeHtml });
          const candidateFullHtml = renderPageWithSiteShell(siteShell, {
            title: candidatePackage.title,
            description: candidatePackage.summary,
            canonicalUrl: postUrl,
            imageUrl,
            publishedAt: createdAt,
            dateLabel: window.dateLabel,
            contentHtml: weeklyPostBody({
              title: candidatePackage.title,
              summary: candidatePackage.summary,
              dateLabel: window.dateLabel,
              imageUrl,
              html: candidateBodyHtml,
              sources: cleanedSources,
            }),
          });
          return runPhase4AutonomousContentGate({
            contentType: "weekly-blog",
            generated: candidatePackage,
            html: candidateFullHtml,
            sources: gateSources,
            expectedSchemaTypes: ["BlogPosting"],
          });
        },
      });

      if (!reviewed.ok) {
        return await quarantineWeeklyPost({
          gate: reviewed.gate,
          week: window.week,
          weeklyPackage: reviewed.artifact,
          cleanedSources: gateSources,
          publishedObjects,
          context: { dateLabel: window.dateLabel, prefix, slug, postUrl, housekeeping: buildHousekeepingPlan({ lane: "weekly-blog", artefacts: Object.values(publishedObjects).filter(Boolean) }) },
        });
      }

      weeklyPackage = reviewed.artifact;
      title = weeklyPackage.title;
      // Keep the already-resolved URL/slug stable after council repair so manifests,
      // R2 keys and public URLs do not drift mid-run.
      bodyHtml = renderWeeklyBodyHtml(weeklyPackage, { escapeHtml });
      imagePrompt = buildBlogArtworkPrompt({
        week: window.week,
        title,
        summary: weeklyPackage.summary,
        dominantThemes: weeklyPackage.dominantThemes,
        generatedPrompt: weeklyPackage.imagePrompt,
        date: window.dateLabel,
      });
      postEntry = buildPostManifestEntry({
        week: window.week,
        slug,
        title,
        summary: weeklyPackage.summary,
        bodyHtml,
        imageUrl,
        imagePrompt,
        imageStatus: artwork.imageStatus,
        imageError: artwork.imageError,
        dateLabel: window.dateLabel,
        postUrl,
        sources: cleanedSources,
        dominantThemes: weeklyPackage.dominantThemes,
        publishedAt: createdAt,
      });
      contentHtml = weeklyPostBody({
        title,
        summary: weeklyPackage.summary,
        dateLabel: window.dateLabel,
        imageUrl,
        html: bodyHtml,
        sources: cleanedSources,
      });
      fullHtml = renderPageWithSiteShell(siteShell, {
        title,
        description: weeklyPackage.summary,
        canonicalUrl: postUrl,
        imageUrl,
        publishedAt: createdAt,
        dateLabel: window.dateLabel,
        contentHtml,
      });
      publishedObjects = {
        postHtmlKey: `${dir}/index.html`,
        postMetaKey: `${dir}/post.json`,
        manifestKey: `${prefix}/posts.json`,
        rssFeedKey: process.env.BLOG_RSS_OBJECT_KEY || `${prefix}/feed.xml`,
        imageBucketKey: artwork.imageBucketKey,
      };
      phase4Gate = reviewed.gate;
    }

    const existingManifest = await loadExistingPostsManifest(outBucketKey, `${prefix}/posts.json`);
    const mergedManifest = mergePostsManifest(existingManifest, postEntry);

    await putText(outBucketKey, `${dir}/index.html`, fullHtml, "text/html; charset=utf-8");
    await putJson(outBucketKey, `${dir}/post.json`, {
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
    await putJson(outBucketKey, `${prefix}/posts.json`, mergedManifest);

    const publishedManifest = await loadExistingPostsManifest(outBucketKey, `${prefix}/posts.json`);
    const rss = await publishBlogRssFeed({
      manifest: publishedManifest,
      prefix,
    });
    const feedVerification = await verifyPublicBlogRssFeed({
      feedUrl: rss.feedUrl,
      expectedPostUrl: postUrl,
    });

    info("blog.weekly.build.success", {
      week: window.week,
      postUrl,
      postMetaUrl,
      postsManifestUrl,
      rssFeedUrl: rss.feedUrl,
      imageUrl,
      imageStatus: artwork.imageStatus,
      sourceCount: cleanedSources.length,
      themeCount: weeklyPackage.dominantThemes.length,
      publicFeedVerified: feedVerification.ok,
    });

    let rebuild;
    if (feedVerification.ok) {
      rebuild = await triggerWebsiteRebuild();
    } else {
      warn("blog.weekly.rebuild.skipped.unverifiedFeed", {
        week: window.week,
        feedUrl: rss.feedUrl,
        postUrl,
        feedVerification,
      });
      rebuild = {
        ok: false,
        skipped: true,
        reason: "public-rss-verification-failed",
      };
    }

    return {
      ok: true,
      week: window.week,
      days: window.days,
      title,
      slug,
      summary: weeklyPackage.summary,
      postPath,
      postUrl,
      postMetaUrl,
      postsManifestUrl,
      imageUrl,
      imageStatus: artwork.imageStatus,
      imageError: artwork.imageError,
      imageBucketKey: artwork.imageBucketKey,
      blogHubUrl,
      weeklyArchiveUrl,
      rssFeedUrl: rss.feedUrl,
      rss,
      feedVerification,
      phase4Gate,
      publishedObjects: {
        ...publishedObjects,
        rssFeedKey: rss.objectKey,
      },
      rebuild,
    };
  } catch (e) {
    error("blog.weekly.build.fail", { error: e.message, stack: e.stack });
    return { ok: false, error: e.message };
  }
}
