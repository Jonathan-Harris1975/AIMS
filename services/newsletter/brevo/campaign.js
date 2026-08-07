// services/newsletter/brevo/campaign.js
//
// Turns a QA-passed, rendered newsletter issue into a Brevo send. Brevo's
// v3 API supports full campaign creation and immediate sending, so delivery
// is a straight create -> sendNow flow.
//
// Scheduling is owned entirely by MAST (a separate repository): this module
// never sets Brevo's own `scheduledAt` — POST /newsletter/send is called
// exactly when MAST wants the issue to go out, and sendNow fires immediately.
//
// Idempotency: MAST (or an operator) may call /newsletter/send more than
// once for the same issue — a retried request after a timeout, a manual
// re-trigger, etc. deliverNewsletterIssue therefore records its own delivery
// state (see engine/storage.js) *before* calling Brevo's sendNow, and checks
// that record on every call before creating anything new:
//   - no record                -> create the campaign, then send it
//   - record with status "created" (draft only, sendNow never confirmed)
//                               -> reuse the existing campaignId, call
//                                  sendNow again rather than create a
//                                  second campaign
//   - record with status "dispatched" -> already sent; return the stored
//                                  result without calling Brevo again
// If the durable record write itself fails right after creating the draft,
// the newly created Brevo campaign is deleted rather than left as an
// unrecorded draft Brevo could send with no idempotency guard watching it.

import { info, warn } from "../../../logger.js";
import { getObjectAsText } from "../../shared/utils/r2-client.js";
import { readCampaignDelivery, recordCampaignDelivery } from "../engine/storage.js";
import { ensureList } from "./audience.js";
import { ensureSender, inspectSender } from "./sender.js";
import { createCampaign, sendCampaignNow, getCampaign, deleteCampaign } from "./client.js";


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
 *   1. No earlier delivery attempt for this sessionId already dispatched
 *      (or is sitting as an unsent draft) — see idempotency note above.
 *   2. The configured sender exists and has completed Brevo's OTP
 *      verification (a manual, one-time step — see brevo/sender.js).
 *   3. The configured target list already exists and contains at least one
 *      active subscriber. Production sends never create a replacement list.
 * If any of these isn't ready, this returns a clear, actionable status
 * instead of attempting (and failing, or duplicating) a send.
 *
 * `deps` lets tests substitute every external adapter; production callers
 * should omit it and get the real Brevo/R2 implementations.
 */
export async function deliverNewsletterIssue({ profile, sessionId, buildResult, date }, deps = {}) {
  const {
    getObjectAsText: readText = getObjectAsText,
    readCampaignDelivery: readDelivery = readCampaignDelivery,
    recordCampaignDelivery: recordDelivery = recordCampaignDelivery,
    ensureList: doEnsureList = ensureList,
    ensureSender: doEnsureSender = ensureSender,
    createCampaign: doCreateCampaign = createCampaign,
    sendCampaignNow: doSendCampaignNow = sendCampaignNow,
    getCampaign: doGetCampaign = getCampaign,
    deleteCampaign: doDeleteCampaign = deleteCampaign,
  } = deps;

  if (!buildResult?.ok) {
    return { ok: false, status: "build_failed", error: "Cannot deliver — the newsletter build did not succeed." };
  }

  const { newsletter, storage } = buildResult;

  let stage = "delivery-record";
  try {
    const { delivery } = await readDelivery({ profile, sessionId, date });

    if (delivery?.status === "dispatched") {
      info("newsletter.brevo.send_skipped_already_dispatched", { sessionId, profileId: profile.id, campaignId: delivery.campaignId });
      return {
        ok: true,
        status: "sent",
        campaignId: delivery.campaignId,
        listId: delivery.listId,
        campaignStatus: delivery.campaignStatus,
        sentAt: delivery.sentAt,
        alreadyDispatched: true,
      };
    }

    stage = "sender";
    const sender = await doEnsureSender({ name: profile.brevo.fromName, email: profile.brevo.fromEmail });
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
    const list = await doEnsureList({
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

    let campaignId = delivery?.campaignId || null;

    if (!campaignId) {
      // No prior attempt recorded for this sessionId — create a fresh
      // campaign. The public index.html uses the full website shell and is
      // not email-safe, so the caller is expected to have already loaded the
      // dedicated inline-CSS email.html artefact into buildResult.emailHtml;
      // this only falls back to fetching it directly when that's missing.
      stage = "content";
      const html = buildResult.emailHtml
        ?? (storage?.prefix ? await readText(profile.storage.htmlBucketKey, `${storage.prefix}/email.html`) : null);
      const htmlBytes = Buffer.byteLength(String(html || ""), "utf8");
      if (String(html || "").trim().length < 10) {
        return { ok: false, status: "content_error", stage, error: "Stored email.html is empty or too short for Brevo." };
      }
      if (htmlBytes >= 1_000_000) {
        return { ok: false, status: "content_error", stage, error: `Stored email.html is ${htmlBytes} bytes; Brevo campaign HTML must remain below 1 MB.` };
      }

      stage = "campaign-create";
      const created = await doCreateCampaign({
        name: `${profile.displayName} — ${new Date().toISOString().slice(0, 10)} — ${sessionId}`,
        subject: newsletter.subject,
        sender: { id: sender.senderId },
        type: "classic",
        previewText: newsletter.previewText,
        replyTo: profile.brevo.replyTo || profile.brevo.fromEmail,
        htmlContent: html,
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

      campaignId = created.data?.id;
      info("newsletter.brevo.campaign_created", { sessionId, profileId: profile.id, campaignId, listId: list.listId });

      // Record the draft *before* sendNow. If this write fails we have no
      // durable way to detect the campaign on a retry, so delete it from
      // Brevo rather than leave an unrecorded draft that could later be
      // sent (by AIMS retrying, or manually) with no idempotency guard.
      stage = "delivery-record-create";
      try {
        await recordDelivery({
          profile, sessionId, date,
          campaignId, listId: list.listId,
          status: "created", campaignStatus: "draft",
          createdAt: new Date().toISOString(), sentAt: null,
        });
      } catch (writeErr) {
        warn("newsletter.brevo.delivery_record_write_failed", { sessionId, profileId: profile.id, campaignId, error: writeErr?.message || String(writeErr) });
        let campaignDeleted = false;
        try {
          const deleted = await doDeleteCampaign(campaignId);
          campaignDeleted = Boolean(deleted?.ok);
        } catch (deleteErr) {
          warn("newsletter.brevo.orphaned_campaign_delete_failed", { sessionId, profileId: profile.id, campaignId, error: deleteErr?.message || String(deleteErr) });
        }
        return {
          ok: false,
          status: "campaign_state_write_failed",
          stage,
          campaignId,
          campaignDeleted,
          error: `Brevo campaign ${campaignId} was created but AIMS could not durably record it, so it was ${campaignDeleted ? "deleted" : "left in Brevo as an untracked draft — check the Brevo dashboard"}: ${writeErr?.message || String(writeErr)}`,
        };
      }
    }

    const resumed = Boolean(delivery?.status === "created");

    stage = "campaign-send";
    const sent = await doSendCampaignNow(campaignId);
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
        resumed,
        error: sent.error,
        providerStatus: sent.status || null,
        providerCode: sent.code || null,
      };
    }

    const sentAt = new Date().toISOString();
    let campaignStatus = "queued";
    try {
      const live = await doGetCampaign(campaignId);
      if (live?.ok && live.data?.status) campaignStatus = live.data.status;
    } catch (statusErr) {
      warn("newsletter.brevo.post_send_status_check_failed", { sessionId, campaignId, error: statusErr?.message || String(statusErr) });
    }

    stage = "delivery-record-dispatch";
    await recordDelivery({
      profile, sessionId, date,
      campaignId, listId: list.listId,
      status: "dispatched", campaignStatus,
      createdAt: delivery?.createdAt || null, sentAt,
    });

    info("newsletter.brevo.campaign_sent", { sessionId, profileId: profile.id, campaignId, resumed });

    return {
      ok: true,
      status: "sent",
      campaignId,
      campaignStatus,
      listId: list.listId,
      audienceSubscribers: list.totalSubscribers,
      sentAt,
      ...(resumed ? { resumed: true } : {}),
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
