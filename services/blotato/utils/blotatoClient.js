import { fetchWithTimeout } from "../../shared/http-client.js";

const DEFAULT_BLOTATO_API_BASE = "https://backend.blotato.com/v2";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_SLEEP_MS = 120_000;

const BLOTATO_KEY_ENV_NAMES = ["Blotato_API_key", "BLOTATO_API_KEY"];

function positiveIntEnv(name, fallback, max = Number.POSITIVE_INFINITY) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function sleep(ms) {
  const parsedMs = Number(ms);
  const safeMs = Number.isFinite(parsedMs) ? Math.min(MAX_SLEEP_MS, Math.max(0, Math.floor(parsedMs))) : 0;
  return new Promise((resolve) => setTimeout(resolve, safeMs));
}

function isRetryableStatus(status) {
  const code = Number(status);
  return code === 408 || code === 425 || code === 429 || code >= 500;
}

function isRetryableNetworkError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return /timeout|timed out|econnreset|etimedout|eai_again|socket hang up|network|fetch failed/.test(message);
}

function trimString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  const cleaned = String(value).trim();
  return cleaned || fallback;
}

function looksLikeTemplatePlaceholder(value) {
  return /^\s*\{\{\s*secret\.[^}]+\}\}\s*$/i.test(String(value || ""));
}

function firstUsableEnv(names = []) {
  for (const name of names) {
    const value = trimString(process.env[name]);
    if (!value || looksLikeTemplatePlaceholder(value)) continue;
    return { name, value };
  }
  return { name: undefined, value: undefined };
}

function getBlotatoApiBase() {
  return trimString(process.env.BLOTATO_API_BASE, DEFAULT_BLOTATO_API_BASE).replace(/\/+$/, "");
}

export function hasBlotatoApiKey() {
  return Boolean(firstUsableEnv(BLOTATO_KEY_ENV_NAMES).value);
}

export function getBlotatoApiKey(apiKey) {
  const supplied = trimString(apiKey);
  if (supplied && !looksLikeTemplatePlaceholder(supplied)) return supplied;

  const resolved = firstUsableEnv(BLOTATO_KEY_ENV_NAMES);
  if (resolved.value) return resolved.value;

  const err = new Error("Missing Blotato_API_key");
  err.statusCode = 400;
  err.envNames = BLOTATO_KEY_ENV_NAMES;
  throw err;
}

export function getBlotatoConfigSummary() {
  return {
    apiBase: getBlotatoApiBase(),
    apiKeyConfigured: hasBlotatoApiKey(),
    apiKeyEnvNames: BLOTATO_KEY_ENV_NAMES,
  };
}

function joinEndpoint(endpoint = "") {
  const cleaned = String(endpoint || "").replace(/^\/+/, "");
  return `${getBlotatoApiBase()}/${cleaned}`;
}

function addQueryParams(url, params = {}) {
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, String(value));
  });
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) return { json: null, text: "" };
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

function parseRetryAfterMs(response, parsed) {
  const rawHeader = response?.headers?.get?.("retry-after");
  if (rawHeader) {
    const seconds = Number(rawHeader);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1000, Math.ceil(seconds * 1000));

    const dateMs = Date.parse(rawHeader);
    if (Number.isFinite(dateMs)) return Math.max(1000, dateMs - Date.now());
  }

  const text = [parsed?.json?.message, parsed?.json?.error, parsed?.json?.errorMessage, parsed?.text]
    .filter(Boolean)
    .join(" ");
  const secondsMatch = text.match(/retry\s+in\s+(\d+(?:\.\d+)?)\s*(?:s|sec|second|seconds)?/i);
  if (secondsMatch) return Math.max(1000, Math.ceil(Number(secondsMatch[1]) * 1000));

  return 0;
}

function makeBlotatoError({ response, parsed, endpoint }) {
  const message =
    parsed.json?.message ||
    parsed.json?.error ||
    parsed.json?.errorMessage ||
    parsed.text ||
    `Blotato ${endpoint} failed with ${response.status}`;

  const err = new Error(message);
  err.statusCode = response.status || 502;
  err.details = parsed.json || parsed.text || null;
  err.endpoint = endpoint;
  err.retryAfterMs = parseRetryAfterMs(response, parsed);
  return err;
}

async function blotatoRequest(endpoint, {
  method = "GET",
  params,
  body,
  apiKey,
  timeoutMs = Number(process.env.BLOTATO_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  retryAttempts,
} = {}) {
  const key = getBlotatoApiKey(apiKey);
  const attempts = Number.isFinite(Number(retryAttempts))
    ? Math.min(Math.max(Math.floor(Number(retryAttempts)), 1), 8)
    : positiveIntEnv("BLOTATO_API_RETRY_ATTEMPTS", 5, 8);
  const baseDelayMs = positiveIntEnv("BLOTATO_API_RETRY_BASE_MS", 1000, 30_000);
  const maxDelayMs = positiveIntEnv("BLOTATO_API_RETRY_MAX_MS", 12_000, 120_000);
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const url = new URL(joinEndpoint(endpoint));
    addQueryParams(url, params);

    const headers = {
      accept: "application/json",
      "content-type": "application/json",
      "blotato-api-key": key,
    };

    try {
      const response = await fetchWithTimeout(url.toString(), {
        method,
        timeout: timeoutMs,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      const parsed = await parseResponseBody(response);
      if (!response.ok) {
        const err = makeBlotatoError({ response, parsed, endpoint });
        err.retryable = isRetryableStatus(response.status);
        throw err;
      }

      return parsed.json ?? { raw: parsed.text };
    } catch (error) {
      lastError = error;
      const retryable = Boolean(error?.retryable || isRetryableNetworkError(error));
      if (!retryable || attempt >= attempts) throw error;

      const exponentialMs = baseDelayMs * Math.pow(2, attempt - 1);
      const waitMs = Math.min(maxDelayMs, Math.max(exponentialMs, Number(error?.retryAfterMs || 0)));
      await sleep(waitMs);
    }
  }

  throw lastError || new Error(`Blotato ${endpoint} request failed`);
}


export async function getUser(apiKey) {
  return blotatoRequest("users/me", { apiKey });
}

export async function listAccounts({ platform } = {}, apiKey) {
  return blotatoRequest("users/me/accounts", {
    params: { platform },
    apiKey,
  });
}

export async function listSubaccounts(accountId, apiKey) {
  const cleaned = trimString(accountId);
  if (!cleaned) {
    const err = new Error("accountId is required");
    err.statusCode = 400;
    throw err;
  }

  return blotatoRequest(`users/me/accounts/${encodeURIComponent(cleaned)}/subaccounts`, { apiKey });
}

export async function listTemplates({ fields = "id,name,description,inputs", search, id } = {}, apiKey) {
  return blotatoRequest("videos/templates", {
    params: { fields, search, id },
    apiKey,
  });
}

export async function createVisual({
  templateId,
  inputs = {},
  prompt,
  render = true,
  isDraft = false,
  useBrandKit = false,
} = {}, apiKey) {
  const body = {
    templateId,
    inputs,
    render,
    isDraft,
    useBrandKit: Boolean(useBrandKit),
  };

  if (prompt !== undefined && prompt !== null && String(prompt).trim()) {
    body.prompt = String(prompt).trim();
  }

  return blotatoRequest("videos/from-templates", {
    method: "POST",
    body,
    apiKey,
  });
}

export async function getVisualStatus(id, apiKey) {
  const cleaned = trimString(id);
  if (!cleaned) {
    const err = new Error("visual id is required");
    err.statusCode = 400;
    throw err;
  }

  return blotatoRequest(`videos/creations/${encodeURIComponent(cleaned)}`, {
    apiKey,
    retryAttempts: positiveIntEnv("BLOTATO_STATUS_RETRY_ATTEMPTS", 1, 3),
  });
}

export async function deleteVisual(id, apiKey) {
  const cleaned = trimString(id);
  if (!cleaned) {
    const err = new Error("visual id is required");
    err.statusCode = 400;
    throw err;
  }

  return blotatoRequest(`videos/${encodeURIComponent(cleaned)}`, {
    method: "DELETE",
    apiKey,
  });
}

function buildPostPayload({
  accountId,
  platform,
  text,
  mediaUrls = [],
  target = {},
  additionalPosts,
  scheduledTime,
  useNextFreeSlot,
} = {}) {
  const targetType = target?.targetType || platform;
  const body = {
    post: {
      accountId,
      content: {
        text,
        mediaUrls,
        platform,
        ...(Array.isArray(additionalPosts) && additionalPosts.length ? { additionalPosts } : {}),
      },
      target: {
        ...target,
        targetType,
      },
    },
  };

  if (scheduledTime) body.scheduledTime = scheduledTime;
  if (useNextFreeSlot !== undefined) body.useNextFreeSlot = Boolean(useNextFreeSlot);

  return body;
}

export async function publishPost(payload = {}, apiKey) {
  return blotatoRequest("posts", {
    method: "POST",
    body: buildPostPayload(payload),
    apiKey,
  });
}

export async function getPostStatus(postSubmissionId, apiKey) {
  const cleaned = trimString(postSubmissionId);
  if (!cleaned) {
    const err = new Error("postSubmissionId is required");
    err.statusCode = 400;
    throw err;
  }

  return blotatoRequest(`posts/${encodeURIComponent(cleaned)}`, { apiKey });
}
