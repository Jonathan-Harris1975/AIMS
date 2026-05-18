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

async function parseJsonSafe(response) {
  const text = await response.text();
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

async function oneUpGet(endpoint, params = {}, apiKey) {
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
    throw err;
  }

  return payload.json;
}

async function oneUpPost(endpoint, body = {}, apiKey) {
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
    throw err;
  }

  return parsed.json;
}

export async function listCategories(apiKey) {
  return oneUpGet("listcategory", {}, apiKey);
}

export async function listCategoryAccounts(categoryId, apiKey) {
  return oneUpGet("listcategoryaccount", { category_id: categoryId }, apiKey);
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
