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
 * The AIMS morning window triggers generate and send sequentially, but
 * deliberately does not pass a volatile in-memory sessionId between route
 * calls. Send must therefore be able
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
function campaignDeliveryKey(profile, { sessionId, date = new Date(), prefix = "" } = {}) {
  const issuePrefix = String(prefix || "").trim() || buildIssueKeyPrefix(profile, { date, sessionId });
  return `${issuePrefix}/campaign.json`;
}

function isMissingObjectError(error) {
  const status = Number(error?.$metadata?.httpStatusCode || error?.statusCode || error?.status || 0);
  const code = String(error?.name || error?.code || "").toLowerCase();
  const message = String(error?.message || error || "").toLowerCase();
  return status === 404 || /nosuchkey|notfound|no such key|does not exist/.test(`${code} ${message}`);
}

/**
 * Reads the durable Brevo hand-off record for an issue. This is the newsletter
 * delivery idempotency boundary: a route retry must resume the same campaign,
 * never create a second campaign for the same generated issue.
 */
export async function readCampaignDelivery({ profile, sessionId, date = new Date(), prefix = "" }) {
  const key = campaignDeliveryKey(profile, { sessionId, date, prefix });
  try {
    const raw = await getObjectAsText(profile.storage.htmlBucketKey, key);
    return { key, delivery: JSON.parse(raw) };
  } catch (error) {
    if (isMissingObjectError(error)) return { key, delivery: null };
    throw error;
  }
}

/**
 * Persists every Brevo delivery transition, including campaign creation before
 * sendNow. Recording the campaign ID before dispatch lets a failed or repeated
 * request safely resume that campaign instead of mailing subscribers twice.
 */
export async function recordCampaignDelivery({
  profile,
  sessionId,
  campaignId,
  listId,
  sentAt = null,
  createdAt = null,
  status = "created",
  campaignStatus = null,
  date = new Date(),
  prefix = "",
}) {
  const key = campaignDeliveryKey(profile, { sessionId, date, prefix });
  const payload = {
    campaignId: Number(campaignId),
    listId: Number(listId),
    provider: "brevo",
    status,
    campaignStatus,
    createdAt: createdAt || new Date().toISOString(),
    sentAt: sentAt || null,
    updatedAt: new Date().toISOString(),
  };
  const url = await putJson(profile.storage.htmlBucketKey, key, payload);
  return { key, url, delivery: payload };
}

export default {
  buildIssueKeyPrefix,
  storeNewsletterIssue,
  recordCampaignDelivery,
  readCampaignDelivery,
  findLatestIssueSessionId,
};
