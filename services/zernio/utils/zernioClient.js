// Zernio REST API client (https://docs.zernio.com/).
//
// Base URL: https://zernio.com/api/v1
// Auth: Authorization: Bearer <ZERNIO_META_API_KEY>
//
// This client only implements endpoints that are documented at
// docs.zernio.com: profiles, accounts, posts, and analytics. It replaces the
// former services/oneup/utils/oneupClient.js OneUp API wrapper.

import crypto from "node:crypto";
import { fetchWithTimeout } from "../../shared/http-client.js";

function trimString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  const cleaned = String(value).trim();
  return cleaned || fallback;
}

function getZernioApiBase() {
  return trimString(process.env.ZERNIO_API_BASE_URL, "https://zernio.com/api/v1").replace(/\/+$/, "");
}

function requireApiKey(apiKey) {
  // ZERNIO_META_API_KEY is the single supported credential env var for this
  // service (see migration notes). ZERNIO_API_KEY is accepted as a fallback
  // since it is the name used by Zernio's own SDKs/CLI.
  const key = trimString(apiKey || process.env.ZERNIO_META_API_KEY || process.env.ZERNIO_API_KEY);
  if (!key) {
    const err = new Error("Missing ZERNIO_META_API_KEY");
    err.statusCode = 400;
    throw err;
  }
  return key;
}

function retryNumber(name, fallback, { min = 0, max = 10 } = {}) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function getZernioRetryConfig() {
  return {
    attempts: retryNumber("ZERNIO_API_RETRY_ATTEMPTS", 5, { min: 1, max: 6 }),
    baseDelayMs: retryNumber("ZERNIO_API_RETRY_BASE_MS", 800, { min: 100, max: 30000 }),
    maxDelayMs: retryNumber("ZERNIO_API_RETRY_MAX_MS", 6000, { min: 500, max: 60000 }),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function isRetryableStatus(statusCode) {
  const code = Number(statusCode);
  // 202 (sync pending) is not retried here — callers that care about
  // analytics sync state should inspect the payload themselves.
  return code === 408 || code === 425 || code === 429 || (code >= 500 && code <= 599);
}

function isRetryableMessage(message = "") {
  return /timeout|timed out|temporar|rate limit|too many requests|try again|busy|unavailable|reset|socket|network|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(String(message || ""));
}

function isRetryableZernioError(error) {
  if (error?.retryable === true) return true;
  if (isRetryableStatus(error?.statusCode || error?.status)) return true;
  return !error?.statusCode && isRetryableMessage(error?.message || "");
}

function retryDelayMs(attempt, config) {
  const exponential = config.baseDelayMs * (2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * Math.min(250, config.baseDelayMs));
  return Math.min(config.maxDelayMs, exponential + jitter);
}

async function withZernioRetry(operation, fn) {
  const config = getZernioRetryConfig();
  let lastError;

  for (let attempt = 1; attempt <= config.attempts; attempt += 1) {
    try {
      const result = await fn(attempt);
      if (result && typeof result === "object" && attempt > 1) {
        result._zernioRetry = { attempts: attempt, recovered: true, operation };
      }
      return result;
    } catch (error) {
      lastError = error;
      const retryable = isRetryableZernioError(error);
      error.zernioRetry = { attempts: attempt, maxAttempts: config.attempts, retryable, operation };
      if (!retryable || attempt >= config.attempts) throw error;
      await sleep(retryDelayMs(attempt, config));
    }
  }

  throw lastError;
}

async function parseJsonSafe(response) {
  const text = await response.text();
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

function normaliseList(value) {
  if (Array.isArray(value)) return value.map((item) => trimString(item)).filter(Boolean);
  const cleaned = trimString(value);
  if (!cleaned) return [];
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed.map((item) => trimString(item)).filter(Boolean);
  } catch {}
  return cleaned
    .split(/[;,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseAccountTarget(accountId = "ALL") {
  const cleaned = trimString(accountId, "ALL");
  if (/^all$/i.test(cleaned)) return { mode: "all", ids: [] };
  return { mode: "specific", ids: [...new Set(normaliseList(cleaned))] };
}

function platformMatches(actual = "", required = "") {
  const current = trimString(actual).toLowerCase();
  const wanted = trimString(required).toLowerCase();
  if (!current || !wanted) return false;
  return current === wanted || current.includes(wanted) || wanted.includes(current);
}

function accountId(account) {
  return trimString(account?._id || account?.id || account?.accountId);
}

function compactAccount(account) {
  return {
    accountId: accountId(account),
    accountUsername: account?.username || account?.displayName || account?.name || null,
    platform: account?.platform || null,
    isActive: account?.isActive ?? null,
    status: account?.status ?? null,
    isExpired: account?.isExpired ?? account?.tokenExpired ?? null,
    needsReconnect: account?.needsReconnect ?? account?.needReauth ?? null,
  };
}

async function zernioGet(endpoint, params = {}, apiKey) {
  return withZernioRetry(`GET ${endpoint}`, async () => {
    const key = requireApiKey(apiKey);
    const url = new URL(`${getZernioApiBase()}/${endpoint}`);
    Object.entries(params || {}).forEach(([param, value]) => {
      if (value === undefined || value === null || value === "") return;
      url.searchParams.set(param, String(value));
    });

    const response = await fetchWithTimeout(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
    const payload = await parseJsonSafe(response);

    if (!response.ok) {
      const err = new Error(payload.json?.error || payload.json?.message || payload.text || `Zernio GET ${endpoint} failed with ${response.status}`);
      err.statusCode = response.status || 502;
      err.details = payload.json;
      throw err;
    }

    return payload.json;
  });
}

function stableRequestId(endpoint, body = {}) {
  const digest = crypto.createHash("sha256").update(`${endpoint}:${JSON.stringify(body || {})}`).digest("hex").slice(0, 32);
  return `aims-${digest}`;
}

async function zernioPost(endpoint, body = {}, apiKey) {
  const requestId = stableRequestId(endpoint, body);
  return withZernioRetry(`POST ${endpoint}`, async () => {
    const key = requireApiKey(apiKey);

    const response = await fetchWithTimeout(`${getZernioApiBase()}/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "x-request-id": requestId,
      },
      body: JSON.stringify(body || {}),
    });

    const parsed = await parseJsonSafe(response);
    if (!response.ok) {
      const err = new Error(parsed.json?.error || parsed.json?.message || parsed.text || `Zernio POST ${endpoint} failed with ${response.status}`);
      err.statusCode = response.status || 502;
      err.details = parsed.json;
      throw err;
    }

    return parsed.json;
  });
}

async function zernioDelete(endpoint, apiKey) {
  return withZernioRetry(`DELETE ${endpoint}`, async () => {
    const key = requireApiKey(apiKey);
    const response = await fetchWithTimeout(`${getZernioApiBase()}/${endpoint}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
    const parsed = await parseJsonSafe(response);
    // DELETE is idempotent for our rollback use. A 404 after a lost success
    // response still means the scheduled post is no longer present.
    if (response.status === 404) {
      return { ok: true, deleted: true, alreadyAbsent: true, message: parsed.json?.message || "Post already absent" };
    }
    if (!response.ok) {
      const err = new Error(parsed.json?.error || parsed.json?.message || parsed.text || `Zernio DELETE ${endpoint} failed with ${response.status}`);
      err.statusCode = response.status || 502;
      err.details = parsed.json;
      throw err;
    }
    return { ok: true, deleted: true, ...(parsed.json || {}) };
  });
}

// --- Profiles (equivalent to OneUp's "categories") -------------------------
// GET /v1/profiles lists profiles visible to the authenticated key.

export async function listProfiles(apiKey) {
  return zernioGet("profiles", {}, apiKey);
}

export async function resolveProfile({ profileName }, apiKey) {
  const profiles = await listProfiles(apiKey);
  const data = Array.isArray(profiles?.profiles) ? profiles.profiles : Array.isArray(profiles?.data) ? profiles.data : [];
  const wanted = trimString(profileName).toLowerCase();
  const match = data.find((item) => trimString(item?.name).toLowerCase() === wanted);

  if (!match) {
    const err = new Error(`Zernio profile '${profileName}' was not found`);
    err.statusCode = 400;
    err.availableProfiles = data.map((item) => item?.name).filter(Boolean);
    throw err;
  }

  return match;
}

// --- Accounts (equivalent to OneUp's "social accounts") --------------------
// GET /v1/accounts lists connected social accounts, optionally scoped to a
// profile via ?profileId=.

export async function listAccounts({ profileId } = {}, apiKey) {
  return zernioGet("accounts", profileId ? { profileId } : {}, apiKey);
}

// --- Posts -------------------------------------------------------------
// POST /v1/posts creates (and optionally schedules/publishes) a post.
// GET /v1/analytics with a date range and no postId returns a paginated
// list of posts with their status and analytics, which this client uses in
// place of OneUp's getscheduledposts/getpublishedposts endpoints.

export async function createPost(body, apiKey) {
  return zernioPost("posts", body, apiKey);
}

export async function deletePost(postId, apiKey) {
  const id = trimString(postId);
  if (!id) {
    const err = new Error("Zernio post ID is required for deletion");
    err.statusCode = 400;
    throw err;
  }
  return zernioDelete(`posts/${encodeURIComponent(id)}`, apiKey);
}

export async function listPostsWithAnalytics({ fromDate, toDate, page = 1, limit = 50, sortBy = "date" } = {}, apiKey) {
  return zernioGet("analytics", { fromDate, toDate, page, limit, sortBy, order: "desc" }, apiKey);
}

export async function fetchPublishedPostsHistory({ maxPages = 4, lookbackDays, windowStart, windowEnd } = {}, apiKey) {
  const pageCount = Math.max(1, Math.min(20, Number(maxPages || 4)));
  const rows = [];
  const endpoints = [];

  const upper = windowEnd instanceof Date && Number.isFinite(windowEnd.getTime()) ? windowEnd : new Date();
  const lower = windowStart instanceof Date && Number.isFinite(windowStart.getTime())
    ? windowStart
    : Number(lookbackDays || 0) > 0
      ? new Date(Date.now() - Number(lookbackDays) * 86400000)
      : new Date(Date.now() - 90 * 86400000); // Zernio's analytics endpoint defaults to a 90-day lookback

  const isoDate = (date) => date.toISOString().slice(0, 10);

  for (let page = 1; page <= pageCount; page += 1) {
    const result = await listPostsWithAnalytics(
      { fromDate: isoDate(lower), toDate: isoDate(upper), page, limit: 50 },
      apiKey
    );
    const data = Array.isArray(result?.posts) ? result.posts : Array.isArray(result?.data) ? result.data : [];
    endpoints.push({ endpoint: "analytics", page, count: data.length });
    rows.push(...data.filter((row) => row?.status === "published"));
    if (data.length < 50) break;
  }

  return {
    message: "OK",
    error: false,
    data: rows,
    rawCount: rows.length,
    filteredCount: rows.length,
    unknownDateCount: 0,
    pagesScanned: endpoints.length,
    endpoints,
  };
}

// --- Targeting inspection (equivalent to OneUp's inspectOneUpTargeting) ----

export async function inspectZernioTargeting({
  profileName,
  accountId: targetAccountId = "ALL",
  requiredPlatforms = [],
  includeGlobalAccounts = false,
} = {}, apiKey) {
  const profile = await resolveProfile({ profileName }, apiKey);
  const profileId = trimString(profile?._id || profile?.id);
  const accountResult = await listAccounts({ profileId }, apiKey);
  const profileAccounts = Array.isArray(accountResult?.accounts) ? accountResult.accounts : Array.isArray(accountResult?.data) ? accountResult.data : [];
  const target = parseAccountTarget(targetAccountId);
  const targetIds = new Set(target.ids.map((id) => String(id)));
  const targetedAccounts = target.mode === "all"
    ? profileAccounts
    : profileAccounts.filter((account) => targetIds.has(accountId(account)));
  const missingTargetIds = target.mode === "specific"
    ? [...targetIds].filter((id) => !profileAccounts.some((account) => accountId(account) === id))
    : [];
  const requiredTypes = Array.isArray(requiredPlatforms)
    ? requiredPlatforms.map((item) => trimString(item)).filter(Boolean)
    : normaliseList(requiredPlatforms);
  const missingRequiredPlatforms = requiredTypes.filter(
    (required) => !targetedAccounts.some((account) => platformMatches(account?.platform, required))
  );

  let globalAccounts = [];
  let globalAccountWarnings = [];
  if (includeGlobalAccounts) {
    try {
      const globalResult = await listAccounts({}, apiKey);
      globalAccounts = Array.isArray(globalResult?.accounts) ? globalResult.accounts : Array.isArray(globalResult?.data) ? globalResult.data : [];
      const staleRequired = globalAccounts
        .filter((account) => requiredTypes.some((required) => platformMatches(account?.platform, required)))
        .filter((account) =>
          account?.isActive === false ||
          String(account?.status || "").toLowerCase() === "disconnected" ||
          account?.isExpired === true ||
          account?.needsReconnect === true ||
          account?.needReauth === true
        );
      if (staleRequired.length) {
        globalAccountWarnings.push(
          `${staleRequired.length} required Zernio social account(s) appear expired or need reconnecting.`
        );
      }
    } catch (error) {
      globalAccountWarnings.push(`Could not fetch global Zernio social accounts: ${error.message}`);
    }
  }

  const warnings = [];
  if (!profileAccounts.length) {
    warnings.push(`Zernio profile '${profileName}' has no connected accounts.`);
  }
  if (missingTargetIds.length) {
    warnings.push(`Configured Zernio accountId value(s) not found in profile '${profileName}': ${missingTargetIds.join(", ")}`);
  }
  if (missingRequiredPlatforms.length) {
    warnings.push(`Zernio profile '${profileName}' is not targeting required platform(s): ${missingRequiredPlatforms.join(", ")}`);
  }
  warnings.push(...globalAccountWarnings);

  return {
    ok: missingTargetIds.length === 0 && missingRequiredPlatforms.length === 0 && profileAccounts.length > 0,
    profile,
    accountId: targetAccountId,
    targetMode: target.mode,
    requiredPlatforms: requiredTypes,
    profileAccountCount: profileAccounts.length,
    targetedAccountCount: targetedAccounts.length,
    profileAccounts: profileAccounts.map(compactAccount),
    targetedAccounts: targetedAccounts.map(compactAccount),
    missingTargetIds,
    missingRequiredPlatforms,
    globalAccountCount: globalAccounts.length,
    warnings,
  };
}
