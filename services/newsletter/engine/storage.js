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
 * The AIMS morning window triggers generate, readiness and send sequentially,
 * but deliberately does not pass a volatile in-memory sessionId between route
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
 * Records the current state of a Brevo campaign for one issue — written
 * alongside the issue's html/text/metadata so (a) the monthly audit can
 * later pull real open/click/unsubscribe stats for that specific campaign
 * (see audits/utils/newsletterAudit.js), and (b) deliverNewsletterIssue can
 * detect an in-flight or already-sent campaign on retry rather than create
 * and send a second one.
 *
 * Called twice per successful send: once right after the Brevo campaign is
 * created (status: "created", campaignStatus: "draft"), before sendNow is
 * ever called, and again after sendNow succeeds (status: "dispatched").
 * `status` here is AIMS's own idempotency state, distinct from Brevo's own
 * `campaignStatus` string (draft/queued/sent/...).
 */
export async function recordCampaignDelivery({ profile, sessionId, campaignId, listId, status, campaignStatus, createdAt, sentAt, date = new Date() }) {
  const prefix = buildIssueKeyPrefix(profile, { date, sessionId });
  const key = `${prefix}/campaign.json`;
  const payload = {
    campaignId,
    listId,
    status,
    campaignStatus: campaignStatus || null,
    createdAt: createdAt || null,
    sentAt: sentAt || null,
    provider: "brevo",
    updatedAt: new Date().toISOString(),
  };
  const url = await putJson(profile.storage.htmlBucketKey, key, payload);
  return { key, url, delivery: payload };
}

/**
 * Reads back the delivery record written by recordCampaignDelivery, if any.
 * Returns { delivery: null } (never throws) when no record exists yet —
 * callers use this to distinguish "never attempted", "campaign created but
 * not yet sent" and "already dispatched" before deciding whether to call
 * Brevo again.
 */
export async function readCampaignDelivery({ profile, sessionId, date = new Date() }) {
  const prefix = buildIssueKeyPrefix(profile, { date, sessionId });
  const key = `${prefix}/campaign.json`;
  try {
    const raw = await getObjectAsText(profile.storage.htmlBucketKey, key);
    return { delivery: JSON.parse(raw) };
  } catch {
    return { delivery: null };
  }
}

export default { buildIssueKeyPrefix, storeNewsletterIssue, recordCampaignDelivery, readCampaignDelivery, findLatestIssueSessionId };
