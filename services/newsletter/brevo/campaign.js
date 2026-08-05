// services/newsletter/brevo/campaign.js
//
// Turns a QA-passed, rendered newsletter issue into an immediate Brevo send.
// MAST owns timing; AIMS owns a durable, exactly-once create -> sendNow hand-off.

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
const DISPATCH_FAILED_STATUSES = new Set([
  "suspended",
  "archive",
  "archived",
  "darchive",
  "cancel",
  "cancelled",
  "canceled",
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normaliseCampaignStatus(value) {
  return String(value || "unknown").trim().toLowerCase();
}

function deliveryDependencies(overrides = {}) {
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

async function verifyCampaignDispatch(campaignId, dependencies = {}) {
  const deps = deliveryDependencies(dependencies);
  const attempts = Math.max(1, Math.min(20, Number(process.env.NEWSLETTER_BREVO_DISPATCH_VERIFY_ATTEMPTS || 10)));
  const intervalMs = Math.max(0, Math.min(10_000, Number(process.env.NEWSLETTER_BREVO_DISPATCH_VERIFY_INTERVAL_MS || 2000)));
  let lastStatus = "unknown";
  let lastResult = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await deps.getCampaign(campaignId);
    lastResult = result;
    if (!result.ok) {
      if (attempt < attempts) {
        await deps.sleep(intervalMs);
        continue;
      }
      return {
        ok: false,
        status: "verification_failed",
        error: result.error,
        providerStatus: result.status,
        providerCode: result.code,
      };
    }

    lastStatus = normaliseCampaignStatus(result.data?.status);
    if (DISPATCH_ACCEPTED_STATUSES.has(lastStatus)) {
      return { ok: true, status: lastStatus, campaign: result.data };
    }
    if (DISPATCH_FAILED_STATUSES.has(lastStatus)) {
      return {
        ok: false,
        status: lastStatus,
        error: `Brevo campaign entered terminal status '${lastStatus}' after sendNow.`,
        campaign: result.data,
      };
    }
    if (attempt < attempts) await deps.sleep(intervalMs);
  }

  return {
    ok: false,
    status: lastStatus,
    error: `Brevo accepted sendNow but campaign ${campaignId} remained '${lastStatus}' after dispatch verification.`,
    campaign: lastResult?.data || null,
  };
}

async function persistDelivery(deps, {
  profile,
  sessionId,
  storagePrefix,
  campaignId,
  listId,
  createdAt,
  sentAt = null,
  status,
  campaignStatus = null,
}) {
  return deps.recordCampaignDelivery({
    profile,
    sessionId,
    prefix: storagePrefix,
    campaignId,
    listId,
    createdAt,
    sentAt,
    status,
    campaignStatus,
  });
}

function successfulDeliveryResult({
  campaignId,
  campaignStatus,
  listId,
  audienceSubscribers = null,
  sentAt = null,
  resumed = false,
  alreadyDispatched = false,
}) {
  return {
    ok: true,
    status: campaignStatus,
    campaignId,
    campaignStatus,
    listId,
    audienceSubscribers,
    sentAt,
    resumed,
    alreadyDispatched,
  };
}

async function sendAndVerifyExistingCampaign({
  deps,
  profile,
  sessionId,
  storagePrefix,
  campaignId,
  listId,
  createdAt,
  audienceSubscribers = null,
  resumed = false,
}) {
  const sent = await deps.sendCampaignNow(campaignId);
  if (!sent.ok) {
    await persistDelivery(deps, {
      profile,
      sessionId,
      storagePrefix,
      campaignId,
      listId,
      createdAt,
      status: "send-failed",
      campaignStatus: "draft",
    }).catch((error) => {
      warn("newsletter.brevo.delivery_state_write_failed", {
        sessionId,
        campaignId,
        phase: "send-failed",
        error: error?.message || String(error),
      });
    });
    return {
      ok: false,
      status: "send_failed",
      stage: "campaign-send",
      campaignId,
      error: sent.error,
      providerStatus: sent.status || null,
      providerCode: sent.code || null,
    };
  }

  const dispatched = await verifyCampaignDispatch(campaignId, deps);
  if (!dispatched.ok) {
    await persistDelivery(deps, {
      profile,
      sessionId,
      storagePrefix,
      campaignId,
      listId,
      createdAt,
      status: "dispatch-unconfirmed",
      campaignStatus: dispatched.status || "unknown",
    }).catch((error) => {
      warn("newsletter.brevo.delivery_state_write_failed", {
        sessionId,
        campaignId,
        phase: "dispatch-unconfirmed",
        error: error?.message || String(error),
      });
    });
    return {
      ok: false,
      status: "dispatch_not_confirmed",
      stage: "campaign-dispatch-verify",
      campaignId,
      campaignStatus: dispatched.status || null,
      error: dispatched.error,
      providerStatus: dispatched.providerStatus || null,
      providerCode: dispatched.providerCode || null,
    };
  }

  const sentAt = new Date().toISOString();
  await persistDelivery(deps, {
    profile,
    sessionId,
    storagePrefix,
    campaignId,
    listId,
    createdAt,
    sentAt,
    status: "dispatched",
    campaignStatus: dispatched.status,
  });

  info("newsletter.brevo.campaign_sent", {
    sessionId,
    profileId: profile.id,
    campaignId,
    campaignStatus: dispatched.status,
    resumed,
  });

  return successfulDeliveryResult({
    campaignId,
    campaignStatus: dispatched.status,
    listId,
    audienceSubscribers,
    sentAt,
    resumed,
  });
}

async function resumeRecordedCampaign({ deps, profile, sessionId, storagePrefix, delivery }) {
  const campaignId = Number(delivery?.campaignId);
  const listId = Number(delivery?.listId);
  if (!Number.isFinite(campaignId) || campaignId <= 0) {
    return {
      ok: false,
      status: "delivery_state_invalid",
      stage: "campaign-resume",
      error: "Stored newsletter campaign state has no valid Brevo campaign ID.",
    };
  }

  const recordedStatus = normaliseCampaignStatus(delivery?.campaignStatus || delivery?.status);
  if (delivery?.sentAt || DISPATCH_ACCEPTED_STATUSES.has(recordedStatus)) {
    info("newsletter.brevo.campaign_already_dispatched", {
      sessionId,
      profileId: profile.id,
      campaignId,
      campaignStatus: recordedStatus,
    });
    return successfulDeliveryResult({
      campaignId,
      campaignStatus: DISPATCH_ACCEPTED_STATUSES.has(recordedStatus) ? recordedStatus : "sent",
      listId,
      sentAt: delivery?.sentAt || null,
      resumed: true,
      alreadyDispatched: true,
    });
  }

  const current = await deps.getCampaign(campaignId);
  if (!current.ok) {
    return {
      ok: false,
      status: "existing_campaign_lookup_failed",
      stage: "campaign-resume",
      campaignId,
      error: current.error,
      providerStatus: current.status || null,
      providerCode: current.code || null,
    };
  }

  const currentStatus = normaliseCampaignStatus(current.data?.status);
  if (DISPATCH_ACCEPTED_STATUSES.has(currentStatus)) {
    const sentAt = delivery?.sentAt || current.data?.sentDate || new Date().toISOString();
    await persistDelivery(deps, {
      profile,
      sessionId,
      storagePrefix,
      campaignId,
      listId,
      createdAt: delivery?.createdAt,
      sentAt,
      status: "dispatched",
      campaignStatus: currentStatus,
    });
    return successfulDeliveryResult({
      campaignId,
      campaignStatus: currentStatus,
      listId,
      sentAt,
      resumed: true,
      alreadyDispatched: true,
    });
  }

  if (DISPATCH_FAILED_STATUSES.has(currentStatus)) {
    return {
      ok: false,
      status: "existing_campaign_terminal",
      stage: "campaign-resume",
      campaignId,
      campaignStatus: currentStatus,
      error: `The recorded Brevo campaign is in terminal status '${currentStatus}'. AIMS will not create a duplicate campaign automatically.`,
    };
  }

  if (currentStatus !== "draft") {
    return {
      ok: false,
      status: "existing_campaign_pending",
      stage: "campaign-resume",
      campaignId,
      campaignStatus: currentStatus,
      error: `The recorded Brevo campaign is '${currentStatus}'. AIMS will not call sendNow again or create a duplicate while its state is unresolved.`,
    };
  }

  info("newsletter.brevo.campaign_resume", {
    sessionId,
    profileId: profile.id,
    campaignId,
    campaignStatus: currentStatus,
  });
  return sendAndVerifyExistingCampaign({
    deps,
    profile,
    sessionId,
    storagePrefix,
    campaignId,
    listId,
    createdAt: delivery?.createdAt,
    resumed: true,
  });
}

export async function getNewsletterDeliveryReadiness({ profile }, dependencies = {}) {
  const deps = deliveryDependencies(dependencies);
  const sender = await deps.inspectSender({ email: profile?.brevo?.fromEmail });
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

  const list = await deps.ensureList({
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
 * The durable campaign record is checked first. A retry resumes the existing
 * campaign or reports its current state; it never creates a second campaign for
 * the same issue.
 */
export async function deliverNewsletterIssue({ profile, sessionId, buildResult }, dependencies = {}) {
  if (!buildResult?.ok) {
    return { ok: false, status: "build_failed", error: "Cannot deliver because the newsletter build did not succeed." };
  }

  const deps = deliveryDependencies(dependencies);
  const { newsletter, storage } = buildResult;
  const storagePrefix = String(storage?.prefix || "").trim();
  let stage = "delivery-state";

  try {
    const stored = await deps.readCampaignDelivery({
      profile,
      sessionId,
      prefix: storagePrefix,
    });
    if (stored?.delivery) {
      return resumeRecordedCampaign({
        deps,
        profile,
        sessionId,
        storagePrefix,
        delivery: stored.delivery,
      });
    }

    stage = "sender";
    const sender = await deps.ensureSender({ name: profile.brevo.fromName, email: profile.brevo.fromEmail });
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
      warn("newsletter.brevo.send_blocked_unverified_sender", {
        sessionId,
        profileId: profile.id,
        senderId: sender.senderId,
      });
      return {
        ok: false,
        status: "sender_pending_validation",
        stage,
        senderId: sender.senderId,
        error: `Sender ${sender.email} exists in Brevo but is not verified.`,
      };
    }

    stage = "audience";
    const list = await deps.ensureList({
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
      return {
        ok: false,
        status: "audience_empty",
        stage,
        listId: list.listId,
        listName: list.name || profile.brevo.listName,
        error: "The selected Brevo list has no active subscribers.",
      };
    }

    stage = "content";
    const html = buildResult.emailHtml || await deps.getObjectAsText(
      profile.storage.htmlBucketKey,
      `${storagePrefix}/email.html`,
    );
    const htmlBytes = Buffer.byteLength(String(html || ""), "utf8");
    if (String(html || "").trim().length < 10) {
      return { ok: false, status: "content_error", stage, error: "Stored email.html is empty or too short for Brevo." };
    }
    if (htmlBytes >= 1_000_000) {
      return {
        ok: false,
        status: "content_error",
        stage,
        error: `Stored email.html is ${htmlBytes} bytes; Brevo campaign HTML must remain below 1 MB.`,
      };
    }

    stage = "campaign-create";
    const senderId = Number(sender.senderId);
    if (!Number.isFinite(senderId) || senderId <= 0) {
      return { ok: false, status: "sender_error", stage, error: "Brevo returned no valid ID for the verified sender." };
    }

    const created = await deps.createCampaign({
      name: `${profile.displayName} — ${new Date().toISOString().slice(0, 10)} — ${sessionId}`,
      subject: newsletter.subject,
      sender: { id: senderId },
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

    const campaignId = Number(created.data?.id);
    if (!Number.isFinite(campaignId) || campaignId <= 0) {
      return {
        ok: false,
        status: "campaign_create_failed",
        stage,
        error: "Brevo created no usable campaign ID.",
        providerStatus: created.status || null,
      };
    }

    const createdAt = new Date().toISOString();
    try {
      await persistDelivery(deps, {
        profile,
        sessionId,
        storagePrefix,
        campaignId,
        listId: list.listId,
        createdAt,
        status: "created",
        campaignStatus: "draft",
      });
    } catch (error) {
      const cleanup = await deps.deleteCampaign(campaignId).catch((cleanupError) => ({
        ok: false,
        error: cleanupError?.message || String(cleanupError),
      }));
      return {
        ok: false,
        status: "campaign_state_write_failed",
        stage: "campaign-state",
        campaignId,
        campaignDeleted: Boolean(cleanup?.ok),
        error: `Brevo campaign was created but its idempotency record could not be stored: ${error?.message || String(error)}`,
      };
    }

    info("newsletter.brevo.campaign_created", {
      sessionId,
      profileId: profile.id,
      campaignId,
      listId: list.listId,
    });

    return sendAndVerifyExistingCampaign({
      deps,
      profile,
      sessionId,
      storagePrefix,
      campaignId,
      listId: list.listId,
      createdAt,
      audienceSubscribers: list.totalSubscribers,
    });
  } catch (error) {
    warn("newsletter.brevo.delivery_exception", {
      sessionId,
      profileId: profile.id,
      stage,
      error: error?.message || String(error),
    });
    return {
      ok: false,
      status: "delivery_exception",
      stage,
      error: error?.message || String(error),
    };
  }
}

export async function getCampaignStatus(campaignId, dependencies = {}) {
  const deps = deliveryDependencies(dependencies);
  const result = await deps.getCampaign(campaignId, { statistics: "globalStats" });
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
