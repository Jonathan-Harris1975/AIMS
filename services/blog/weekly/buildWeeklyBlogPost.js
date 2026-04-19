// services/blog/weekly/buildWeeklyBlogPost.js
import { info, error, debug, warn } from "../../../logger.js";
import { getObjectAsText, putText, putJson } from "../../shared/utils/r2-client.js";
import { resilientRequest } from "../../shared/utils/ai-service.js";
import { slugify } from "../utils/slug.js";
import { pageTemplate, weeklyPostBody } from "../utils/templates.js";
import { createBlogArtwork } from "../../artwork/createBlogArtwork.js";
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

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
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

function buildSiteBlogUrls(slug, prefix = "blog") {
  const siteBaseUrl = String(process.env.SITE_BASE_URL || "https://jonathan-harris.online").replace(/\/$/, "");
  const normalisedPrefix = String(prefix || "blog").replace(/^\/+|\/+$/g, "") || "blog";
  const blogBasePath = `/${normalisedPrefix}`;
  const postPath = `${blogBasePath}/posts/${encodeURIComponent(slug)}/`;

  return {
    siteBaseUrl,
    blogBasePath,
    postPath,
    postUrl: joinUrl(siteBaseUrl, postPath),
    postMetaUrl: joinUrl(siteBaseUrl, `${postPath}post.json`),
    postsManifestUrl: joinUrl(siteBaseUrl, `${blogBasePath}/posts.json`),
    blogHubUrl: joinUrl(siteBaseUrl, `${blogBasePath}/`),
    weeklyArchiveUrl: joinUrl(siteBaseUrl, `${blogBasePath}/weekly/`),
  };
}

async function triggerWebsiteRebuild(context = {}) {
  const primaryHook = String(process.env.WEBSITE_REBUILD_HOOK || "https://hooks.jonathan-harris.online/4q1mkzkfvb566f").trim();
  const fallbackHook = String(process.env.WEBSITE_REBUILD_HOOK_FALLBACK || "").trim();
  const hooks = [primaryHook, fallbackHook].filter(Boolean);

  if (!hooks.length) {
    return { ok: false, skipped: true, reason: "missing-hook-url" };
  }

  let lastError = null;

  for (const hookUrl of hooks) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        info("blog.weekly.rebuild.start", { ...context, hookUrl, attempt });
        const response = await fetch(hookUrl, { method: "POST" });
        const body = await response.text().catch(() => "");
        const result = { ok: response.ok, status: response.status, hookUrl, attempt, body };

        if (response.ok) {
          info("blog.weekly.rebuild.success", {
            ...context,
            hookUrl,
            attempt,
            status: response.status,
          });
          return result;
        }

        lastError = new Error(`non-2xx response ${response.status}`);
        warn("blog.weekly.rebuild.nonOk", {
          ...context,
          hookUrl,
          attempt,
          status: response.status,
          body: body.slice(0, 500),
        });
      } catch (rebuildError) {
        lastError = rebuildError;
        warn("blog.weekly.rebuild.fail", {
          ...context,
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

async function generateStructuredWeeklyPackage({ sessionId, week, dateLabel, items }) {
  const prompt = buildWeeklyPackagePrompt({ week, dateLabel, items });
  const baseMessages = [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user },
  ];

  let raw = await resilientRequest("blogWeekly", {
    sessionId,
    messages: baseMessages,
    max_tokens: 2200,
    temperature: 0.45,
  });

  let parsed = parseStructuredWeeklyPackage(raw);
  let weeklyPackage = parsed.ok ? normaliseWeeklyPackage(parsed.data, { week, dateLabel, items }) : null;
  let bannedMatches = hasBannedPhrases(JSON.stringify(weeklyPackage || {}));

  if (!parsed.ok || bannedMatches.length) {
    debug("blog.weekly.package.regen", {
      week,
      reason: parsed.ok ? "banned-phrases" : "invalid-json",
      bannedMatches: bannedMatches.slice(0, 5),
      parseError: parsed.ok ? undefined : parsed.error,
    });

    raw = await resilientRequest("blogWeekly", {
      sessionId,
      messages: [
        baseMessages[0],
        {
          role: "user",
          content: `${prompt.user}\n\nRepair instructions:\n- Return valid JSON only\n- Remove these phrases and close variants: ${bannedMatches.length ? bannedMatches.join(", ") : "press-release filler, hype language, roundup boilerplate"}\n- Do not emit HTML, markdown, code fences, notes, or extra keys`,
        },
      ],
      max_tokens: 2200,
      temperature: 0.35,
    });

    parsed = parseStructuredWeeklyPackage(raw);
    weeklyPackage = parsed.ok ? normaliseWeeklyPackage(parsed.data, { week, dateLabel, items }) : null;
    bannedMatches = hasBannedPhrases(JSON.stringify(weeklyPackage || {}));
  }

  if (!parsed.ok) {
    warn("blog.weekly.package.parseFallback", { week, error: parsed.error });
    return normaliseWeeklyPackage({}, { week, dateLabel, items });
  }

  if (bannedMatches.length) {
    warn("blog.weekly.package.bannedResidual", { week, bannedMatches: bannedMatches.slice(0, 5) });
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

    const weeklyPackage = await generateStructuredWeeklyPackage({
      sessionId,
      week: window.week,
      dateLabel: window.dateLabel,
      items,
    });

    const title = weeklyPackage.title;
    const slug = slugify(`${window.week}-${title}`);
    const dir = `${prefix}/posts/${slug}`;

    const bodyHtml = renderWeeklyBodyHtml(weeklyPackage, { escapeHtml });
    const imagePrompt = buildBlogArtworkPrompt({
      week: window.week,
      title,
      summary: weeklyPackage.summary,
      dominantThemes: weeklyPackage.dominantThemes,
    });

    const art = await createBlogArtwork({ sessionId, prompt: imagePrompt });
    const imageUrl = art?.ok ? art.publicUrl : "";

    const { postPath, postUrl, postMetaUrl, postsManifestUrl, blogHubUrl, weeklyArchiveUrl } = buildSiteBlogUrls(slug, prefix);

    const cleanedSources = items.map((item) => ({
      title: item.title,
      link: item.link,
      pubDate: item.pubDateRaw,
    }));

    const postEntry = buildPostManifestEntry({
      week: window.week,
      slug,
      title,
      summary: weeklyPackage.summary,
      bodyHtml,
      imageUrl,
      imagePrompt,
      dateLabel: window.dateLabel,
      postUrl,
      sources: cleanedSources,
      dominantThemes: weeklyPackage.dominantThemes,
      publishedAt: createdAt,
    });

    const contentHtml = weeklyPostBody({
      title,
      summary: weeklyPackage.summary,
      dateLabel: window.dateLabel,
      imageUrl,
      html: bodyHtml,
      sources: cleanedSources,
    });

    const fullHtml = pageTemplate({
      title,
      description: weeklyPackage.summary,
      canonicalUrl: postUrl,
      imageUrl,
      publishedAt: createdAt,
      dateLabel: window.dateLabel,
      contentHtml,
    });

    const existingManifest = await loadExistingPostsManifest(outBucketKey, `${prefix}/posts.json`);
    const mergedManifest = mergePostsManifest(existingManifest, postEntry);

    await putText(outBucketKey, `${dir}/index.html`, fullHtml, "text/html; charset=utf-8");
    await putJson(outBucketKey, `${dir}/post.json`, {
      schema_version: 1,
      ok: true,
      ...postEntry,
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


    info("blog.weekly.build.success", {
      week: window.week,
      postPath,
      postUrl,
      postMetaUrl,
      postsManifestUrl,
      imageUrl,
      sourceCount: cleanedSources.length,
      themeCount: weeklyPackage.dominantThemes.length,
    });

    const rebuild = await triggerWebsiteRebuild({ week: window.week, slug, postUrl });

    if (!rebuild.ok) {
      warn("blog.weekly.rebuild.unconfirmed", {
        week: window.week,
        slug,
        postUrl,
        error: rebuild.error || rebuild.reason || "unknown rebuild trigger outcome",
      });
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
      blogHubUrl,
      weeklyArchiveUrl,
      publishedObjects: {
        postHtmlKey: `${dir}/index.html`,
        postMetaKey: `${dir}/post.json`,
        manifestKey: `${prefix}/posts.json`,
      },
      rebuild,
    };
  } catch (e) {
    error("blog.weekly.build.fail", { error: e.message, stack: e.stack });
    return { ok: false, error: e.message };
  }
}
