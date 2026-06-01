import crypto from "node:crypto";
import { buildAuditPrefix } from "./auditPaths.js";
import { publishAuditJson, publishAuditLatest, publishAuditText } from "./publishAuditArtifacts.js";
import { auditShortsThumbnails, getSocialThumbnailAuditStatus } from "./socialThumbnailAudit.js";

const AUDIT_TYPE = "social-performance";
const DEFAULT_BASE_URL = "https://zernio.com/api/v1";
const DEFAULT_META_PLATFORMS = ["facebook", "instagram"];
const DEFAULT_VIDEO_PLATFORMS = ["youtube", "tiktok"];
const METRIC_KEYS = [
  "impressions",
  "reach",
  "likes",
  "comments",
  "shares",
  "saves",
  "clicks",
  "views",
  "igReelsAvgWatchTime",
  "igReelsVideoViewTotalTime",
];

function trim(value) {
  return String(value || "").trim();
}

function trimSlash(value) {
  return trim(value).replace(/\/+$/, "");
}

function parseCsv(value, fallback = []) {
  const items = trim(value)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return items.length ? [...new Set(items)] : fallback;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function safeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function defaultPreviousCalendarMonth(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { fromDate: isoDate(start), toDate: isoDate(end) };
}

function normaliseDateRange(options = {}) {
  const fallback = defaultPreviousCalendarMonth();
  const fromDate = trim(options.fromDate || options.startDate || process.env.ZERNIO_REPORT_FROM_DATE) || fallback.fromDate;
  const toDate = trim(options.toDate || options.endDate || process.env.ZERNIO_REPORT_TO_DATE) || fallback.toDate;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
    throw new Error("fromDate/startDate must use YYYY-MM-DD format");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    throw new Error("toDate/endDate must use YYYY-MM-DD format");
  }
  if (fromDate > toDate) {
    throw new Error("fromDate/startDate must be before or equal to toDate/endDate");
  }

  return { fromDate, toDate };
}

function resolveKey(...names) {
  for (const name of names) {
    const value = trim(process.env[name]);
    if (value) return { name, value };
  }
  return { name: names[0], value: "" };
}

export function getZernioSocialPerformanceConfig(env = process.env) {
  const metaKey = resolveKey(
    "ZERNIO_META_API_KEY",
    "ZERNIO_FB_IG_API_KEY",
    "ZERNIO_FACEBOOK_INSTAGRAM_API_KEY"
  );
  const videoKey = resolveKey(
    "ZERNIO_VIDEO_API_KEY",
    "ZERNIO_YT_TIKTOK_API_KEY",
    "ZERNIO_YOUTUBE_TIKTOK_API_KEY"
  );

  return {
    auditType: AUDIT_TYPE,
    baseUrl: trimSlash(env.ZERNIO_API_BASE_URL || DEFAULT_BASE_URL),
    source: trim(env.ZERNIO_ANALYTICS_SOURCE || "all").toLowerCase(),
    pageSize: Math.min(Math.max(Number(env.ZERNIO_ANALYTICS_PAGE_SIZE || 100), 1), 100),
    maxPages: Math.max(Number(env.ZERNIO_ANALYTICS_MAX_PAGES || 12), 1),
    timeoutMs: Math.max(Number(env.ZERNIO_ANALYTICS_TIMEOUT_MS || 20000), 1000),
    reportName: trim(env.ZERNIO_REPORT_NAME || "Jonathan Harris Monthly Social Performance Report"),
    accounts: [
      {
        id: "meta",
        label: "Facebook + Instagram",
        apiKeyEnv: metaKey.name,
        apiKey: metaKey.value,
        platforms: parseCsv(env.ZERNIO_META_PLATFORMS, DEFAULT_META_PLATFORMS),
      },
      {
        id: "video",
        label: "YouTube + TikTok",
        apiKeyEnv: videoKey.name,
        apiKey: videoKey.value,
        platforms: parseCsv(env.ZERNIO_VIDEO_PLATFORMS, DEFAULT_VIDEO_PLATFORMS),
      },
    ],
  };
}

export function getZernioConfigStatus(env = process.env) {
  const config = getZernioSocialPerformanceConfig(env);
  const accounts = config.accounts.map((account) => ({
    id: account.id,
    label: account.label,
    apiKeyEnv: account.apiKeyEnv,
    configured: Boolean(account.apiKey),
    platforms: account.platforms,
  }));
  return {
    ok: accounts.every((account) => account.configured),
    auditType: AUDIT_TYPE,
    baseUrl: config.baseUrl,
    source: config.source,
    pageSize: config.pageSize,
    maxPages: config.maxPages,
    accounts,
    thumbnailAudit: getSocialThumbnailAuditStatus(env),
  };
}

function extractRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["data", "items", "posts", "results", "analytics", "records"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  if (payload.postId || payload.platformAnalytics || payload.analytics) return [payload];
  return [];
}

function hasNextPage(payload, records, page, limit) {
  if (!payload || typeof payload !== "object") return records.length >= limit;
  const pagination = payload.pagination || payload.meta || {};
  if (typeof payload.hasMore === "boolean") return payload.hasMore;
  if (typeof pagination.hasMore === "boolean") return pagination.hasMore;
  if (pagination.totalPages && page < Number(pagination.totalPages)) return true;
  if (pagination.nextPage || payload.nextPage) return true;
  return records.length >= limit;
}

async function fetchJsonWithTimeout(url, { apiKey, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }

    if (!response.ok) {
      const message = payload?.error || payload?.message || response.statusText || "Zernio request failed";
      const error = new Error(`${response.status} ${message}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload || {};
  } finally {
    clearTimeout(timer);
  }
}

function buildAnalyticsUrl(config, { platform, fromDate, toDate, page }) {
  const url = new URL(`${config.baseUrl}/analytics`);
  url.searchParams.set("platform", platform);
  url.searchParams.set("fromDate", fromDate);
  url.searchParams.set("toDate", toDate);
  url.searchParams.set("source", config.source || "all");
  url.searchParams.set("limit", String(config.pageSize));
  url.searchParams.set("page", String(page));
  url.searchParams.set("sortBy", "date");
  url.searchParams.set("order", "desc");
  return url;
}

async function fetchPlatformAnalytics(config, account, platform, dateRange) {
  const records = [];
  const errors = [];
  for (let page = 1; page <= config.maxPages; page += 1) {
    try {
      const url = buildAnalyticsUrl(config, { ...dateRange, platform, page });
      const payload = await fetchJsonWithTimeout(url, { apiKey: account.apiKey, timeoutMs: config.timeoutMs });
      const pageRecords = extractRecords(payload);
      records.push(...pageRecords);
      if (!hasNextPage(payload, pageRecords, page, config.pageSize)) break;
    } catch (error) {
      errors.push({ platform, page, status: error.status || null, message: error.message });
      break;
    }
  }

  return { platform, accountId: account.id, accountLabel: account.label, records, errors };
}

async function collectZernioAnalytics(config, dateRange) {
  const configuredAccounts = config.accounts.filter((account) => account.apiKey);
  const missingAccounts = config.accounts
    .filter((account) => !account.apiKey)
    .map((account) => ({ id: account.id, label: account.label, apiKeyEnv: account.apiKeyEnv }));

  if (!configuredAccounts.length) {
    throw new Error("No Zernio API keys are configured. Set ZERNIO_META_API_KEY and ZERNIO_VIDEO_API_KEY.");
  }

  const collections = [];
  for (const account of configuredAccounts) {
    for (const platform of account.platforms) {
      collections.push(await fetchPlatformAnalytics(config, account, platform, dateRange));
    }
  }

  return { collections, missingAccounts };
}

function metricsFromRecord(record = {}) {
  const base = record.analytics && typeof record.analytics === "object" ? record.analytics : {};
  const out = {};
  for (const key of METRIC_KEYS) out[key] = toNumber(base[key]);
  out.engagementRate = toNumber(base.engagementRate);
  return out;
}

function flattenRecord(record, context) {
  const platformRows = Array.isArray(record.platformAnalytics) && record.platformAnalytics.length
    ? record.platformAnalytics
    : [
        {
          platform: record.platform || context.platform,
          accountId: record.accountId || null,
          accountUsername: record.accountUsername || null,
          platformPostId: record.platformPostId || null,
          platformPostUrl: record.platformPostUrl || null,
          analytics: record.analytics || {},
          syncStatus: record.syncStatus || null,
          status: record.status || null,
          errorMessage: record.errorMessage || null,
        },
      ];

  return platformRows.map((row) => {
    const merged = { ...record, ...row, analytics: row.analytics || record.analytics || {} };
    const metrics = metricsFromRecord(merged);
    const publishedAt = merged.publishedAt || merged.scheduledFor || null;
    const content = trim(record.content || record.message || "");
    return {
      accountGroup: context.accountId,
      accountLabel: context.accountLabel,
      platform: String(row.platform || record.platform || context.platform || "unknown").toLowerCase(),
      accountId: row.accountId || null,
      accountUsername: row.accountUsername || null,
      postId: record.postId || record._id || record.id || null,
      platformPostId: row.platformPostId || record.platformPostId || null,
      platformPostUrl: row.platformPostUrl || record.platformPostUrl || null,
      status: row.status || record.status || null,
      syncStatus: row.syncStatus || record.syncStatus || null,
      isExternal: Boolean(record.isExternal),
      sourcePipeline: inferSourcePipeline({ platform: row.platform || context.platform, mediaType: record.mediaType, content }),
      contentLane: inferContentLane(content),
      mediaType: record.mediaType || null,
      publishedAt,
      content,
      metrics,
      errorMessage: row.errorMessage || record.errorMessage || null,
    };
  });
}

function inferSourcePipeline({ platform, mediaType, content }) {
  const text = content.toLowerCase();
  const plat = String(platform || "").toLowerCase();
  const type = String(mediaType || "").toLowerCase();
  if (["youtube", "tiktok"].includes(plat) || type.includes("video")) return "blotato_or_video";
  if (/\b(book|ebook|kindle|amazon|catalogue|readers?)\b/.test(text)) return "oneup_ebook_or_static";
  if (/\bquiz\b/.test(text)) return "oneup_quiz";
  if (/\bnewsletter\b/.test(text)) return "newsletter_cta";
  return "oneup_or_manual_social";
}

function inferContentLane(content = "") {
  const text = content.toLowerCase();
  if (/\bebook|book|kindle|amazon\b/.test(text)) return "ebook";
  if (/\bquiz\b/.test(text)) return "quiz";
  if (/\breality check\b/.test(text)) return "reality-check";
  if (/\bplaybook\b/.test(text)) return "ai-playbook";
  if (/\bwork\b/.test(text)) return "ai-at-work";
  if (/\bmodel\b/.test(text)) return "model-verdict";
  if (/\bnews|regulator|launch|study|report\b/.test(text)) return "news-insight";
  return "unclassified";
}

function emptyMetrics() {
  return Object.fromEntries([...METRIC_KEYS, "engagements", "engagementRateAvg"].map((key) => [key, 0]));
}

function addMetrics(target, metrics) {
  for (const key of METRIC_KEYS) target[key] += toNumber(metrics[key]);
  target.engagements += toNumber(metrics.likes) + toNumber(metrics.comments) + toNumber(metrics.shares) + toNumber(metrics.saves) + toNumber(metrics.clicks);
}

function engagementDenominator(metrics) {
  return toNumber(metrics.reach) || toNumber(metrics.impressions) || toNumber(metrics.views) || 0;
}

function calculatedEngagementRate(metrics) {
  const explicit = toNumber(metrics.engagementRate);
  if (explicit > 0) return explicit;
  const denominator = engagementDenominator(metrics);
  if (!denominator) return 0;
  const engagements = toNumber(metrics.likes) + toNumber(metrics.comments) + toNumber(metrics.shares) + toNumber(metrics.saves) + toNumber(metrics.clicks);
  return Number(((engagements / denominator) * 100).toFixed(2));
}

function aggregateBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) {
      map.set(key, { key, posts: 0, metrics: emptyMetrics(), platforms: new Set(), lanes: new Set() });
    }
    const entry = map.get(key);
    entry.posts += 1;
    entry.platforms.add(row.platform);
    entry.lanes.add(row.contentLane);
    addMetrics(entry.metrics, row.metrics);
    entry.metrics.engagementRateAvg += calculatedEngagementRate(row.metrics);
  }
  return [...map.values()].map((entry) => ({
    ...entry,
    platforms: [...entry.platforms].sort(),
    lanes: [...entry.lanes].sort(),
    metrics: {
      ...entry.metrics,
      engagementRateAvg: entry.posts ? Number((entry.metrics.engagementRateAvg / entry.posts).toFixed(2)) : 0,
    },
  }));
}

function compactPost(row) {
  return {
    platform: row.platform,
    accountGroup: row.accountGroup,
    contentLane: row.contentLane,
    sourcePipeline: row.sourcePipeline,
    publishedAt: row.publishedAt,
    postId: row.postId,
    platformPostId: row.platformPostId,
    url: row.platformPostUrl,
    contentPreview: row.content ? `${row.content.slice(0, 180)}${row.content.length > 180 ? "…" : ""}` : "",
    metrics: {
      impressions: toNumber(row.metrics.impressions),
      reach: toNumber(row.metrics.reach),
      views: toNumber(row.metrics.views),
      likes: toNumber(row.metrics.likes),
      comments: toNumber(row.metrics.comments),
      shares: toNumber(row.metrics.shares),
      saves: toNumber(row.metrics.saves),
      clicks: toNumber(row.metrics.clicks),
      engagementRate: calculatedEngagementRate(row.metrics),
    },
  };
}

function rankRows(rows, metricFn, limit = 10) {
  return [...rows]
    .sort((a, b) => metricFn(b) - metricFn(a))
    .slice(0, limit)
    .map(compactPost);
}

function buildRecommendations({ byPlatform, byLane, rows }) {
  const recommendations = [];
  const rankedPlatforms = [...byPlatform].sort((a, b) => b.metrics.engagementRateAvg - a.metrics.engagementRateAvg);
  const rankedLanes = [...byLane].sort((a, b) => b.metrics.engagementRateAvg - a.metrics.engagementRateAvg);
  const bestPlatform = rankedPlatforms[0];
  const weakestPlatform = rankedPlatforms[rankedPlatforms.length - 1];
  const bestLane = rankedLanes[0];

  if (bestPlatform) {
    recommendations.push({
      priority: "observe_and_amplify",
      title: `Lean into ${bestPlatform.key} formats that already show engagement`,
      detail: `${bestPlatform.key} has the strongest average engagement rate in this window. Use it as the first reference point for hook and CTA tuning.`,
    });
  }

  if (weakestPlatform && bestPlatform && weakestPlatform.key !== bestPlatform.key) {
    recommendations.push({
      priority: "platform_tuning",
      title: `Review ${weakestPlatform.key} creative packaging`,
      detail: `${weakestPlatform.key} is the weakest platform by average engagement rate. Compare post format, opening line, caption length, and CTA against ${bestPlatform.key}.`,
    });
  }

  if (bestLane && bestLane.key !== "unclassified") {
    recommendations.push({
      priority: "content_lane_weighting",
      title: `Give ${bestLane.key} slightly more testing weight`,
      detail: `${bestLane.key} is the strongest detected lane this month. Use the signal for future OneUp/Blotato prompt tuning rather than immediate automation changes.`,
    });
  }

  if (rows.some((row) => row.contentLane === "unclassified")) {
    recommendations.push({
      priority: "tracking_hygiene",
      title: "Add content-lane markers to generated captions",
      detail: "Some posts could not be classified from the text alone. Add lightweight hidden/internal metadata in AIMS logs so future reports can separate OneUp ebooks, quiz posts, Blotato lanes, and manual posts cleanly.",
    });
  }

  return recommendations;
}

function buildSocialPerformanceSummary({ collections, missingAccounts, dateRange, config }) {
  const rows = collections.flatMap((collection) =>
    collection.records.flatMap((record) => flattenRecord(record, collection))
  );
  const collectionErrors = collections.flatMap((collection) => collection.errors || []);
  const totals = { posts: rows.length, metrics: emptyMetrics() };
  for (const row of rows) addMetrics(totals.metrics, row.metrics);
  totals.metrics.engagementRateAvg = rows.length
    ? Number((rows.reduce((sum, row) => sum + calculatedEngagementRate(row.metrics), 0) / rows.length).toFixed(2))
    : 0;

  const byPlatform = aggregateBy(rows, (row) => row.platform).sort((a, b) => a.key.localeCompare(b.key));
  const bySourcePipeline = aggregateBy(rows, (row) => row.sourcePipeline).sort((a, b) => a.key.localeCompare(b.key));
  const byLane = aggregateBy(rows, (row) => row.contentLane).sort((a, b) => a.key.localeCompare(b.key));
  const byAccountGroup = aggregateBy(rows, (row) => row.accountGroup).sort((a, b) => a.key.localeCompare(b.key));

  return {
    reportName: config.reportName,
    auditType: AUDIT_TYPE,
    generatedAt: new Date().toISOString(),
    period: dateRange,
    cadence: "monthly",
    storage: "R2 audits bucket",
    ramsPolicy: {
      shouldTriggerRams: false,
      automationReadiness: "analysis_only",
      reason: "Zernio reports are performance intelligence for AIMS prompt and schedule tuning, not repo patch instructions.",
    },
    config: {
      source: config.source,
      pageSize: config.pageSize,
      maxPages: config.maxPages,
      accounts: config.accounts.map((account) => ({
        id: account.id,
        label: account.label,
        apiKeyEnv: account.apiKeyEnv,
        configured: Boolean(account.apiKey),
        platforms: account.platforms,
      })),
    },
    thumbnailAudit: null,
    coverage: {
      configuredAccounts: config.accounts.filter((account) => account.apiKey).length,
      missingAccounts,
      platformCollections: collections.map((collection) => ({
        accountGroup: collection.accountId,
        accountLabel: collection.accountLabel,
        platform: collection.platform,
        records: collection.records.length,
        errors: collection.errors || [],
      })),
      errors: collectionErrors,
    },
    totals,
    byAccountGroup,
    byPlatform,
    bySourcePipeline,
    byLane,
    topPosts: rankRows(rows, (row) =>
      calculatedEngagementRate(row.metrics) + toNumber(row.metrics.views) / 1000 + toNumber(row.metrics.impressions) / 1000,
    10),
    topReachOrViews: rankRows(rows, (row) => Math.max(toNumber(row.metrics.reach), toNumber(row.metrics.views), toNumber(row.metrics.impressions)), 10),
    topClicks: rankRows(rows, (row) => toNumber(row.metrics.clicks), 10),
    lowSignalPosts: rows
      .filter((row) => engagementDenominator(row.metrics) > 0)
      .sort((a, b) => calculatedEngagementRate(a.metrics) - calculatedEngagementRate(b.metrics))
      .slice(0, 10)
      .map(compactPost),
    recommendations: buildRecommendations({ byPlatform, byLane, rows }),
    rawRows: rows.map(compactPost),
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-GB").format(toNumber(value));
}

function metricCells(metrics = {}) {
  return [
    formatNumber(metrics.impressions),
    formatNumber(metrics.reach),
    formatNumber(metrics.views),
    formatNumber(metrics.likes),
    formatNumber(metrics.comments),
    formatNumber(metrics.shares),
    formatNumber(metrics.saves),
    formatNumber(metrics.clicks),
    `${toNumber(metrics.engagementRateAvg ?? metrics.engagementRate).toFixed(2)}%`,
  ].map((value) => `<td>${escapeHtml(value)}</td>`).join("");
}

function aggregateRows(rows = []) {
  if (!rows.length) return `<tr><td colspan="10">No data returned for this period.</td></tr>`;
  return rows.map((row) => `<tr><td><code>${escapeHtml(row.key)}</code></td><td>${formatNumber(row.posts)}</td>${metricCells(row.metrics)}</tr>`).join("\n");
}

function postRows(rows = []) {
  if (!rows.length) return `<tr><td colspan="8">No matching posts returned for this period.</td></tr>`;
  return rows.map((row) => `<tr><td>${escapeHtml(row.platform)}</td><td>${escapeHtml(row.contentLane)}</td><td>${escapeHtml(row.sourcePipeline)}</td><td>${escapeHtml(row.publishedAt || "")}</td><td>${escapeHtml(row.contentPreview)}</td><td>${formatNumber(Math.max(row.metrics.reach, row.metrics.views, row.metrics.impressions))}</td><td>${formatNumber(row.metrics.clicks)}</td><td>${toNumber(row.metrics.engagementRate).toFixed(2)}%</td></tr>`).join("\n");
}

function thumbnailAuditRows(audit = {}) {
  const results = Array.isArray(audit.results) ? audit.results : [];
  if (!audit.enabled) return `<p><span class="pill warn">disabled</span> ${escapeHtml(audit.reason || "Thumbnail evidence collection is disabled.")}</p>`;
  if (!results.length) return `<p><span class="pill warn">no candidates</span> ${escapeHtml(audit.reason || "No short/video post URLs were available for thumbnail checks.")}</p>`;
  return `<table><thead><tr><th>Platform</th><th>Lane</th><th>Post</th><th>Thumbnail evidence</th><th>Status</th></tr></thead><tbody>${results.map((item) => {
    const post = item.post || {};
    const thumb = item.thumbnailUrl
      ? `<a href="${escapeHtml(item.thumbnailUrl)}"><img src="${escapeHtml(item.thumbnailUrl)}" alt="Short thumbnail evidence" loading="lazy" style="max-width:160px;border-radius:10px;border:1px solid #e5e7eb"></a><br><code>${escapeHtml(item.method || "")}</code>`
      : `<span>${escapeHtml(item.error || "No thumbnail URL found")}</span><br><code>${escapeHtml(item.method || "")}</code>`;
    const status = item.ok ? '<span class="pill ok">found</span>' : '<span class="pill warn">missing</span>';
    return `<tr><td>${escapeHtml(post.platform || "")}</td><td>${escapeHtml(post.contentLane || "")}</td><td><a href="${escapeHtml(post.url || "#")}">${escapeHtml(post.contentPreview || post.platformPostId || post.postId || "open post")}</a></td><td>${thumb}</td><td>${status}</td></tr>`;
  }).join("\n")}</tbody></table>`;
}

export function renderSocialPerformanceHtml(report) {
  const generatedAt = escapeHtml(report.generatedAt);
  const title = escapeHtml(report.reportName || "Monthly Social Performance Report");
  const period = `${escapeHtml(report.period.fromDate)} to ${escapeHtml(report.period.toDate)}`;
  const errorCount = report.coverage.errors.length;
  const recommendations = report.recommendations.length
    ? report.recommendations.map((item) => `<li><strong>${escapeHtml(item.title)}</strong><br><span>${escapeHtml(item.detail)}</span></li>`).join("\n")
    : "<li>No recommendations generated because no analytics rows were returned.</li>";

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;margin:0;background:#f4f7fb;color:#111827;line-height:1.55}header{background:#0d1420;color:#fff;padding:28px 24px}main{max-width:1180px;margin:0 auto;padding:32px 20px 64px}section{background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:22px;margin:18px 0;box-shadow:0 12px 30px rgba(13,20,32,.06)}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid #e5e7eb;padding:9px 7px;text-align:left;vertical-align:top}th{background:#f8fafc}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}.kpi{background:#0d1420;color:#fff;border-radius:16px;padding:16px}.kpi strong{font-size:24px;display:block}code{background:#f3f4f6;border-radius:6px;padding:2px 5px}.pill{display:inline-block;border-radius:999px;padding:5px 10px;background:#eef2ff;color:#4338ca;font-weight:700;font-size:12px}.warn{background:#fef3c7;color:#92400e}.ok{background:#dcfce7;color:#166534}li{margin:.5rem 0}span{color:#4b5563}img{background:#f8fafc;object-fit:cover}@media print{section{break-inside:avoid;page-break-inside:avoid}}
</style>
</head>
<body>
<header><h1>${title}</h1><p>Generated ${generatedAt} · Period ${period}</p></header>
<main>
<section><h2>Control block</h2><p><span class="pill ok">analysis only</span> <span class="pill">monthly</span> <span class="pill">R2 audits bucket</span> ${errorCount ? `<span class="pill warn">${errorCount} collection issue(s)</span>` : ""}</p><p>${escapeHtml(report.ramsPolicy.reason)}</p></section>
<section><h2>Executive metrics</h2><div class="grid"><div class="kpi"><span>Posts analysed</span><strong>${formatNumber(report.totals.posts)}</strong></div><div class="kpi"><span>Impressions</span><strong>${formatNumber(report.totals.metrics.impressions)}</strong></div><div class="kpi"><span>Reach</span><strong>${formatNumber(report.totals.metrics.reach)}</strong></div><div class="kpi"><span>Views</span><strong>${formatNumber(report.totals.metrics.views)}</strong></div><div class="kpi"><span>Clicks</span><strong>${formatNumber(report.totals.metrics.clicks)}</strong></div><div class="kpi"><span>Avg engagement</span><strong>${toNumber(report.totals.metrics.engagementRateAvg).toFixed(2)}%</strong></div></div></section>
<section><h2>Recommendations</h2><ol>${recommendations}</ol></section>
<section><h2>Shorts thumbnail evidence</h2>${thumbnailAuditRows(report.thumbnailAudit || {})}</section>
<section><h2>Performance by platform</h2><table><thead><tr><th>Platform</th><th>Posts</th><th>Impressions</th><th>Reach</th><th>Views</th><th>Likes</th><th>Comments</th><th>Shares</th><th>Saves</th><th>Clicks</th><th>Avg engagement</th></tr></thead><tbody>${aggregateRows(report.byPlatform)}</tbody></table></section>
<section><h2>Performance by source pipeline</h2><table><thead><tr><th>Pipeline</th><th>Posts</th><th>Impressions</th><th>Reach</th><th>Views</th><th>Likes</th><th>Comments</th><th>Shares</th><th>Saves</th><th>Clicks</th><th>Avg engagement</th></tr></thead><tbody>${aggregateRows(report.bySourcePipeline)}</tbody></table></section>
<section><h2>Performance by content lane</h2><table><thead><tr><th>Lane</th><th>Posts</th><th>Impressions</th><th>Reach</th><th>Views</th><th>Likes</th><th>Comments</th><th>Shares</th><th>Saves</th><th>Clicks</th><th>Avg engagement</th></tr></thead><tbody>${aggregateRows(report.byLane)}</tbody></table></section>
<section><h2>Top posts</h2><table><thead><tr><th>Platform</th><th>Lane</th><th>Pipeline</th><th>Published</th><th>Content</th><th>Reach/views</th><th>Clicks</th><th>Engagement</th></tr></thead><tbody>${postRows(report.topPosts)}</tbody></table></section>
<section><h2>Coverage</h2><pre>${escapeHtml(JSON.stringify(report.coverage, null, 2))}</pre></section>
</main>
</body>
</html>`;
}

export async function runZernioSocialPerformanceReport(options = {}) {
  const config = getZernioSocialPerformanceConfig();
  const dateRange = normaliseDateRange(options);
  const sessionId = trim(options.sessionId) || `zernio-${crypto.randomUUID()}`;
  const reportPrefix = buildAuditPrefix(AUDIT_TYPE, sessionId);
  const collected = await collectZernioAnalytics(config, dateRange);
  const report = buildSocialPerformanceSummary({ ...collected, dateRange, config });
  report.thumbnailAudit = await auditShortsThumbnails({ rows: report.rawRows, reportPrefix });
  const html = renderSocialPerformanceHtml(report);

  const reportJson = await publishAuditJson({ key: `${reportPrefix}/report.json`, payload: report });
  const summaryJson = await publishAuditJson({
    key: `${reportPrefix}/summary.json`,
    payload: {
      auditType: AUDIT_TYPE,
      sessionId,
      generatedAt: report.generatedAt,
      period: report.period,
      totals: report.totals,
      byPlatform: report.byPlatform,
      bySourcePipeline: report.bySourcePipeline,
      byLane: report.byLane,
      recommendations: report.recommendations,
      thumbnailAudit: report.thumbnailAudit ? {
        enabled: report.thumbnailAudit.enabled,
        mode: report.thumbnailAudit.mode || null,
        summary: report.thumbnailAudit.summary || null,
        artefact: report.thumbnailAudit.artefact || null,
      } : null,
      ramsPolicy: report.ramsPolicy,
    },
  });
  const reportHtml = await publishAuditText({
    key: `${reportPrefix}/report.html`,
    text: html,
    contentType: "text/html; charset=utf-8",
  });
  const latest = await publishAuditLatest({
    auditType: AUDIT_TYPE,
    sessionId,
    payload: {
      reportPrefix,
      reportUrl: reportHtml.url,
      reportJsonUrl: reportJson.url,
      summaryUrl: summaryJson.url,
      period: report.period,
      totals: report.totals,
      thumbnailAudit: report.thumbnailAudit ? {
        enabled: report.thumbnailAudit.enabled,
        mode: report.thumbnailAudit.mode || null,
        summary: report.thumbnailAudit.summary || null,
        artefact: report.thumbnailAudit.artefact || null,
      } : null,
      ramsPolicy: report.ramsPolicy,
    },
  });

  let council = null;
  const runCouncil = options.runCouncil === true
    || String(process.env.BRAND_SOCIAL_COUNCIL_RUN_AFTER_SOCIAL || "").trim().toLowerCase() === "true";
  if (runCouncil) {
    const { runBrandSocialCouncilReport } = await import("./brandSocialCouncil.js");
    council = await runBrandSocialCouncilReport({
      sessionId: `brand-social-council-after-${sessionId}`,
      sourceTrigger: "social-performance",
    });
  }

  return {
    ok: true,
    auditType: AUDIT_TYPE,
    sessionId,
    reportPrefix,
    period: report.period,
    reportUrl: reportHtml.url,
    reportJsonUrl: reportJson.url,
    summaryUrl: summaryJson.url,
    latestUrl: latest.url,
    totals: report.totals,
    recommendations: report.recommendations,
    ramsPolicy: report.ramsPolicy,
    council,
  };
}

export default {
  getZernioConfigStatus,
  runZernioSocialPerformanceReport,
  renderSocialPerformanceHtml,
};
