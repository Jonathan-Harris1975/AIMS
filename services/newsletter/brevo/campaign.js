// services/newsletter/brevo/campaign.js
//
// Turns a QA-passed, rendered newsletter issue into a Brevo send. Brevo's
// v3 API supports full campaign creation and immediate sending, so delivery
// is a straight create -> sendNow flow.
//
// Scheduling is owned entirely by MAST (a separate repository): this module
// never sets Brevo's own `scheduledAt` — POST /newsletter/send is called
// exactly when MAST wants the issue to go out, and sendNow fires immediately.

import { info, warn } from "../../../logger.js";
import { getObjectAsText } from "../../shared/utils/r2-client.js";
import { recordCampaignDelivery } from "../engine/storage.js";
import { ensureList } from "./audience.js";
import { ensureSender, inspectSender } from "./sender.js";
import { createCampaign, sendCampaignNow, getCampaign } from "./client.js";


export async function getNewsletterDeliveryReadiness({ profile }) {
  const sender = await inspectSender({ email: profile?.brevo?.fromEmail });
  if (!sender.ok) {
    return {
      ok: false,
      ready: false,
      stage: "sender",
      status: "sender_error",
      error: sender.error,
      providerStatus: sender.providerStatus || null,
      providerCode: sender.providerCode || null,
    };
  }

  const list = await ensureList({
    id: profile?.brevo?.listId,
    name: profile?.brevo?.listName,
    folderName: profile?.brevo?.folderName,
    allowCreate: false,
  });
  if (!list.ok) {
    return {
      ok: false,
      ready: false,
      stage: "audience",
      status: list.status || "list_error",
      error: list.error,
      providerStatus: list.providerStatus || null,
      providerCode: list.providerCode || null,
      sender,
    };
  }

  const audienceReady = Number(list.totalSubscribers || 0) > 0;
  const ready = Boolean(sender.exists && sender.verified && audienceReady);
  return {
    ok: true,
    ready,
    profileId: profile.id,
    sender: {
      email: sender.email,
      exists: sender.exists,
      verified: sender.verified,
      senderId: sender.senderId,
    },
    audience: {
      listId: list.listId,
      listName: list.name || profile.brevo.listName,
      source: list.source,
      totalSubscribers: list.totalSubscribers,
      uniqueSubscribers: list.uniqueSubscribers,
      ready: audienceReady,
    },
    blockers: [
      ...(!sender.exists ? ["sender_missing"] : []),
      ...(sender.exists && !sender.verified ? ["sender_unverified"] : []),
      ...(!audienceReady ? ["audience_empty"] : []),
    ],
  };
}

/**
 * Delivers one rendered, QA-passed newsletter issue via Brevo.
 *
 * Preconditions checked, in order, before anything is sent:
 *   1. The configured sender exists and has completed Brevo's OTP
 *      verification (a manual, one-time step — see brevo/sender.js).
 *   2. The configured target list already exists and contains at least one
 *      active subscriber. Production sends never create a replacement list.
 * If either isn't ready, this returns a clear, actionable status instead of
 * attempting (and failing) a send.
 */
export async function deliverNewsletterIssue({ profile, sessionId, buildResult }) {
  if (!buildResult?.ok) {
    return { ok: false, status: "build_failed", error: "Cannot deliver — the newsletter build did not succeed." };
  }

  const { newsletter, storage } = buildResult;

  let stage = "sender";
  try {
    const sender = await ensureSender({ name: profile.brevo.fromName, email: profile.brevo.fromEmail });
    if (!sender.ok) {
      return {
        ok: false,
        status: "sender_error",
        stage,
        error: sender.error,
        providerStatus: sender.providerStatus || null,
        providerCode: sender.providerCode || null,
      };
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

    stage = "audience";
    const list = await ensureList({
      id: profile.brevo.listId,
      name: profile.brevo.listName,
      folderName: profile.brevo.folderName,
      allowCreate: String(process.env.NEWSLETTER_BREVO_ALLOW_LIST_CREATE || "false").trim().toLowerCase() === "true",
    });
    if (!list.ok) {
      return {
        ok: false,
        status: list.status || "list_error",
        stage,
        error: list.error,
        providerStatus: list.providerStatus || null,
        providerCode: list.providerCode || null,
      };
    }
    if (Number(list.totalSubscribers || 0) < 1) {
      warn("newsletter.brevo.send_blocked_empty_audience", {
        sessionId,
        profileId: profile.id,
        listId: list.listId,
        listName: list.name || profile.brevo.listName,
        source: list.source,
      });
      return {
        ok: false,
        status: "audience_empty",
        stage,
        listId: list.listId,
        listName: list.name || profile.brevo.listName,
        error: "The selected Brevo list has no active subscribers. Configure the existing subscriber list ID or populate the list before sending.",
      };
    }

    // The public index.html uses the full website shell and is not email-safe.
    // Load the dedicated inline-CSS email.html artefact and send it to Brevo as
    // htmlContent. This removes any dependency on Brevo fetching an external
    // R2/custom-domain URL during campaign creation.
    stage = "content";
    const html = await getObjectAsText(profile.storage.htmlBucketKey, `${storage?.prefix}/email.html`);
    const htmlBytes = Buffer.byteLength(String(html || ""), "utf8");
    if (String(html || "").trim().length < 10) {
      return { ok: false, status: "content_error", stage, error: "Stored email.html is empty or too short for Brevo." };
    }
    if (htmlBytes >= 1_000_000) {
      return { ok: false, status: "content_error", stage, error: `Stored email.html is ${htmlBytes} bytes; Brevo campaign HTML must remain below 1 MB.` };
    }
    const contentField = { htmlContent: html };

    stage = "campaign-create";
    const created = await createCampaign({
      name: `${profile.displayName} — ${new Date().toISOString().slice(0, 10)} — ${sessionId}`,
      subject: newsletter.subject,
      sender: { name: profile.brevo.fromName, email: profile.brevo.fromEmail },
      type: "classic",
      previewText: newsletter.previewText,
      replyTo: profile.brevo.replyTo || profile.brevo.fromEmail,
      ...contentField,
      recipients: { listIds: [list.listId] },
    });

    if (!created.ok) {
      return {
        ok: false,
        status: "campaign_create_failed",
        stage,
        error: created.error,
        providerStatus: created.status || null,
        providerCode: created.code || null,
      };
    }

    const campaignId = created.data?.id;
    info("newsletter.brevo.campaign_created", { sessionId, profileId: profile.id, campaignId, listId: list.listId });

    stage = "campaign-send";
    const sent = await sendCampaignNow(campaignId);
    if (!sent.ok) {
      warn("newsletter.brevo.send_now_failed", {
        sessionId,
        campaignId,
        providerStatus: sent.status || null,
        providerCode: sent.code || null,
        error: sent.error,
      });
      return {
        ok: false,
        status: "send_failed",
        stage,
        campaignId,
        error: sent.error,
        providerStatus: sent.status || null,
        providerCode: sent.code || null,
      };
    }

    const sentAt = new Date().toISOString();
    await recordCampaignDelivery({ profile, sessionId, campaignId, listId: list.listId, sentAt });

    info("newsletter.brevo.campaign_sent", { sessionId, profileId: profile.id, campaignId });

    return {
      ok: true,
      status: "sent",
      campaignId,
      listId: list.listId,
      audienceSubscribers: list.totalSubscribers,
      sentAt,
    };
  } catch (err) {
    warn("newsletter.brevo.delivery_exception", { sessionId, profileId: profile.id, stage, error: err?.message || String(err) });
    return { ok: false, status: "delivery_exception", stage, error: err?.message || String(err) };
  }
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

export default { deliverNewsletterIssue, getNewsletterDeliveryReadiness, getCampaignStatus };
