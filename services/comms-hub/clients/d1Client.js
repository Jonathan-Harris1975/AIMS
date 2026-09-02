import { CommsHubError } from "../errors.js";
import { withRetry } from "./retry.js";
import { createHash } from "node:crypto";

const HIGH_ROW_READ_WARNING = 1_000;

async function logRetry(event, data) {
  const { log } = await import("../../../logger.js");
  log.warn(event, data);
}

async function logD1Warning(event, data) {
  try {
    const { log } = await import("../../../logger.js");
    log.warn(event, data);
  } catch {
    // Observability must never change storage behaviour.
  }
}


async function sharedFetchWithTimeout(url, options) {
  const { fetchWithTimeout } = await import("../../shared/http-client.js");
  return fetchWithTimeout(url, options);
}


function responseMessages(payload) {
  const entries = [...(Array.isArray(payload?.errors) ? payload.errors : []), ...(Array.isArray(payload?.messages) ? payload.messages : [])];
  return entries.map((entry) => String(entry?.message || "").trim()).filter(Boolean).join("; ").slice(0, 1000);
}

export function isD1DailyRowReadLimit(value) {
  const text = String(value?.message || value || "").toLowerCase();
  return text.includes("exceeded d1's free tier daily row read limit")
    || /d1[^.]{0,80}daily[^.]{0,80}row read limit/.test(text);
}

export function nextUtcMidnight(nowMs = Date.now()) {
  const now = new Date(nowMs);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

function dailyQuotaError(operation, blockedUntilMs, cause = undefined) {
  const error = new CommsHubError(503, "d1_daily_row_read_limit", `${operation} is paused because the D1 daily row-read limit has been reached.`, {
    cause,
    retryable: false,
    failureClass: "temporary",
    publicMessage: "Comms Hub storage is paused until the daily Cloudflare allowance resets.",
  });
  error.blockedUntil = new Date(blockedUntilMs).toISOString();
  error.retryAfterMs = Math.max(0, blockedUntilMs - Date.now());
  return error;
}

function bodyFingerprint(body) {
  const statements = Array.isArray(body?.batch) ? body.batch : [body];
  const normalised = statements
    .map((statement) => String(statement?.sql || "").replace(/\s+/g, " ").trim())
    .join("\n");
  return createHash("sha256").update(normalised).digest("hex").slice(0, 16);
}

function usageSummary(results) {
  return results.reduce((total, entry) => ({
    rowsRead: total.rowsRead + Number(entry?.meta?.rows_read || 0),
    rowsWritten: total.rowsWritten + Number(entry?.meta?.rows_written || 0),
    rowsReturned: total.rowsReturned + (Array.isArray(entry?.results) ? entry.results.length : 0),
  }), { rowsRead: 0, rowsWritten: 0, rowsReturned: 0 });
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
    if (isD1DailyRowReadLimit(detail)) {
      throw new CommsHubError(503, "d1_daily_row_read_limit", `${operation} failed: ${detail}.`, {
        retryable: false,
        failureClass: "temporary",
        publicMessage: "Comms Hub storage is paused until the daily Cloudflare allowance resets.",
      });
    }
    throw new CommsHubError(status === 401 || status === 403 ? 503 : 502, "cloudflare_api_failed", `${operation} failed${detail ? `: ${detail}` : ` with status ${status}`}.`, {
      retryable: [408, 425, 429, 500, 502, 503, 504].includes(status),
      failureClass: status >= 500 || status === 429 ? "temporary" : "permanent",
      publicMessage: "Cloudflare storage operation failed.",
    });
  }
  return payload;
}

export class D1Client {
  constructor(config, { fetchImpl = sharedFetchWithTimeout, now = () => Date.now() } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.accountId = config.cloudflareAccountId || "";
    this.quotaBlockedUntilMs = 0;
  }

  assertQuotaCircuit(operation) {
    const nowMs = Number(this.now());
    if (this.quotaBlockedUntilMs && nowMs >= this.quotaBlockedUntilMs) this.quotaBlockedUntilMs = 0;
    if (this.quotaBlockedUntilMs > nowMs) {
      const error = dailyQuotaError(operation, this.quotaBlockedUntilMs);
      error.retryAfterMs = this.quotaBlockedUntilMs - nowMs;
      throw error;
    }
  }

  openQuotaCircuit(operation, cause) {
    const nowMs = Number(this.now());
    this.quotaBlockedUntilMs = Math.max(this.quotaBlockedUntilMs, nextUtcMidnight(nowMs));
    const error = dailyQuotaError(operation, this.quotaBlockedUntilMs, cause);
    error.retryAfterMs = this.quotaBlockedUntilMs - nowMs;
    void logD1Warning("commsHub.d1.quotaCircuitOpened", {
      code: error.code,
      blockedUntil: error.blockedUntil,
      retryAfterMs: error.retryAfterMs,
    });
    return error;
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
    this.assertQuotaCircuit(operation);
    try {
      return await withRetry(async () => {
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
        const usage = usageSummary(results);
        if (usage.rowsRead >= HIGH_ROW_READ_WARNING) {
          void logD1Warning("commsHub.d1.highRowsRead", {
            operation,
            queryFingerprint: bodyFingerprint(body),
            statementCount: Array.isArray(body?.batch) ? body.batch.length : 1,
            ...usage,
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
    } catch (error) {
      if (error?.code === "d1_daily_row_read_limit" || isD1DailyRowReadLimit(error)) {
        throw this.openQuotaCircuit(operation, error);
      }
      throw error;
    }
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
