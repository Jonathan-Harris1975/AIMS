// services/newsletter/brevo/client.js
//
// Thin, resilient client for the Brevo v3 REST API
// (https://developers.brevo.com/reference/quickstart-reference), covering
// only documented endpoints actually used by the newsletter engine:
//   - GET/POST /contacts/folders                    (folder lookup/creation)
//   - GET/POST /contacts/lists                        (list lookup/creation)
//   - POST /contacts/lists/{listId}/contacts/add       (audience sync)
//   - POST /contacts                                    (upsert one contact)
//   - GET/POST /senders                                 (sender lookup/creation)
//   - PUT /senders/{senderId}/validate                  (OTP verification)
//   - POST /emailCampaigns                              (create campaign)
//   - POST /emailCampaigns/{id}/sendNow                 (send immediately)
//   - GET  /emailCampaigns/{id}                          (status/report)
//
// Brevo's v3 API supports full campaign creation and immediate sending;
// see services/newsletter/brevo/campaign.js for the delivery workflow.

import axios from "axios";
import { info, warn, error as logError } from "../../../logger.js";
import { THRESHOLDS } from "../../../config/thresholds.js";

const BASE_URL = process.env.BREVO_API_BASE_URL || "https://api.brevo.com/v3";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function apiKey() {
  const key = String(process.env.BREVO_API_KEY || "").trim();
  if (!key) throw new Error("BREVO_API_KEY is not configured.");
  return key;
}

function client() {
  return axios.create({
    baseURL: BASE_URL,
    timeout: THRESHOLDS.newsletter.brevoTimeoutMs,
    headers: {
      "api-key": apiKey(),
      "content-type": "application/json",
      accept: "application/json",
    },
    validateStatus: () => true, // handled manually so retryable statuses are distinguishable
  });
}

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

/**
 * Issues one Brevo API request with retry/backoff. Brevo's rate-limit
 * response does not document a Retry-After header, so backoff is
 * exponential from retryBaseMs rather than header-driven.
 */
async function request(method, urlPath, { data, params, retries = THRESHOLDS.newsletter.brevoRetries, retryBaseMs = THRESHOLDS.newsletter.brevoRetryBaseMs } = {}) {
  const http = client();
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await http.request({ method, url: urlPath, data, params });

      if (response.status >= 200 && response.status < 300) {
        return { ok: true, status: response.status, data: response.data };
      }

      if (isRetryableStatus(response.status) && attempt < retries) {
        const waitMs = retryBaseMs * 2 ** attempt;
        warn("newsletter.brevo.retry", { method, urlPath, status: response.status, attempt: attempt + 1, waitMs });
        await sleep(waitMs);
        continue;
      }

      logError("newsletter.brevo.error", { method, urlPath, status: response.status, body: response.data });
      return {
        ok: false,
        status: response.status,
        error: response.data?.message || `Brevo API returned HTTP ${response.status}`,
        code: response.data?.code,
        data: response.data,
      };
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const waitMs = retryBaseMs * 2 ** attempt;
        warn("newsletter.brevo.network_retry", { method, urlPath, attempt: attempt + 1, waitMs, error: err.message });
        await sleep(waitMs);
        continue;
      }
    }
  }

  logError("newsletter.brevo.network_failed", { method, urlPath, error: lastError?.message });
  return { ok: false, status: 0, error: lastError?.message || "Brevo request failed" };
}

// ------------------------------------------------------------
// Folders / Lists (audience management — AIMS owns list creation)
// ------------------------------------------------------------
export async function getFolders({ limit, offset } = {}) {
  return request("GET", "/contacts/folders", { params: { limit, offset } });
}

export async function createFolder(name) {
  return request("POST", "/contacts/folders", { data: { name } });
}

export async function getLists({ limit, offset, folderId } = {}) {
  const urlPath = folderId ? `/contacts/folders/${encodeURIComponent(folderId)}/lists` : "/contacts/lists";
  return request("GET", urlPath, { params: { limit, offset } });
}

export async function getList(listId) {
  return request("GET", `/contacts/lists/${encodeURIComponent(listId)}`);
}

export async function createList({ name, folderId }) {
  return request("POST", "/contacts/lists", { data: { name, folderId } });
}

// ------------------------------------------------------------
// Contacts (audience sync)
// ------------------------------------------------------------
export async function createContact({ email, listIds, attributes, updateEnabled = true }) {
  return request("POST", "/contacts", { data: { email, listIds, attributes, updateEnabled } });
}

export async function addContactsToList(listId, emails = []) {
  return request("POST", `/contacts/lists/${encodeURIComponent(listId)}/contacts/add`, { data: { emails } });
}

// ------------------------------------------------------------
// Senders — Brevo requires a validated sender before a campaign can send.
// Validation itself needs an OTP delivered to the sender's inbox, which is
// a manual, one-time step — see brevo/campaign.js for how that surfaces.
// ------------------------------------------------------------
export async function getSenders() {
  return request("GET", "/senders");
}

export async function createSender({ name, email }) {
  return request("POST", "/senders", { data: { name, email } });
}

export async function validateSenderOtp(senderId, otp) {
  return request("PUT", `/senders/${encodeURIComponent(senderId)}/validate`, { data: { otp } });
}

// ------------------------------------------------------------
// Email campaigns
// ------------------------------------------------------------
export async function createCampaign(payload) {
  return request("POST", "/emailCampaigns", { data: payload });
}

export async function updateCampaign(campaignId, payload) {
  return request("PUT", `/emailCampaigns/${encodeURIComponent(campaignId)}`, { data: payload });
}

export async function sendCampaignNow(campaignId) {
  return request("POST", `/emailCampaigns/${encodeURIComponent(campaignId)}/sendNow`);
}

export async function sendTestEmail(campaignId, emailTo = []) {
  return request("POST", `/emailCampaigns/${encodeURIComponent(campaignId)}/sendTest`, { data: { emailTo } });
}

export async function getCampaign(campaignId, { statistics } = {}) {
  return request("GET", `/emailCampaigns/${encodeURIComponent(campaignId)}`, { params: { statistics } });
}

export async function getCampaigns({ limit, offset, type = "classic" } = {}) {
  return request("GET", "/emailCampaigns", { params: { limit, offset, type } });
}

export async function deleteCampaign(campaignId) {
  return request("DELETE", `/emailCampaigns/${encodeURIComponent(campaignId)}`);
}

export default {
  getFolders, createFolder, getLists, getList, createList,
  createContact, addContactsToList,
  getSenders, createSender, validateSenderOtp,
  createCampaign, updateCampaign, sendCampaignNow, sendTestEmail, getCampaign, getCampaigns, deleteCampaign,
};
