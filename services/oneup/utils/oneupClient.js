function trimString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  const cleaned = String(value).trim();
  return cleaned || fallback;
}

function getOneUpApiBase() {
  return trimString(process.env.ONEUP_API_BASE, "https://www.oneupapp.io/api").replace(/\/+$/, "");
}

function requireApiKey(apiKey) {
  const key = trimString(apiKey || process.env.ONEUP_API_KEY);
  if (!key) {
    const err = new Error("Missing ONEUP_API_KEY");
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

function getOneUpRetryConfig() {
  return {
    attempts: retryNumber("ONEUP_API_RETRY_ATTEMPTS", 3, { min: 1, max: 6 }),
    baseDelayMs: retryNumber("ONEUP_API_RETRY_BASE_MS", 800, { min: 100, max: 30000 }),
    maxDelayMs: retryNumber("ONEUP_API_RETRY_MAX_MS", 6000, { min: 500, max: 60000 }),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function isRetryableStatus(statusCode) {
  const code = Number(statusCode);
  return code === 408 || code === 425 || code === 429 || (code >= 500 && code <= 599);
}

function isRetryableMessage(message = "") {
  return /timeout|timed out|temporar|rate limit|too many requests|try again|busy|unavailable|reset|socket|network|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(String(message || ""));
}

function isRetryableOneUpError(error) {
  if (error?.retryable === true) return true;
  if (isRetryableStatus(error?.statusCode || error?.status)) return true;
  return !error?.statusCode && isRetryableMessage(error?.message || "");
}

function retryDelayMs(attempt, config) {
  const exponential = config.baseDelayMs * (2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * Math.min(250, config.baseDelayMs));
  return Math.min(config.maxDelayMs, exponential + jitter);
}

async function withOneUpRetry(operation, fn) {
  const config = getOneUpRetryConfig();
  let lastError;

  for (let attempt = 1; attempt <= config.attempts; attempt += 1) {
    try {
      const result = await fn(attempt);
      if (result && typeof result === "object" && attempt > 1) {
        result._oneUpRetry = { attempts: attempt, recovered: true, operation };
      }
      return result;
    } catch (error) {
      lastError = error;
      const retryable = isRetryableOneUpError(error);
      error.oneUpRetry = { attempts: attempt, maxAttempts: config.attempts, retryable, operation };
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

function parseSocialNetworkTarget(socialNetworkId = "ALL") {
  const cleaned = trimString(socialNetworkId, "ALL");
  if (/^all$/i.test(cleaned)) return { mode: "all", ids: [] };
  return { mode: "specific", ids: [...new Set(normaliseList(cleaned))] };
}

function networkTypeMatches(actual = "", required = "") {
  const current = trimString(actual).toLowerCase();
  const wanted = trimString(required).toLowerCase();
  if (!current || !wanted) return false;
  return current === wanted || current.includes(wanted) || wanted.includes(current);
}

function accountId(account) {
  return trimString(account?.social_network_id || account?.social_account_id || account?.id);
}

function compactAccount(account) {
  return {
    social_network_id: accountId(account),
    social_network_name: account?.social_network_name || account?.full_name || account?.username || null,
    social_network_type: account?.social_network_type || null,
    is_expired: account?.is_expired ?? null,
    need_refresh: account?.need_refresh ?? null,
  };
}

async function oneUpGet(endpoint, params = {}, apiKey) {
  return withOneUpRetry(`GET ${endpoint}`, async () => {
    const key = requireApiKey(apiKey);
    const url = new URL(`${getOneUpApiBase()}/${endpoint}`);
    url.searchParams.set("apiKey", key);
    Object.entries(params || {}).forEach(([param, value]) => {
      if (value === undefined || value === null || value === "") return;
      url.searchParams.set(param, String(value));
    });

    const response = await fetch(url, { method: "GET" });
    const payload = await parseJsonSafe(response);

    if (!response.ok) {
      const err = new Error(payload.json?.message || payload.text || `OneUp GET ${endpoint} failed with ${response.status}`);
      err.statusCode = response.status || 502;
      err.details = payload.json;
      throw err;
    }

    if (payload.json?.error) {
      const err = new Error(payload.json?.message || `OneUp GET ${endpoint} returned an error`);
      err.statusCode = 502;
      err.details = payload.json;
      err.retryable = isRetryableMessage(err.message);
      throw err;
    }

    return payload.json;
  });
}

async function oneUpPost(endpoint, body = {}, apiKey) {
  return withOneUpRetry(`POST ${endpoint}`, async () => {
    const key = requireApiKey(apiKey);
    const payload = new URLSearchParams();
    payload.set("apiKey", key);
    Object.entries(body || {}).forEach(([param, value]) => {
      if (value === undefined || value === null || value === "") return;
      payload.set(param, String(value));
    });

    const response = await fetch(`${getOneUpApiBase()}/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload.toString(),
    });

    const parsed = await parseJsonSafe(response);
    if (!response.ok) {
      const err = new Error(parsed.json?.message || parsed.text || `OneUp POST ${endpoint} failed with ${response.status}`);
      err.statusCode = response.status || 502;
      err.details = parsed.json;
      throw err;
    }

    if (parsed.json?.error) {
      const err = new Error(parsed.json?.message || `OneUp POST ${endpoint} returned an error`);
      err.statusCode = 502;
      err.details = parsed.json;
      err.retryable = isRetryableMessage(err.message);
      throw err;
    }

    return parsed.json;
  });
}

export async function listCategories(apiKey) {
  return oneUpGet("listcategory", {}, apiKey);
}

export async function listCategoryAccounts(categoryId, apiKey) {
  return oneUpGet("listcategoryaccount", { category_id: categoryId }, apiKey);
}

export async function listSocialAccounts(apiKey) {
  return oneUpGet("listsocialaccounts", {}, apiKey);
}

export async function listScheduledPosts({ start = 0 } = {}, apiKey) {
  return oneUpGet("getscheduledposts", { start }, apiKey);
}

export async function listPublishedPosts({ start = 0 } = {}, apiKey) {
  return oneUpGet("getpublishedposts", { start }, apiKey);
}

export async function fetchPublishedPostsHistory({ start = 0, maxPages = 4, lookbackDays, windowStart, windowEnd } = {}, apiKey) {
  const pageCount = Math.max(1, Math.min(20, Number(maxPages || 4)));
  const firstStart = Math.max(0, Number(start || 0));
  const rows = [];
  const endpoints = [];

  for (let page = 0; page < pageCount; page += 1) {
    const pageStart = firstStart + page * 50;
    const result = await listPublishedPosts({ start: pageStart }, apiKey);
    endpoints.push({ endpoint: "getpublishedposts", start: pageStart, count: Array.isArray(result?.data) ? result.data.length : 0 });
    const data = Array.isArray(result?.data) ? result.data : [];
    rows.push(...data);
    if (data.length < 50) break;
  }

  const lower = windowStart instanceof Date && Number.isFinite(windowStart.getTime())
    ? windowStart
    : Number(lookbackDays || 0) > 0
      ? new Date(Date.now() - Number(lookbackDays) * 86400000)
      : null;
  const upper = windowEnd instanceof Date && Number.isFinite(windowEnd.getTime()) ? windowEnd : new Date();
  const datedRows = rows.map((row) => {
    const parsed = Date.parse(row?.created_at || row?.published_at || row?.publishedAt || "");
    return { row, date: Number.isFinite(parsed) ? new Date(parsed) : null };
  });

  const unknownDateCount = datedRows.filter(({ date }) => !date).length;
  const filtered = datedRows
    .filter(({ date }) => {
      if (!date || !lower) return true;
      return date.getTime() >= lower.getTime() && date.getTime() <= upper.getTime();
    })
    .map(({ row }) => row);

  return {
    message: "OK",
    error: false,
    data: filtered,
    rawCount: rows.length,
    filteredCount: filtered.length,
    unknownDateCount,
    pagesScanned: endpoints.length,
    endpoints,
  };
}

export async function scheduleTextPost(body, apiKey) {
  return oneUpPost("scheduletextpost", body, apiKey);
}

export async function scheduleImagePost(body, apiKey) {
  return oneUpPost("scheduleimagepost", body, apiKey);
}

export async function resolveCategory({ categoryName }, apiKey) {
  const categories = await listCategories(apiKey);
  const data = Array.isArray(categories?.data) ? categories.data : [];
  const wanted = trimString(categoryName).toLowerCase();
  const match = data.find((item) => trimString(item?.category_name).toLowerCase() === wanted);

  if (!match) {
    const err = new Error(`OneUp category '${categoryName}' was not found`);
    err.statusCode = 400;
    err.availableCategories = data.map((item) => item?.category_name).filter(Boolean);
    throw err;
  }

  return match;
}


export async function inspectOneUpTargeting({
  categoryName,
  socialNetworkId = "ALL",
  requiredNetworkTypes = [],
  includeGlobalAccounts = false,
} = {}, apiKey) {
  const category = await resolveCategory({ categoryName }, apiKey);
  const categoryAccountResult = await listCategoryAccounts(category.id, apiKey);
  const categoryAccounts = Array.isArray(categoryAccountResult?.data) ? categoryAccountResult.data : [];
  const target = parseSocialNetworkTarget(socialNetworkId);
  const targetIds = new Set(target.ids.map((id) => String(id)));
  const targetedAccounts = target.mode === "all"
    ? categoryAccounts
    : categoryAccounts.filter((account) => targetIds.has(accountId(account)));
  const missingTargetIds = target.mode === "specific"
    ? [...targetIds].filter((id) => !categoryAccounts.some((account) => accountId(account) === id))
    : [];
  const requiredTypes = Array.isArray(requiredNetworkTypes)
    ? requiredNetworkTypes.map((item) => trimString(item)).filter(Boolean)
    : normaliseList(requiredNetworkTypes);
  const missingRequiredNetworkTypes = requiredTypes.filter(
    (required) => !targetedAccounts.some((account) => networkTypeMatches(account?.social_network_type, required))
  );

  let globalAccounts = [];
  let globalAccountWarnings = [];
  if (includeGlobalAccounts) {
    try {
      const globalResult = await listSocialAccounts(apiKey);
      globalAccounts = Array.isArray(globalResult?.data) ? globalResult.data : [];
      const staleRequired = globalAccounts
        .filter((account) => requiredTypes.some((required) => networkTypeMatches(account?.social_network_type, required)))
        .filter((account) => Number(account?.is_expired) === 1 || account?.need_refresh === true);
      if (staleRequired.length) {
        globalAccountWarnings.push(
          `${staleRequired.length} required OneUp social account(s) appear expired or need refresh.`
        );
      }
    } catch (error) {
      globalAccountWarnings.push(`Could not fetch global OneUp social accounts: ${error.message}`);
    }
  }

  const warnings = [];
  if (!categoryAccounts.length) {
    warnings.push(`OneUp category '${categoryName}' has no connected accounts.`);
  }
  if (missingTargetIds.length) {
    warnings.push(`Configured OneUp social_network_id value(s) not found in category '${categoryName}': ${missingTargetIds.join(", ")}`);
  }
  if (missingRequiredNetworkTypes.length) {
    warnings.push(`OneUp category '${categoryName}' is not targeting required network type(s): ${missingRequiredNetworkTypes.join(", ")}`);
  }
  warnings.push(...globalAccountWarnings);

  return {
    ok: missingTargetIds.length === 0 && missingRequiredNetworkTypes.length === 0 && categoryAccounts.length > 0,
    category,
    socialNetworkId,
    targetMode: target.mode,
    requiredNetworkTypes: requiredTypes,
    categoryAccountCount: categoryAccounts.length,
    targetedAccountCount: targetedAccounts.length,
    categoryAccounts: categoryAccounts.map(compactAccount),
    targetedAccounts: targetedAccounts.map(compactAccount),
    missingTargetIds,
    missingRequiredNetworkTypes,
    globalAccountCount: globalAccounts.length,
    warnings,
  };
}
