// services/newsletter/brevo/campaign.js
//
// Exactly-once Brevo delivery for a QA-passed newsletter issue. MAST owns the
// clock; this module owns the durable create -> record -> send -> verify handoff.

import { info, warn } from "../../../logger.js";
import { getObjectAsText } from "../../shared/utils/r2-client.js";
import { readCampaignDelivery, recordCampaignDelivery } from "../engine/storage.js";
import { ensureList } from "./audience.js";
import { ensureSender, inspectSender } from "./sender.js";
import {
  createCampaign,
  deleteCampaign,
  sendCampaignNow,
  getCampaign,
} from "./client.js";

const DISPATCH_ACCEPTED_STATUSES = new Set(["queued", "scheduled", "sent"]);
const CAMPAIGN_TERMINAL_STATUSES = new Set(["suspended", "archive", "archived", "rejected"]);

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function subscriberCount(list = {}) {
  for (const value of [list.activeSubscribers, list.uniqueSubscribers, list.totalSubscribers]) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }
  return 0;
}

function errorResult(status, error, extra = {}) {
  return { ok: false, status, error, ...extra };
}

function dependencies(overrides = {}) {
  return {
    getObjectAsText,
    readCampaignDelivery,
    recordCampaignDelivery,
    ensureList,
    ensureSender,
    inspectSender,
    createCampaign,
    deleteCampaign,
    sendCampaignNow,
    getCampaign,
    sleep,
    ...overrides,
  };
}

function normaliseCampaignStatus(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * Polls Brevo until it confirms that sendNow has moved the campaign out of
 * draft. A 2xx response from sendNow alone is not treated as proof of dispatch.
 */
export async function verifyCampaignDispatch(campaignId, deps = {}) {
  const adapters = dependencies(deps);
  const attempts = positiveInteger(process.env.NEWSLETTER_BREVO_DISPATCH_VERIFY_ATTEMPTS, 10);
  const intervalMs = positiveInteger(process.env.NEWSLETTER_BREVO_DISPATCH_VERIFY_INTERVAL_MS, 2000);
  let lastStatus = null;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await adapters.getCampaign(campaignId);
    if (result.ok) {
      lastStatus = normaliseCampaignStatus(result.data?.status);
      if (DISPATCH_ACCEPTED_STATUSES.has(lastStatus)) {
        return { ok: true, campaignStatus: lastStatus, attempts: attempt, data: result.data };
      }
      if (CAMPAIGN_TERMINAL_STATUSES.has(lastStatus)) {
        return {
          ok: false,
          status: "campaign_dispatch_terminal",
          campaignStatus: lastStatus,
          attempts: attempt,
          error: `Brevo campaign ${campaignId} entered terminal status '${lastStatus}'.`,
        };
      }
    } else {
      lastError = result.error;
    }

    if (attempt < attempts) await adapters.sleep(intervalMs);
  }

  return {
    ok: false,
    status: "campaign_dispatch_unconfirmed",
    campaignStatus: lastStatus,
    attempts,
    error: lastError || `Brevo did not confirm dispatch for campaign ${campaignId} after ${attempts} checks.`,
  };
}

/**
 * Side-effect-free sender/list preflight used by operator diagnostics.
 */
export async function getNewsletterDeliveryReadiness({ profile }, deps = {}) {
  const adapters = dependencies(deps);

  const sender = await adapters.inspectSender({ email: profile?.brevo?.fromEmail });
  if (!sender.ok) {
    return { ready: false, ...sender };
  }
  if (!sender.verified) {
    return errorResult(
      "sender_pending_validation",
      `Sender ${sender.email} exists in Brevo but has not completed validation.`,
      { ready: false, senderId: sender.senderId, email: sender.email },
    );
  }

  const audience = await adapters.ensureList(
    {
      id: profile?.brevo?.listId,
      name: profile?.brevo?.listName,
      folderName: profile?.brevo?.folderName,
    },
    { allowCreate: false },
  );
  if (!audience.ok) return { ready: false, ...audience };

  const subscribers = subscriberCount(audience);
  if (subscribers < 1) {
    return errorResult(
      "audience_empty",
      `Brevo list ${audience.listId} ('${audience.name || profile.brevo.listName}') has no active subscribers.`,
      { ready: false, listId: audience.listId, subscribers },
    );
  }

  return {
    ok: true,
    ready: true,
    status: "ready",
    profileId: profile.id,
    senderId: sender.senderId,
    listId: audience.listId,
    subscribers,
  };
}

async function loadEmailHtml(profile, buildResult, adapters) {
  const embedded = String(buildResult?.emailHtml || "").trim();
  if (embedded) return embedded;

  const prefix = buildResult?.storage?.prefix;
  if (!prefix) throw new Error("Newsletter build result has no storage prefix for email.html.");
  return adapters.getObjectAsText(profile.storage.htmlBucketKey, `${prefix}/email.html`);
}

async function readExistingDelivery({ profile, sessionId, prefix }, adapters) {
  const result = await adapters.readCampaignDelivery({ profile, sessionId, prefix });
  return result?.delivery || null;
}

async function recordState(payload, adapters) {
  return adapters.recordCampaignDelivery(payload);
}

/**
 * Delivers one rendered, QA-passed newsletter issue via Brevo. The optional
 * dependency argument exists for deterministic contract tests; production uses
 * the real adapters above.
 */
export async function deliverNewsletterIssue({ profile, sessionId, buildResult }, deps = {}) {
  if (!buildResult?.ok) {
    return errorResult("build_failed", "Cannot deliver because the newsletter build did not succeed.");
  }

  const adapters = dependencies(deps);
  const prefix = buildResult?.storage?.prefix || null;
  let stage = "campaign-state-read";

  try {
    const existing = await readExistingDelivery({ profile, sessionId, prefix }, adapters);
    if (existing?.status === "dispatched") {
      return {
        ok: true,
        status: "sent",
        campaignId: Number(existing.campaignId),
        listId: Number(existing.listId),
        campaignStatus: existing.campaignStatus || "sent",
        sentAt: existing.sentAt || null,
        alreadyDispatched: true,
      };
    }

    let campaignId = existing?.campaignId ? Number(existing.campaignId) : null;
    let listId = existing?.listId ? Number(existing.listId) : null;
    let createdAt = existing?.createdAt || null;
    let resumed = false;

    if (campaignId) {
      stage = "existing-campaign-check";
      const remote = await adapters.getCampaign(campaignId);
      if (!remote.ok) {
        return errorResult("existing_campaign_pending", remote.error, {
          stage,
          campaignId,
          providerStatus: remote.status,
          providerCode: remote.code,
        });
      }

      const remoteStatus = normaliseCampaignStatus(remote.data?.status);
      if (DISPATCH_ACCEPTED_STATUSES.has(remoteStatus)) {
        const sentAt = existing?.sentAt || new Date().toISOString();
        await recordState({
          profile,
          sessionId,
          prefix,
          campaignId,
          listId,
          status: "dispatched",
          campaignStatus: remoteStatus,
          createdAt,
          sentAt,
          lastCheckedAt: new Date().toISOString(),
        }, adapters);
        return {
          ok: true,
          status: "sent",
          campaignId,
          listId,
          campaignStatus: remoteStatus,
          sentAt,
          alreadyDispatched: true,
          recoveredFromProvider: true,
        };
      }
      if (CAMPAIGN_TERMINAL_STATUSES.has(remoteStatus)) {
        return errorResult(
          "existing_campaign_terminal",
          `Existing Brevo campaign ${campaignId} is '${remoteStatus}' and will not be sent automatically.`,
          { stage, campaignId, campaignStatus: remoteStatus },
        );
      }
      if (remoteStatus !== "draft") {
        return errorResult(
          "existing_campaign_pending",
          `Existing Brevo campaign ${campaignId} is '${remoteStatus || "unknown"}'.`,
          { stage, campaignId, campaignStatus: remoteStatus || null },
        );
      }
      resumed = true;
    }

    stage = "sender";
    const sender = await adapters.ensureSender({
      name: profile.brevo.fromName,
      email: profile.brevo.fromEmail,
    });
    if (!sender.ok) {
      return errorResult(sender.status || "sender_error", sender.error, {
        stage,
        providerStatus: sender.providerStatus,
        providerCode: sender.providerCode,
      });
    }
    if (!sender.verified) {
      return errorResult(
        "sender_pending_validation",
        `Sender ${sender.email} exists in Brevo but has not completed validation.`,
        { stage, senderId: sender.senderId },
      );
    }
    const senderId = Number(sender.senderId);
    if (!senderId) return errorResult("sender_error", "Brevo returned no valid sender ID.", { stage });

    stage = "audience";
    const audience = await adapters.ensureList({
      id: profile.brevo.listId,
      name: profile.brevo.listName,
      folderName: profile.brevo.folderName,
    });
    if (!audience.ok) {
      return errorResult(audience.status || "list_error", audience.error, {
        stage,
        providerStatus: audience.providerStatus,
        providerCode: audience.providerCode,
      });
    }

    const subscribers = subscriberCount(audience);
    if (subscribers < 1) {
      return errorResult(
        "audience_empty",
        `Brevo list ${audience.listId} ('${audience.name || profile.brevo.listName}') has no active subscribers.`,
        { stage, listId: audience.listId, subscribers },
      );
    }
    listId = listId || Number(audience.listId);
    if (!listId) return errorResult("audience_not_configured", "Brevo returned no valid list ID.", { stage });

    stage = "content";
    const htmlContent = String(await loadEmailHtml(profile, buildResult, adapters)).trim();
    if (htmlContent.length < 10) {
      return errorResult("content_error", "Stored email.html is empty or too short for Brevo.", { stage });
    }

    if (!campaignId) {
      stage = "campaign-create";
      const created = await adapters.createCampaign({
        name: `${profile.displayName} — ${new Date().toISOString().slice(0, 10)} — ${sessionId}`,
        subject: buildResult.newsletter.subject,
        sender: { id: senderId },
        type: "classic",
        previewText: buildResult.newsletter.previewText,
        replyTo: profile.brevo.replyTo || profile.brevo.fromEmail,
        htmlContent,
        recipients: { listIds: [listId] },
      });
      if (!created.ok) {
        return errorResult("campaign_create_failed", created.error, {
          stage,
          providerStatus: created.status,
          providerCode: created.code,
        });
      }

      campaignId = Number(created.data?.id);
      if (!campaignId) return errorResult("campaign_create_failed", "Brevo returned no campaign ID.", { stage });
      createdAt = new Date().toISOString();
      info("newsletter.brevo.campaign_created", { sessionId, profileId: profile.id, campaignId, listId });

      stage = "campaign-state-write";
      try {
        await recordState({
          profile,
          sessionId,
          prefix,
          campaignId,
          listId,
          status: "created",
          campaignStatus: "draft",
          createdAt,
          sentAt: null,
          lastCheckedAt: createdAt,
        }, adapters);
      } catch (err) {
        let campaignDeleted = false;
        try {
          const deleted = await adapters.deleteCampaign(campaignId);
          campaignDeleted = Boolean(deleted?.ok);
        } catch {
          campaignDeleted = false;
        }
        return errorResult(
          "campaign_state_write_failed",
          `Created Brevo campaign ${campaignId}, but could not persist the idempotency record: ${err.message}`,
          { stage, campaignId, campaignDeleted },
        );
      }
    }

    stage = "campaign-send";
    const sent = await adapters.sendCampaignNow(campaignId);
    if (!sent.ok) {
      warn("newsletter.brevo.send_now_failed", { sessionId, campaignId, error: sent.error });
      return errorResult("send_failed", sent.error, {
        stage,
        campaignId,
        providerStatus: sent.status,
        providerCode: sent.code,
        resumed,
      });
    }

    stage = "campaign-verify";
    const verified = await verifyCampaignDispatch(campaignId, adapters);
    if (!verified.ok) {
      return { ...verified, stage, campaignId, listId, resumed };
    }

    const sentAt = new Date().toISOString();
    stage = "campaign-state-dispatched";
    await recordState({
      profile,
      sessionId,
      prefix,
      campaignId,
      listId,
      status: "dispatched",
      campaignStatus: verified.campaignStatus,
      createdAt,
      sentAt,
      lastCheckedAt: sentAt,
    }, adapters);

    info("newsletter.brevo.campaign_sent", {
      sessionId,
      profileId: profile.id,
      campaignId,
      campaignStatus: verified.campaignStatus,
    });

    return {
      ok: true,
      status: "sent",
      campaignId,
      listId,
      campaignStatus: verified.campaignStatus,
      sentAt,
      resumed,
    };
  } catch (err) {
    warn("newsletter.brevo.delivery_exception", {
      sessionId,
      profileId: profile?.id,
      stage,
      error: err?.message || String(err),
    });
    return errorResult("delivery_exception", err?.message || String(err), { stage });
  }
}

/** Polls Brevo for a campaign's current status/performance. */
export async function getCampaignStatus(campaignId) {
  const result = await getCampaign(campaignId, { statistics: "globalStats" });
  if (!result.ok) return { ok: false, error: result.error, providerStatus: result.status, providerCode: result.code };

  return {
    ok: true,
    id: result.data?.id,
    status: result.data?.status,
    sentDate: result.data?.sentDate || null,
    statistics: result.data?.statistics?.globalStats || null,
  };
}

export default {
  deliverNewsletterIssue,
  getNewsletterDeliveryReadiness,
  getCampaignStatus,
  verifyCampaignDispatch,
};
