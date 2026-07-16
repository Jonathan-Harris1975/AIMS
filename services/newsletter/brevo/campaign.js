// services/newsletter/brevo/campaign.js
//
// Turns a QA-passed, rendered newsletter issue into a Brevo send. Unlike
// the EmailOctopus integration this replaces, Brevo's v3 API documents full
// campaign creation and immediate sending, so this is a straight
// create -> sendNow flow rather than a manual-handoff fallback.
//
// Scheduling is owned entirely by MAST (a separate repository): this module
// never sets Brevo's own `scheduledAt` — POST /newsletter/send is called
// exactly when MAST wants the issue to go out, and sendNow fires immediately.

import { info, warn } from "../../../logger.js";
import { getObjectAsText } from "../../shared/utils/r2-client.js";
import { recordCampaignDelivery } from "../engine/storage.js";
import { ensureList } from "./audience.js";
import { ensureSender } from "./sender.js";
import { createCampaign, sendCampaignNow, getCampaign } from "./client.js";

/**
 * Delivers one rendered, QA-passed newsletter issue via Brevo.
 *
 * Preconditions checked, in order, before anything is sent:
 *   1. The configured sender exists and has completed Brevo's OTP
 *      verification (a manual, one-time step — see brevo/sender.js).
 *   2. The target list exists (created on first run if needed).
 * If either isn't ready, this returns a clear, actionable status instead of
 * attempting (and failing) a send.
 */
export async function deliverNewsletterIssue({ profile, sessionId, buildResult }) {
  if (!buildResult?.ok) {
    return { ok: false, status: "build_failed", error: "Cannot deliver — the newsletter build did not succeed." };
  }

  const { newsletter, storage } = buildResult;

  const sender = await ensureSender({ name: profile.brevo.fromName, email: profile.brevo.fromEmail });
  if (!sender.ok) {
    return { ok: false, status: "sender_error", error: sender.error };
  }
  if (!sender.verified) {
    warn("newsletter.brevo.send_blocked_unverified_sender", { sessionId, profileId: profile.id, senderId: sender.senderId });
    return {
      ok: false,
      status: "sender_pending_validation",
      senderId: sender.senderId,
      error:
        `Sender ${sender.email} exists in Brevo but has not completed OTP verification yet. ` +
        "Check the inbox for Brevo's verification email and confirm it (Brevo dashboard, or " +
        "PUT /v3/senders/{id}/validate) before this profile can send.",
    };
  }

  const list = await ensureList({ name: profile.brevo.listName, folderName: profile.brevo.folderName });
  if (!list.ok) {
    return { ok: false, status: "list_error", error: list.error };
  }

  // Prefer htmlUrl (the issue is already public in R2) to avoid Brevo's 1MB
  // inline-content ceiling; fall back to fetching + inlining if no public
  // URL is available for some reason.
  let contentField = storage?.htmlUrl ? { htmlUrl: storage.htmlUrl } : null;
  if (!contentField) {
    const html = await getObjectAsText(profile.storage.htmlBucketKey, `${storage?.prefix}/index.html`);
    contentField = { htmlContent: html };
  }

  const created = await createCampaign({
    name: `${profile.displayName} — ${new Date().toISOString().slice(0, 10)} — ${sessionId}`,
    subject: newsletter.subject,
    sender: { name: profile.brevo.fromName, email: profile.brevo.fromEmail },
    type: "classic",
    ...contentField,
    recipients: { listIds: [list.listId] },
  });

  if (!created.ok) {
    return { ok: false, status: "campaign_create_failed", error: created.error };
  }

  const campaignId = created.data?.id;
  info("newsletter.brevo.campaign_created", { sessionId, profileId: profile.id, campaignId, listId: list.listId });

  const sent = await sendCampaignNow(campaignId);
  if (!sent.ok) {
    warn("newsletter.brevo.send_now_failed", { sessionId, campaignId, error: sent.error });
    return { ok: false, status: "send_failed", campaignId, error: sent.error };
  }

  const sentAt = new Date().toISOString();
  await recordCampaignDelivery({ profile, sessionId, campaignId, listId: list.listId, sentAt });

  info("newsletter.brevo.campaign_sent", { sessionId, profileId: profile.id, campaignId });

  return { ok: true, status: "sent", campaignId, listId: list.listId, sentAt };
}

/**
 * Polls Brevo for a campaign's current status/performance.
 */
export async function getCampaignStatus(campaignId) {
  const result = await getCampaign(campaignId, { statistics: "globalStats" });
  if (!result.ok) return { ok: false, error: result.error };

  return {
    ok: true,
    id: result.data?.id,
    status: result.data?.status,
    sentDate: result.data?.sentDate || null,
    statistics: result.data?.statistics?.globalStats || null,
  };
}

export default { deliverNewsletterIssue, getCampaignStatus };
