// services/newsletter/emailoctopus/campaign.js
//
// Turns a QA-passed, rendered newsletter issue into an EmailOctopus send.
//
// Documented-API reality check (see client.js header): EmailOctopus v2 does
// not expose campaign creation/scheduling. So this module's job is:
//   1. Make sure the target audience (list) reflects who should receive it
//      (documented: upsert contacts + tags).
//   2. Try campaign creation only if explicitly enabled via
//      EMAILOCTOPUS_ATTEMPT_CAMPAIGN_CREATE (off by default — see
//      THRESHOLDS.newsletter.attemptUndocumentedCampaignCreate).
//   3. If that's unavailable (the default), store a complete "pending
//      campaign" packet in R2 and return a status of `pending_manual_send`
//      so the caller (and MAST, in its own repo) can surface that a human
//      needs to paste the stored HTML into an EmailOctopus campaign, or
//      trigger a pre-built EmailOctopus Automation configured with the
//      "Started via API" trigger (fully documented — automations/{id}/queue).
//   4. Track status for anything that *does* get a real campaign ID, via
//      the documented read/report endpoints.

import { info, warn } from "../../../logger.js";
import { nextSendTimeUtc } from "../utils/scheduling.js";
import { storePendingCampaignPacket } from "../engine/storage.js";
import {
  upsertContactsBatch,
  queueAutomation,
  attemptCreateCampaign,
  getCampaign,
  getCampaignReportsSummary,
} from "./client.js";

/**
 * Ensures the newsletter's target audience is in EmailOctopus, tagged so it
 * can be segmented/reported on. `subscribers` is optional — most of the
 * time list membership is already managed by the existing JotForm ->
 * MailChimp-style signup funnel feeding into EmailOctopus directly; this is
 * for cases where AIMS itself is the source of truth for a subscriber batch
 * (e.g. a migration or a programmatic opt-in flow).
 */
export async function syncAudience({ profile, subscribers = [] }) {
  const listId = profile.emailOctopus.listId;
  if (!listId) return { ok: false, error: "No EmailOctopus list configured for this profile." };
  if (!subscribers.length) return { ok: true, synced: 0, skipped: true };

  const contacts = subscribers.map((s) => ({
    email_address: s.emailAddress,
    tags: [profile.emailOctopus.audienceTag],
    status: "subscribed",
  }));

  const result = await upsertContactsBatch(listId, contacts);
  if (!result.ok) return { ok: false, error: result.error };

  const successCount = Array.isArray(result.data?.success) ? result.data.success.length : 0;
  const errorCount = Array.isArray(result.data?.errors) ? result.data.errors.length : 0;
  info("newsletter.emailoctopus.audience_synced", { listId, successCount, errorCount });

  return { ok: true, synced: successCount, failed: errorCount, errors: result.data?.errors || [] };
}

/**
 * Attempts to deliver a rendered, QA-passed newsletter issue. Always
 * succeeds in the sense of leaving a durable, actionable artefact behind —
 * either a real campaign (if/when the API supports it) or a stored packet
 * plus an optional automation trigger.
 */
export async function deliverNewsletterIssue({ profile, sessionId, buildResult, scheduledFor }) {
  if (!buildResult?.ok) {
    return { ok: false, status: "build_failed", error: "Cannot deliver — the newsletter build did not succeed." };
  }

  const { newsletter, storage } = buildResult;
  const sendAt = scheduledFor ? new Date(scheduledFor) : nextSendTimeUtc();

  const campaignPayload = {
    name: `${profile.displayName} — ${sendAt.toISOString().slice(0, 10)}`,
    subject: newsletter.subject,
    from: {
      name: profile.emailOctopus.fromName,
      email_address: profile.emailOctopus.fromEmail,
    },
    to: [profile.emailOctopus.listId].filter(Boolean),
    content: { html: undefined }, // populated from R2 at send time, not inlined into the packet
    scheduled_for: sendAt.toISOString(),
  };

  // Step 1 — try real campaign creation (off by default; see client.js).
  const attempt = await attemptCreateCampaign({ ...campaignPayload, content: { html: "SEE_R2_HTML_URL" }, htmlUrl: storage?.htmlUrl });
  if (attempt.ok) {
    info("newsletter.emailoctopus.campaign_created", { sessionId, campaignId: attempt.data?.id });
    return { ok: true, status: "campaign_created", campaignId: attempt.data?.id, raw: attempt.data };
  }

  // Step 2 — documented fallback: persist the full packet for manual send,
  // and (if configured) queue a pre-built automation as an immediate,
  // fully-API-driven delivery path for a single test/system contact.
  const packet = {
    profileId: profile.id,
    sessionId,
    subject: newsletter.subject,
    previewText: newsletter.previewText,
    htmlUrl: storage?.htmlUrl,
    textUrl: storage?.textUrl,
    metadataUrl: storage?.metaUrl,
    listId: profile.emailOctopus.listId,
    fromName: profile.emailOctopus.fromName,
    fromEmail: profile.emailOctopus.fromEmail,
    scheduledFor: sendAt.toISOString(),
    reason: attempt.error,
    createdAt: new Date().toISOString(),
  };

  const stored = await storePendingCampaignPacket({ profile, sessionId, packet });

  warn("newsletter.emailoctopus.manual_action_required", {
    sessionId,
    profileId: profile.id,
    packetUrl: stored.url,
    scheduledFor: sendAt.toISOString(),
    reason: attempt.error,
  });

  let automationQueueResult = null;
  if (profile.emailOctopus.automationId) {
    // Automations require a contact_id — this only fires when a specific
    // system/test contact is configured; it is not a substitute for a full
    // list send, which is the part the documented API can't yet do.
    const testContactId = String(process.env[`NEWSLETTER_${profile.id.toUpperCase().replace(/-/g, "_")}_AUTOMATION_TEST_CONTACT_ID`] || "").trim();
    if (testContactId) {
      automationQueueResult = await queueAutomation(profile.emailOctopus.automationId, testContactId);
    }
  }

  return {
    ok: true,
    status: "pending_manual_send",
    packetUrl: stored.url,
    scheduledFor: sendAt.toISOString(),
    automationQueueResult,
    note:
      "EmailOctopus v2 does not document a campaign-creation endpoint, so this issue was stored " +
      "as a ready-to-send packet in R2 instead of being sent automatically. Paste the HTML at " +
      `${storage?.htmlUrl || "(see packet)"} into an EmailOctopus campaign, or configure ` +
      "NEWSLETTER_AI_EDGE_AUTOMATION_ID with a pre-built Automation to automate this step.",
  };
}

/**
 * Polls status/performance for a campaign that does have a real ID (either
 * created before the API gap existed, created manually and back-filled, or
 * created via a future documented endpoint).
 */
export async function getCampaignStatus(campaignId) {
  const [campaign, summary] = await Promise.all([
    getCampaign(campaignId),
    getCampaignReportsSummary(campaignId),
  ]);

  if (!campaign.ok) return { ok: false, error: campaign.error };

  return {
    ok: true,
    id: campaign.data?.id,
    status: campaign.data?.status,
    sentAt: campaign.data?.sent_at || null,
    summary: summary.ok ? summary.data : null,
  };
}

export default { syncAudience, deliverNewsletterIssue, getCampaignStatus };
