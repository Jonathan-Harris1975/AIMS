import { ONEUP_API_BASE } from "./config.js";

function trimString(value) {
  return value === undefined || value === null ? "" : String(value).trim();
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
  const url = new URL(`${ONEUP_API_BASE}/${endpoint}`);
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

  const response = await fetch(`${ONEUP_API_BASE}/${endpoint}`, {
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
