// services/newsletter/engine/storage.js
//
// Persists newsletter issues to R2. Deliberately reuses the existing `blog`
// bucket (HTML/text/metadata) and `blogImages` bucket (hero art) rather than
// provisioning new infrastructure — see services/newsletter/config/profiles.js.

import { uploadText, putJson, listKeys, getObjectAsText } from "../../shared/utils/r2-client.js";

function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function buildIssueKeyPrefix(profile, { date = new Date(), sessionId } = {}) {
  const day = dateKey(date);
  return `${profile.storage.keyPrefix}/${day}/${sessionId}`;
}

/**
 * Finds the sessionId to deliver when the caller doesn't already know it.
 *
 * MAST triggers /newsletter/generate and /newsletter/send as two separately
 * scheduled jobs (09:20 and 10:00) with no mechanism to pass generate's
 * timestamp-based sessionId into send's request body — so send must be able
 * to resolve "today's issue" on its own. Lists the day's key prefix, reads
 * each issue's metadata.json, and returns the sessionId of whichever has
 * the most recent generatedAt (normally there's exactly one per day; if
 * generate ran more than once, the newest wins rather than an arbitrary one).
 */
export async function findLatestIssueSessionId(profile, { date = new Date() } = {}) {
  const bucketKey = profile.storage.htmlBucketKey;
  const dayPrefix = `${profile.storage.keyPrefix}/${dateKey(date)}/`;
  const keys = await listKeys(bucketKey, dayPrefix);
  const metadataKeys = keys.filter((k) => k.endsWith("/metadata.json"));

  if (!metadataKeys.length) return null;

  let best = null;
  for (const key of metadataKeys) {
    // key looks like "<keyPrefix>/<date>/<sessionId>/metadata.json"
    const sessionId = key.slice(dayPrefix.length).split("/")[0];
    if (!sessionId) continue;
    try {
      const metadata = JSON.parse(await getObjectAsText(bucketKey, key));
      const generatedAt = metadata.generatedAt ? new Date(metadata.generatedAt).getTime() : 0;
      if (!best || generatedAt > best.generatedAt) {
        best = { sessionId, generatedAt };
      }
    } catch {
      // Skip unreadable/corrupt metadata rather than fail the whole lookup.
    }
  }

  return best?.sessionId || null;
}

/**
 * Stores the HTML, plaintext and metadata for one issue under a single key
 * prefix so an issue's artefacts are easy to locate/audit together.
 */
export async function storeNewsletterIssue({ profile, sessionId, html, emailHtml, plaintext, metadata, date = new Date() }) {
  const prefix = buildIssueKeyPrefix(profile, { date, sessionId });
  const bucketKey = profile.storage.htmlBucketKey;

  const [htmlUrl, emailUrl, textUrl, metaUrl] = await Promise.all([
    uploadText(bucketKey, `${prefix}/index.html`, html, "text/html; charset=utf-8"),
    uploadText(bucketKey, `${prefix}/email.html`, emailHtml || html, "text/html; charset=utf-8"),
    uploadText(bucketKey, `${prefix}/index.txt`, plaintext, "text/plain; charset=utf-8"),
    putJson(bucketKey, `${prefix}/metadata.json`, metadata),
  ]);

  return { prefix, htmlUrl, emailUrl, textUrl, metaUrl };
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

export default { buildIssueKeyPrefix, storeNewsletterIssue, recordCampaignDelivery, findLatestIssueSessionId };
