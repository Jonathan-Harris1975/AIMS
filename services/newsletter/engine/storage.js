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
 * Stores a "pending campaign" packet — the complete, ready-to-send payload
 * — for the manual-handoff delivery path used because EmailOctopus v2 does
 * not document a campaign-creation endpoint. See services/newsletter/README.md
 * and emailoctopus/campaign.js.
 */
export async function storePendingCampaignPacket({ profile, sessionId, packet, date = new Date() }) {
  const prefix = `${profile.storage.keyPrefix}/pending-campaigns`;
  const key = `${prefix}/${dateKey(date)}-${sessionId}.json`;
  const url = await putJson(profile.storage.htmlBucketKey, key, packet);
  return { key, url };
}

export default { buildIssueKeyPrefix, storeNewsletterIssue, storePendingCampaignPacket };
