import { fetchWithTimeout } from "../../shared/http-client.js";
import { createStatusError, resolveCloudflarePurgeConfig } from "./purgeConfig.js";

const DEFAULT_TIMEOUT_MS = Number(process.env.CLOUDFLARE_PURGE_TIMEOUT_MS) || 15000;

function toNonEmptyTrimmedArray(values) {
  if (!Array.isArray(values)) return null;

  const cleaned = values
    .map((value) => (value === undefined || value === null ? "" : String(value).trim()))
    .filter(Boolean);

  return cleaned.length ? cleaned : null;
}

function cleanFileEntry(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const url = value.url === undefined || value.url === null ? "" : String(value.url).trim();
    if (!url) return null;

    const output = { url };
    if (value.headers && typeof value.headers === "object" && !Array.isArray(value.headers)) {
      const headers = Object.fromEntries(
        Object.entries(value.headers)
          .map(([key, headerValue]) => [String(key).trim(), String(headerValue).trim()])
          .filter(([key, headerValue]) => key && headerValue)
      );
      if (Object.keys(headers).length) output.headers = headers;
    }
    return output;
  }

  const url = value === undefined || value === null ? "" : String(value).trim();
  return url ? url : null;
}

function toNonEmptyFileArray(values) {
  if (!Array.isArray(values)) return null;

  const cleaned = values.map(cleanFileEntry).filter(Boolean);
  return cleaned.length ? cleaned : null;
}

function formatCloudflareMessages(cloudflareBody = {}) {
  const messages = [];

  if (Array.isArray(cloudflareBody.errors)) {
    for (const item of cloudflareBody.errors) {
      if (!item) continue;
      if (typeof item === "string") {
        messages.push(item);
        continue;
      }
      if (item.message) {
        messages.push(item.message);
        continue;
      }
      if (item.code) {
        messages.push(`Cloudflare error ${item.code}`);
      }
    }
  }

  if (Array.isArray(cloudflareBody.messages)) {
    for (const item of cloudflareBody.messages) {
      if (!item) continue;
      if (typeof item === "string") {
        messages.push(item);
        continue;
      }
      if (item.message) {
        messages.push(item.message);
      }
    }
  }

  return messages.filter(Boolean);
}

function buildPurgePayload(input = {}) {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input : {};

  if (body.purge_everything === true) {
    return {
      mode: "purge_everything",
      payload: { purge_everything: true },
    };
  }

  const files = toNonEmptyFileArray(body.files);
  if (files) {
    return {
      mode: "files",
      payload: { files },
    };
  }

  const tags = toNonEmptyTrimmedArray(body.tags);
  if (tags) {
    return {
      mode: "tags",
      payload: { tags },
    };
  }

  const hosts = toNonEmptyTrimmedArray(body.hosts);
  if (hosts) {
    return {
      mode: "hosts",
      payload: { hosts },
    };
  }

  const prefixes = toNonEmptyTrimmedArray(body.prefixes);
  if (prefixes) {
    return {
      mode: "prefixes",
      payload: { prefixes },
    };
  }

  throw createStatusError(
    "Cloudflare purge requests must specify exactly one purge mode.",
    400
  );
}

function buildAuthHeaders(config) {
  if (config.authMode === "global-key") {
    return {
      "X-Auth-Email": config.email,
      "X-Auth-Key": config.globalKey,
      "Content-Type": "application/json",
    };
  }

  return {
    Authorization: `Bearer ${config.token}`,
    "Content-Type": "application/json",
  };
}

async function parseResponseBody(response) {
  const raw = await response.text();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

export { resolveCloudflarePurgeConfig } from "./purgeConfig.js";

export async function purgeCloudflareCache(input = {}, options = {}) {
  const config = resolveCloudflarePurgeConfig(options?.env || process.env);
  const { mode, payload } = buildPurgePayload(input);
  const url = `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(config.zoneId)}/purge_cache`;

  const response = await fetchWithTimeout(url, {
    method: "POST",
    timeout: Number(options?.timeoutMs) || DEFAULT_TIMEOUT_MS,
    headers: buildAuthHeaders(config),
    body: JSON.stringify(payload),
  });

  const body = await parseResponseBody(response);
  const cloudflareMessages = formatCloudflareMessages(body);

  if (!response.ok || body?.success === false) {
    const detailMessage = cloudflareMessages.join("; ");
    const authHint = response.status === 401
      ? ` Check ${config.authMode === "api-token" ? config.tokenEnvKey : `${config.emailEnvKey}/${config.globalKeyEnvKey}`} and zone id env ${config.zoneEnvKey}; Cloudflare returned 401.`
      : "";

    throw createStatusError(
      detailMessage
        ? `Cloudflare purge failed: ${detailMessage}${authHint}`
        : `Cloudflare purge failed.${authHint}`,
      response.status >= 400 && response.status < 500 ? response.status : 502,
      {
        source: "cloudflare-api",
        mode,
        status: response.status,
        cloudflareErrors: Array.isArray(body?.errors) ? body.errors : [],
        cloudflareMessages: Array.isArray(body?.messages) ? body.messages : [],
        authMode: config.authMode,
        zoneEnvKey: config.zoneEnvKey,
        tokenEnvKey: config.tokenEnvKey,
      }
    );
  }

  return {
    mode,
    request: payload,
    authMode: config.authMode,
    zoneEnvKey: config.zoneEnvKey,
    tokenEnvKey: config.tokenEnvKey || config.globalKeyEnvKey || null,
    result: body?.result || null,
    errors: Array.isArray(body?.errors) ? body.errors : [],
    messages: Array.isArray(body?.messages) ? body.messages : [],
  };
}

export default purgeCloudflareCache;
