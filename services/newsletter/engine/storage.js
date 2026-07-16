// services/newsletter/engine/storage.js
//
// Persists newsletter issues to R2. Deliberately reuses the existing `blog`
// bucket (HTML/text/metadata) and `blogImages` bucket (hero art) rather than
// provisioning new infrastructure — see services/newsletter/config/profiles.js.

import { uploadText, putJson } from "../../shared/utils/r2-client.js";

function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function buildIssueKeyPrefix(profile, { date = new Date(), sessionId } = {}) {
  const day = dateKey(date);
  return `${profile.storage.keyPrefix}/${day}/${sessionId}`;
}

/**
 * Stores the HTML, plaintext and metadata for one issue under a single key
 * prefix so an issue's artefacts are easy to locate/audit together.
 */
export async function storeNewsletterIssue({ profile, sessionId, html, plaintext, metadata, date = new Date() }) {
  const prefix = buildIssueKeyPrefix(profile, { date, sessionId });
  const bucketKey = profile.storage.htmlBucketKey;

  const [htmlUrl, textUrl, metaUrl] = await Promise.all([
    uploadText(bucketKey, `${prefix}/index.html`, html, "text/html; charset=utf-8"),
    uploadText(bucketKey, `${prefix}/index.txt`, plaintext, "text/plain; charset=utf-8"),
    putJson(bucketKey, `${prefix}/metadata.json`, metadata),
  ]);

  return { prefix, htmlUrl, textUrl, metaUrl };
}

/**
 * Records that an issue was handed off to Brevo for delivery — written
 * alongside the issue's html/text/metadata so the monthly audit can later
 * pull real open/click/unsubscribe stats for that specific campaign (see
 * audits/utils/newsletterAudit.js).
 */
export async function recordCampaignDelivery({ profile, sessionId, campaignId, listId, sentAt, date = new Date() }) {
  const prefix = buildIssueKeyPrefix(profile, { date, sessionId });
  const key = `${prefix}/campaign.json`;
  const url = await putJson(profile.storage.htmlBucketKey, key, { campaignId, listId, sentAt, provider: "brevo" });
  return { key, url };
}

export default { buildIssueKeyPrefix, storeNewsletterIssue, recordCampaignDelivery };
