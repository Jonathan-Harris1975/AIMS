// services/newsletter/emailoctopus/client.js
//
// Thin, resilient client for the EmailOctopus v2 REST API
// (https://emailoctopus.com/api-documentation/v2), covering only endpoints
// that API actually documents as of 2026-07-15:
//   - GET  /lists, GET /lists/{list_id}
//   - PUT  /lists/{list_id}/contacts               (upsert one contact)
//   - PUT  /lists/{list_id}/contacts/batch          (upsert many contacts)
//   - GET  /lists/{list_id}/contacts
//   - POST /automations/{automation_id}/queue       (trigger an automation)
//   - GET  /campaigns, GET /campaigns/{id}
//   - GET  /campaigns/{id}/reports, /reports/links, /reports/summary
//
// IMPORTANT — documented limitation: the v2 API does not expose a
// create-campaign or schedule-campaign endpoint. There is therefore no
// `createCampaign()` call to a real endpoint here. See
// emailoctopus/campaign.js for how the newsletter engine works around this.

import axios from "axios";
import { info, warn, error as logError } from "../../../logger.js";
import { THRESHOLDS } from "../../../config/thresholds.js";

const BASE_URL = process.env.EMAILOCTOPUS_API_BASE_URL || "https://api.emailoctopus.com";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function apiKey() {
  const key = String(process.env.EMAILOCTOPUS_API_KEY || "").trim();
  if (!key) throw new Error("EMAILOCTOPUS_API_KEY is not configured.");
  return key;
}

function client() {
  return axios.create({
    baseURL: BASE_URL,
    timeout: THRESHOLDS.newsletter.emailOctopusTimeoutMs,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    validateStatus: () => true, // handled manually so we can distinguish retryable statuses
  });
}

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

/**
 * Issues one EmailOctopus API request with retry/backoff, honouring the
 * documented `X-RateLimit-Retry-After` header on 429 responses.
 */
async function request(method, urlPath, { data, params, retries = THRESHOLDS.newsletter.emailOctopusRetries, retryBaseMs = THRESHOLDS.newsletter.emailOctopusRetryBaseMs } = {}) {
  const http = client();
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await http.request({ method, url: urlPath, data, params });

      if (response.status >= 200 && response.status < 300) {
        return { ok: true, status: response.status, data: response.data };
      }

      if (isRetryableStatus(response.status) && attempt < retries) {
        const retryAfterHeader = Number(response.headers?.["x-ratelimit-retry-after"]);
        const waitMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
          ? retryAfterHeader * 1000
          : retryBaseMs * 2 ** attempt;
        warn("newsletter.emailoctopus.retry", { method, urlPath, status: response.status, attempt: attempt + 1, waitMs });
        await sleep(waitMs);
        continue;
      }

      logError("newsletter.emailoctopus.error", {
        method, urlPath, status: response.status, body: response.data,
      });
      return {
        ok: false,
        status: response.status,
        error: response.data?.detail || response.data?.title || `EmailOctopus API returned HTTP ${response.status}`,
        data: response.data,
      };
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const waitMs = retryBaseMs * 2 ** attempt;
        warn("newsletter.emailoctopus.network_retry", { method, urlPath, attempt: attempt + 1, waitMs, error: err.message });
        await sleep(waitMs);
        continue;
      }
    }
  }

  logError("newsletter.emailoctopus.network_failed", { method, urlPath, error: lastError?.message });
  return { ok: false, status: 0, error: lastError?.message || "EmailOctopus request failed" };
}

// ------------------------------------------------------------
// Lists
// ------------------------------------------------------------
export async function getLists({ limit } = {}) {
  return request("GET", "/lists", { params: { limit } });
}

export async function getList(listId) {
  return request("GET", `/lists/${encodeURIComponent(listId)}`);
}

// ------------------------------------------------------------
// Contacts (audience selection / sync)
// ------------------------------------------------------------
export async function upsertContact(listId, { emailAddress, fields, tags, status = "subscribed" }) {
  return request("PUT", `/lists/${encodeURIComponent(listId)}/contacts`, {
    data: { email_address: emailAddress, fields, tags, status },
  });
}

export async function upsertContactsBatch(listId, contacts = []) {
  return request("PUT", `/lists/${encodeURIComponent(listId)}/contacts/batch`, {
    data: { contacts },
  });
}

export async function getContacts(listId, { status, tag, limit, startingAfter } = {}) {
  return request("GET", `/lists/${encodeURIComponent(listId)}/contacts`, {
    params: { status, tag, limit, starting_after: startingAfter },
  });
}

// ------------------------------------------------------------
// Automations — the documented delivery mechanism (see campaign.js)
// ------------------------------------------------------------
export async function queueAutomation(automationId, contactId) {
  return request("POST", `/automations/${encodeURIComponent(automationId)}/queue`, {
    data: { contact_id: contactId },
  });
}

// ------------------------------------------------------------
// Campaigns — read-only in the documented v2 API
// ------------------------------------------------------------
export async function getCampaigns({ limit, startingAfter } = {}) {
  return request("GET", "/campaigns", { params: { limit, starting_after: startingAfter } });
}

export async function getCampaign(campaignId) {
  return request("GET", `/campaigns/${encodeURIComponent(campaignId)}`);
}

export async function getCampaignReportsSummary(campaignId) {
  return request("GET", `/campaigns/${encodeURIComponent(campaignId)}/reports/summary`);
}

export async function getCampaignReportsLinks(campaignId) {
  return request("GET", `/campaigns/${encodeURIComponent(campaignId)}/reports/links`);
}

export async function getCampaignReports(campaignId, status, { limit, startingAfter } = {}) {
  return request("GET", `/campaigns/${encodeURIComponent(campaignId)}/reports`, {
    params: { status, limit, starting_after: startingAfter },
  });
}

/**
 * Defensive, feature-flagged attempt at campaign creation. Disabled by
 * default (THRESHOLDS.newsletter.attemptUndocumentedCampaignCreate) because
 * no such endpoint is documented; this exists only so ops can point it at a
 * confirmed endpoint later without a code change, and it fails loudly and
 * safely rather than silently no-op'ing if enabled against a 404.
 */
export async function attemptCreateCampaign(payload) {
  if (!THRESHOLDS.newsletter.attemptUndocumentedCampaignCreate) {
    return { ok: false, status: 0, error: "Campaign creation is not enabled — EmailOctopus v2 does not document a create-campaign endpoint." };
  }
  const result = await request("POST", "/campaigns", { data: payload, retries: 0 });
  if (!result.ok) {
    logError("newsletter.emailoctopus.campaign_create_unsupported", { status: result.status, error: result.error });
  }
  return result;
}

export default {
  getLists, getList,
  upsertContact, upsertContactsBatch, getContacts,
  queueAutomation,
  getCampaigns, getCampaign, getCampaignReportsSummary, getCampaignReportsLinks, getCampaignReports,
  attemptCreateCampaign,
};
