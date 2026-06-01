import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { publishAuditJson } from "./publishAuditArtifacts.js";

const DEFAULT_VIDEO_PLATFORMS = new Set(["youtube", "tiktok"]);
const DEFAULT_MAX_POSTS = 12;
const DEFAULT_TIMEOUT_MS = 12000;

function trim(value) {
  return String(value || "").trim();
}

function isEnabled(value) {
  return ["1", "true", "yes", "on"].includes(trim(value).toLowerCase());
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function compactText(value = "", max = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function metricScore(row = {}) {
  const metrics = row.metrics || {};
  return Math.max(
    toNumber(metrics.views),
    toNumber(metrics.reach),
    toNumber(metrics.impressions),
  ) + toNumber(metrics.likes) * 25 + toNumber(metrics.comments) * 50 + toNumber(metrics.shares) * 50;
}

function isVideoCandidate(row = {}) {
  const platform = String(row.platform || "").toLowerCase();
  const pipeline = String(row.sourcePipeline || "").toLowerCase();
  const mediaType = String(row.mediaType || "").toLowerCase();
  return Boolean(
    row.url
    && (DEFAULT_VIDEO_PLATFORMS.has(platform) || pipeline.includes("video") || mediaType.includes("video"))
  );
}

function selectThumbnailCandidates(rows = [], limit = DEFAULT_MAX_POSTS) {
  const seen = new Set();
  return [...rows]
    .filter(isVideoCandidate)
    .sort((a, b) => metricScore(b) - metricScore(a))
    .filter((row) => {
      const key = `${row.platform}:${row.url || row.platformPostId || row.postId || row.publishedAt}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(1, Number(limit || DEFAULT_MAX_POSTS)));
}

export function getSocialThumbnailAuditConfig(env = process.env) {
  const enabled = isEnabled(env.ZERNIO_THUMBNAIL_AUDIT_ENABLED);
  const requirePlaywright = isEnabled(env.ZERNIO_THUMBNAIL_AUDIT_REQUIRE_PLAYWRIGHT);
  return {
    enabled,
    requirePlaywright,
    maxPosts: Math.max(1, Math.min(40, toNumber(env.ZERNIO_THUMBNAIL_AUDIT_MAX_POSTS, DEFAULT_MAX_POSTS))),
    timeoutMs: Math.max(3000, toNumber(env.ZERNIO_THUMBNAIL_AUDIT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)),
    waitAfterLoadMs: Math.max(0, Math.min(5000, toNumber(env.ZERNIO_THUMBNAIL_AUDIT_WAIT_MS, 800))),
    userAgent: trim(env.ZERNIO_THUMBNAIL_AUDIT_USER_AGENT)
      || "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    chromiumExecutablePath: trim(env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH),
  };
}

export function getSocialThumbnailAuditStatus(env = process.env) {
  const config = getSocialThumbnailAuditConfig(env);
  return {
    enabled: config.enabled,
    requirePlaywright: config.requirePlaywright,
    maxPosts: config.maxPosts,
    timeoutMs: config.timeoutMs,
    chromiumExecutablePath: config.chromiumExecutablePath || "auto",
  };
}

async function loadPlaywrightChromium() {
  for (const moduleName of ["playwright-core", "playwright"]) {
    try {
      const mod = await import(moduleName);
      if (mod?.chromium) return { chromium: mod.chromium, moduleName };
    } catch {}
  }
  return null;
}

function which(binary) {
  try {
    return execFileSync("which", [binary], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function resolveChromiumExecutable(config = {}) {
  const candidates = [
    config.chromiumExecutablePath,
    process.env.CHROMIUM_PATH,
    process.env.CHROME_BIN,
    which("chromium"),
    which("chromium-browser"),
    which("google-chrome"),
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ].map(trim).filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || "";
}

function absolutiseUrl(value, baseUrl) {
  const raw = trim(value);
  if (!raw) return "";
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return raw;
  }
}

function extractMetaFromHtml(html = "", baseUrl = "") {
  const source = String(html || "");
  const readMeta = (...names) => {
    for (const name of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const patterns = [
        new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
      ];
      for (const pattern of patterns) {
        const match = source.match(pattern);
        if (match?.[1]) return absolutiseUrl(match[1].replace(/&amp;/g, "&"), baseUrl);
      }
    }
    return "";
  };
  const title = source.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || "";
  return {
    title,
    description: readMeta("og:description", "twitter:description", "description"),
    thumbnailUrl: readMeta("og:image", "og:image:url", "twitter:image", "twitter:image:src", "thumbnail", "thumbnailUrl"),
  };
}

async function fetchMetadataFallback(row, config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(row.url, {
      headers: {
        "User-Agent": config.userAgent,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    const html = await response.text();
    const meta = extractMetaFromHtml(html, response.url || row.url);
    return {
      ok: Boolean(meta.thumbnailUrl),
      method: "metadata_fetch",
      status: response.status,
      finalUrl: response.url || row.url,
      ...meta,
      error: meta.thumbnailUrl ? null : "No recognised thumbnail meta tag found.",
    };
  } catch (error) {
    return {
      ok: false,
      method: "metadata_fetch",
      status: null,
      finalUrl: row.url,
      title: "",
      description: "",
      thumbnailUrl: "",
      error: error?.message || String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMetadataWithPlaywright(browser, row, config) {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844, isMobile: true },
    userAgent: config.userAgent,
  });
  try {
    await page.goto(row.url, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    if (config.waitAfterLoadMs) await page.waitForTimeout(config.waitAfterLoadMs);
    const meta = await page.evaluate(() => {
      const read = (...selectors) => {
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          const value = element?.getAttribute("content") || element?.getAttribute("href") || "";
          if (value.trim()) return value.trim();
        }
        return "";
      };
      return {
        title: document.title || "",
        description: read('meta[property="og:description"]', 'meta[name="twitter:description"]', 'meta[name="description"]'),
        thumbnailUrl: read('meta[property="og:image"]', 'meta[property="og:image:url"]', 'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]', 'link[rel="image_src"]'),
        finalUrl: location.href,
      };
    });
    return {
      ok: Boolean(meta.thumbnailUrl),
      method: "playwright_meta",
      status: null,
      finalUrl: meta.finalUrl || row.url,
      title: meta.title || "",
      description: meta.description || "",
      thumbnailUrl: absolutiseUrl(meta.thumbnailUrl || "", meta.finalUrl || row.url),
      error: meta.thumbnailUrl ? null : "No recognised thumbnail meta tag found after rendered load.",
    };
  } catch (error) {
    return {
      ok: false,
      method: "playwright_meta",
      status: null,
      finalUrl: row.url,
      title: "",
      description: "",
      thumbnailUrl: "",
      error: error?.message || String(error),
    };
  } finally {
    await page.close().catch(() => {});
  }
}

function compactCandidate(row) {
  return {
    platform: row.platform,
    contentLane: row.contentLane,
    sourcePipeline: row.sourcePipeline,
    publishedAt: row.publishedAt,
    postId: row.postId,
    platformPostId: row.platformPostId,
    url: row.url,
    contentPreview: compactText(row.contentPreview || row.content || ""),
    metrics: row.metrics || {},
  };
}

export async function auditShortsThumbnails({ rows = [], reportPrefix = "" } = {}) {
  const config = getSocialThumbnailAuditConfig();
  if (!config.enabled) {
    return {
      enabled: false,
      reason: "Set ZERNIO_THUMBNAIL_AUDIT_ENABLED=true to collect rendered short thumbnail evidence.",
      candidates: 0,
      results: [],
    };
  }

  const candidates = selectThumbnailCandidates(rows, config.maxPosts);
  if (!candidates.length) {
    return {
      enabled: true,
      reason: "No video/short rows with public platform URLs were available in this Zernio response.",
      candidates: 0,
      results: [],
    };
  }

  const playwright = await loadPlaywrightChromium();
  const executablePath = resolveChromiumExecutable(config);
  const canUsePlaywright = Boolean(playwright?.chromium && executablePath);
  if (config.requirePlaywright && !canUsePlaywright) {
    const result = {
      enabled: true,
      mode: "playwright_required_unavailable",
      reason: "Playwright thumbnail audit is enabled but playwright-core/playwright or a Chromium executable was not available.",
      candidates: candidates.length,
      results: candidates.map((row) => ({ post: compactCandidate(row), ok: false, error: "Playwright/Chromium unavailable" })),
    };
    if (reportPrefix) {
      const published = await publishAuditJson({ key: `${reportPrefix}/thumbnail-audit.json`, payload: result });
      result.artefact = published;
    }
    return result;
  }

  let browser = null;
  const results = [];
  try {
    if (canUsePlaywright) {
      browser = await playwright.chromium.launch({
        executablePath,
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      });
    }

    for (const row of candidates) {
      const evidence = browser
        ? await fetchMetadataWithPlaywright(browser, row, config)
        : await fetchMetadataFallback(row, config);
      results.push({ post: compactCandidate(row), ...evidence });
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  const result = {
    enabled: true,
    mode: browser ? "playwright" : "metadata_fetch_fallback",
    playwrightModule: playwright?.moduleName || null,
    chromiumExecutablePath: executablePath || null,
    candidates: candidates.length,
    summary: {
      checked: results.length,
      thumbnailsFound: results.filter((item) => item.ok && item.thumbnailUrl).length,
      missingThumbnails: results.filter((item) => !item.ok || !item.thumbnailUrl).length,
    },
    results,
  };

  if (reportPrefix) {
    const published = await publishAuditJson({ key: `${reportPrefix}/thumbnail-audit.json`, payload: result });
    result.artefact = published;
  }

  return result;
}

export default {
  getSocialThumbnailAuditStatus,
  auditShortsThumbnails,
};
