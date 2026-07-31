import { CommsHubError } from "../errors.js";
import { withRetry } from "./retry.js";
async function logRetry(event, data) {
  const { log } = await import("../../../logger.js");
  log.warn(event, data);
}


async function sharedFetchWithTimeout(url, options) {
  const { fetchWithTimeout } = await import("../../shared/http-client.js");
  return fetchWithTimeout(url, options);
}


function responseMessages(payload) {
  const entries = [...(Array.isArray(payload?.errors) ? payload.errors : []), ...(Array.isArray(payload?.messages) ? payload.messages : [])];
  return entries.map((entry) => String(entry?.message || "").trim()).filter(Boolean).join("; ").slice(0, 1000);
}

async function parseCloudflareJson(response, operation) {
  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new CommsHubError(502, "cloudflare_response_invalid", `${operation} returned invalid JSON.`, {
      cause,
      retryable: true,
      failureClass: "temporary",
      publicMessage: "Cloudflare storage is temporarily unavailable.",
    });
  }
  if (!response.ok || payload?.success !== true) {
    const detail = responseMessages(payload);
    const status = Number(response.status) || 502;
    throw new CommsHubError(status === 401 || status === 403 ? 503 : 502, "cloudflare_api_failed", `${operation} failed${detail ? `: ${detail}` : ` with status ${status}`}.`, {
      retryable: [408, 425, 429, 500, 502, 503, 504].includes(status),
      failureClass: status >= 500 || status === 429 ? "temporary" : "permanent",
      publicMessage: "Cloudflare storage operation failed.",
    });
  }
  return payload;
}

export class D1Client {
  constructor(config, { fetchImpl = sharedFetchWithTimeout } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.accountId = config.cloudflareAccountId || "";
  }

  async request(url, init = {}) {
    return this.fetchImpl(url, {
      ...init,
      timeout: this.config.d1TimeoutMs,
      headers: {
        authorization: `Bearer ${this.config.d1ApiToken}`,
        accept: "application/json",
        ...(init.headers || {}),
      },
    });
  }

  async resolveAccountId() {
    if (this.accountId) return this.accountId;
    const accountsResponse = await this.request(`${this.config.cloudflareApiBaseUrl}/accounts?per_page=50`);
    const accountsPayload = await parseCloudflareJson(accountsResponse, "Cloudflare account discovery");
    const accounts = Array.isArray(accountsPayload.result) ? accountsPayload.result : [];
    if (!accounts.length) {
      throw new CommsHubError(503, "cloudflare_account_missing", "No Cloudflare account is accessible to D1_API_KEY.", {
        failureClass: "permanent",
        publicMessage: "Cloudflare account configuration is invalid.",
      });
    }

    for (const account of accounts) {
      if (!account?.id) continue;
      const response = await this.request(`${this.config.cloudflareApiBaseUrl}/accounts/${account.id}/d1/database/${this.config.d1DatabaseId}`);
      if (!response.ok) continue;
      const payload = await response.json().catch(() => null);
      if (payload?.success === true) {
        this.accountId = String(account.id);
        return this.accountId;
      }
    }

    throw new CommsHubError(503, "d1_database_unresolved", "D1_UUID was not found in any account accessible to D1_API_KEY.", {
      failureClass: "permanent",
      publicMessage: "D1 configuration is invalid.",
    });
  }

  async execute(body, operation) {
    return withRetry(async () => {
      let response;
      try {
        if (this.config.d1ProxyUrl) {
          response = await this.fetchImpl(this.config.d1ProxyUrl, {
            method: "POST",
            timeout: this.config.d1TimeoutMs,
            headers: {
              authorization: `Bearer ${this.config.d1ProxyToken}`,
              accept: "application/json",
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
          });
        } else {
          const accountId = await this.resolveAccountId();
          response = await this.request(
            `${this.config.cloudflareApiBaseUrl}/accounts/${accountId}/d1/database/${this.config.d1DatabaseId}/query`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }
          );
        }
      } catch (cause) {
        throw new CommsHubError(502, "d1_unreachable", `${operation} could not reach D1.`, {
          cause,
          retryable: true,
          failureClass: "temporary",
          publicMessage: "Comms Hub storage is temporarily unavailable.",
        });
      }
      const payload = await parseCloudflareJson(response, operation);
      const results = Array.isArray(payload.result) ? payload.result : [];
      if (!results.length || results.some((entry) => entry?.success !== true)) {
        throw new CommsHubError(502, "d1_query_failed", `${operation} returned an incomplete D1 result.`, {
          retryable: false,
          failureClass: "recoverable",
          publicMessage: "Comms Hub storage operation failed.",
        });
      }
      return results;
    }, {
      attempts: this.config.providerRetryAttempts,
      baseMs: this.config.providerRetryBaseMs,
      maxMs: this.config.providerRetryMaxMs,
      onRetry: ({ attempt, maxAttempts, delayMs, error }) => logRetry("commsHub.d1.retry", {
        attempt,
        maxAttempts,
        delayMs,
        code: error?.code || null,
        statusCode: error?.statusCode || null,
      }),
    });
  }

  async query(sql, params = []) {
    const [result] = await this.execute({ sql, params }, "D1 query");
    return result;
  }

  async batch(statements) {
    if (!Array.isArray(statements) || statements.length === 0) {
      throw new TypeError("D1 batch requires at least one statement.");
    }
    const results = await this.execute({ batch: statements.map(({ sql, params = [] }) => ({ sql, params })) }, "D1 batch");
    if (results.length !== statements.length) {
      throw new CommsHubError(502, "d1_batch_incomplete", "D1 returned fewer batch results than statements.", {
        failureClass: "recoverable",
        publicMessage: "Comms Hub storage operation failed.",
      });
    }
    return results;
  }
}

export default D1Client;
