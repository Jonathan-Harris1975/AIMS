import { fetchWithTimeout } from "../../shared/http-client.js";

const DEFAULT_TIMEOUT_MS = Number(process.env.CLOUDFLARE_PURGE_TIMEOUT_MS) || 15000;

function normaliseEnvString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function createStatusError(message, statusCode = 500, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (details !== undefined) {
    err.details = details;
  }
  return err;
}

function toNonEmptyTrimmedArray(values) {
  if (!Array.isArray(values)) return null;

  const cleaned = values
    .map((value) => (value === undefined || value === null ? "" : String(value).trim()))
    .filter(Boolean);

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

  const files = toNonEmptyTrimmedArray(body.files);
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

  return {
    mode: "purge_everything",
    payload: { purge_everything: true },
  };
}

function buildAuthHeaders(authMode = "token") {
  const tokenOrKey = normaliseEnvString(process.env.CF_purge);
  const email = normaliseEnvString(process.env.CF_EMAIL);

  if (!tokenOrKey) {
    throw createStatusError(
      "Cloudflare purge is not configured. Missing CF_purge environment variable.",
      500
    );
  }

  if (authMode === "global-key") {
    if (!email) {
      throw createStatusError(
        "Cloudflare Global API Key auth requires CF_EMAIL. CF_purge on its own is treated as an API token and must be sent as an Authorization Bearer token.",
        500,
        {
          authMode,
          missing: ["CF_EMAIL"],
        }
      );
    }

    return {
      "X-Auth-Email": email,
      "X-Auth-Key": tokenOrKey,
      "Content-Type": "application/json",
    };
  }

  return {
    Authorization: `Bearer ${tokenOrKey}`,
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

export async function purgeCloudflareCache(input = {}, options = {}) {
  const zoneId = normaliseEnvString(process.env.CF_zone);
  if (!zoneId) {
    throw createStatusError(
      "Cloudflare purge is not configured. Missing CF_zone environment variable.",
      500
    );
  }

  const { mode, payload } = buildPurgePayload(input);
  const authMode = options?.authMode || "token";
  const url = `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}/purge_cache`;

  const response = await fetchWithTimeout(url, {
    method: "POST",
    timeout: Number(options?.timeoutMs) || DEFAULT_TIMEOUT_MS,
    headers: buildAuthHeaders(authMode),
    body: JSON.stringify(payload),
  });

  const body = await parseResponseBody(response);
  const cloudflareMessages = formatCloudflareMessages(body);

  if (!response.ok || body?.success === false) {
    const detailMessage = cloudflareMessages.join("; ");
    throw createStatusError(
      detailMessage ? `Cloudflare purge failed: ${detailMessage}` : "Cloudflare purge failed.",
      response.status >= 400 && response.status < 500 ? response.status : 502,
      {
        mode,
        status: response.status,
        errors: Array.isArray(body?.errors) ? body.errors : [],
        messages: Array.isArray(body?.messages) ? body.messages : [],
        result: body?.result || null,
      }
    );
  }

  return {
    mode,
    request: payload,
    result: body?.result || null,
    errors: Array.isArray(body?.errors) ? body.errors : [],
    messages: Array.isArray(body?.messages) ? body.messages : [],
  };
}

export default purgeCloudflareCache;
