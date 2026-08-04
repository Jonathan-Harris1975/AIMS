import { createHash } from "node:crypto";
import { CommsHubError } from "../errors.js";

async function sharedFetch(url, options) {
  const { fetchWithTimeout } = await import("../../shared/http-client.js");
  return fetchWithTimeout(url, options);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function messages(payload) {
  return [...(payload?.errors || []), ...(payload?.messages || [])]
    .map((entry) => String(entry?.message || entry || "").trim())
    .filter(Boolean)
    .join("; ")
    .slice(0, 1000);
}

export class CloudflareBackupClient {
  constructor(config, { fetchImpl = sharedFetch, sleepImpl = sleep } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.sleepImpl = sleepImpl;
  }

  endpoint(databaseId, operation) {
    return `${this.config.cloudflareApiBaseUrl}/accounts/${this.config.cloudflareAccountId}/d1/database/${databaseId}/${operation}`;
  }

  async requestJson(url, body) {
    const response = await this.fetchImpl(url, {
      method: "POST",
      timeout: this.config.backupRequestTimeoutMs,
      headers: {
        authorization: `Bearer ${this.config.d1ApiToken}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.success === false) {
      throw new CommsHubError(response.status === 429 ? 429 : 502, "cloudflare_backup_api_failed", `Cloudflare backup API failed${messages(payload) ? `: ${messages(payload)}` : ` with HTTP ${response.status}`}.`, {
        retryable: response.status === 429 || response.status >= 500,
        failureClass: response.status === 429 || response.status >= 500 ? "temporary" : "permanent",
        publicMessage: "Cloudflare backup operation failed.",
      });
    }
    return payload.result || {};
  }

  async exportDatabase(databaseId = this.config.d1DatabaseId) {
    const url = this.endpoint(databaseId, "export");
    let result = await this.requestJson(url, { output_format: "polling" });
    for (let attempt = 0; attempt < this.config.backupPollAttempts; attempt += 1) {
      if (result.status === "error" || result.error) {
        throw new CommsHubError(502, "d1_export_failed", `D1 export failed: ${result.error || "unknown error"}.`, {
          failureClass: "recoverable",
          publicMessage: "D1 export failed.",
        });
      }
      const signedUrl = result?.result?.signed_url || result.signed_url;
      if (result.status === "complete" && signedUrl) {
        const response = await this.fetchImpl(signedUrl, { method: "GET", timeout: this.config.backupRequestTimeoutMs });
        if (!response.ok) throw new CommsHubError(502, "d1_export_download_failed", `D1 export download failed with HTTP ${response.status}.`);
        return {
          sql: Buffer.from(await response.arrayBuffer()),
          bookmark: result.at_bookmark || null,
          filename: result?.result?.filename || result.filename || "comms-hub-export.sql",
        };
      }
      if (!result.at_bookmark) {
        throw new CommsHubError(502, "d1_export_response_invalid", "D1 export did not return a bookmark or signed URL.");
      }
      await this.sleepImpl(this.config.backupPollMs);
      result = await this.requestJson(url, { output_format: "polling", current_bookmark: result.at_bookmark });
    }
    throw new CommsHubError(504, "d1_export_timeout", "D1 export did not complete within the configured polling window.", {
      retryable: true,
      failureClass: "temporary",
      publicMessage: "D1 export timed out.",
    });
  }

  async importDatabase(sqlBuffer, targetDatabaseId) {
    if (!targetDatabaseId || targetDatabaseId === this.config.d1DatabaseId) {
      throw new CommsHubError(400, "restore_target_unsafe", "Restore validation requires a separate non-production D1 database.", {
        failureClass: "permanent",
        publicMessage: "Restore target must be an isolated database.",
      });
    }
    const sql = Buffer.isBuffer(sqlBuffer) ? sqlBuffer : Buffer.from(sqlBuffer);
    const etag = createHash("md5").update(sql).digest("hex");
    const url = this.endpoint(targetDatabaseId, "import");
    const initial = await this.requestJson(url, { action: "init", etag });
    if (!initial.upload_url || !initial.filename) {
      throw new CommsHubError(502, "d1_import_init_invalid", "D1 import did not return an upload URL and filename.");
    }
    const upload = await this.fetchImpl(initial.upload_url, {
      method: "PUT",
      timeout: this.config.backupRequestTimeoutMs,
      body: sql,
    });
    if (!upload.ok) throw new CommsHubError(502, "d1_import_upload_failed", `D1 import upload failed with HTTP ${upload.status}.`);
    const returnedEtag = String(upload.headers.get("etag") || "").replace(/^"|"$/g, "");
    if (returnedEtag && returnedEtag !== etag) {
      throw new CommsHubError(502, "d1_import_etag_mismatch", "D1 import upload ETag did not match the SQL payload.");
    }
    let result = await this.requestJson(url, { action: "ingest", etag, filename: initial.filename });
    for (let attempt = 0; attempt < this.config.backupPollAttempts; attempt += 1) {
      if (result.status === "complete" || result.success === true) return result;
      if (result.status === "error" || (result.error && result.error !== "Not currently importing anything.")) {
        throw new CommsHubError(502, "d1_import_failed", `D1 import failed: ${result.error || "unknown error"}.`);
      }
      if (!result.at_bookmark) throw new CommsHubError(502, "d1_import_response_invalid", "D1 import did not return a polling bookmark.");
      await this.sleepImpl(this.config.backupPollMs);
      result = await this.requestJson(url, { action: "poll", current_bookmark: result.at_bookmark });
    }
    throw new CommsHubError(504, "d1_import_timeout", "D1 restore validation timed out.", {
      retryable: true,
      failureClass: "temporary",
    });
  }

  async queryDatabase(databaseId, sql, params = []) {
    const result = await this.requestJson(this.endpoint(databaseId, "query"), { sql, params });
    const first = Array.isArray(result) ? result[0] : result;
    if (first?.success === false) throw new CommsHubError(502, "restore_validation_query_failed", "Restore validation query failed.");
    return Array.isArray(first?.results) ? first.results : [];
  }
}

export default CloudflareBackupClient;
