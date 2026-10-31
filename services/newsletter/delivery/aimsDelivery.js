import { checkIssueDeliveryPolicy } from "../engine/deliveryPolicy.js";
import { randomUUID } from "node:crypto";
import { loadCommsHubConfig } from "../../comms-hub/config.js";
import { D1Client } from "../../comms-hub/clients/d1Client.js";
import { OneComMailClient } from "../../comms-hub/clients/oneComMailClient.js";
import { listEligibleSubscribers, getAudienceReadiness, createUnsubscribeToken } from "../audience/d1Audience.js";
import { buildIssueKeyPrefix, findLatestIssueSessionId, recordCampaignDelivery, readCampaignDelivery } from "../engine/storage.js";
import { getObjectAsText } from "../../shared/utils/r2-client.js";
import { getNewsletterProfile } from "../config/profiles.js";

function runtime() {
  const config = loadCommsHubConfig(process.env, { requireEnabled: true });
  const account = config.manualEmailAccounts?.newsletter;
  const mail = account?.enabled ? new OneComMailClient({
    ...config,
    oneComEmailAccountKey: account.key,
    oneComEmailAddress: account.address,
    oneComEmailUsername: account.username,
    oneComEmailPassword: account.password,
    oneComMailbox: account.mailbox,
  }) : null;
  return { config, d1: new D1Client(config), mail };
}

export function issueDeliveryDue(metadata = {}, now = new Date()) {
  if (!metadata.scheduledAt) return true;
  const scheduled = Date.parse(metadata.scheduledAt);
  return Number.isFinite(scheduled) && scheduled <= now.getTime();
}

function publicBaseUrl() {
  return String(process.env.COMMS_HUB_PUBLIC_BASE_URL || "").replace(/\/$/, "");
}

function withUnsubscribe(html, url) {
  const footer = '<p style="margin:24px 0 0;color:#687386;font-size:12px;line-height:1.5;text-align:center">'
    + 'You are receiving AI Edge because you subscribed to it. '
    + `<a href="${url}" style="color:#475569">Unsubscribe</a></p>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${footer}</body>`) : `${html}${footer}`;
}


async function sendIssueToRecipient({ profile, sessionId, recipient, buildResult, d1, mail }) {
  // Atomically reserve a recipient before SMTP. A pending reservation after a
  // crash is deliberately not replayed: provider acceptance may be unknown.
  const claimId = randomUUID();
  const attemptedAt = new Date().toISOString();
  const inserted = await d1.query(`INSERT INTO newsletter_delivery_recipients
    (issue_id,subscriber_id,status,attempted_at,provider_message_id)
    VALUES(?,?,'pending',?,?) ON CONFLICT(issue_id,subscriber_id) DO NOTHING
    RETURNING subscriber_id`, [sessionId, recipient.id, attemptedAt, claimId]);
  let claimed = Boolean(inserted.results?.length);
  if (!claimed) {
    const retried = await d1.query(`UPDATE newsletter_delivery_recipients
      SET status='pending',attempted_at=?,provider_message_id=?,error_code=NULL
      WHERE issue_id=? AND subscriber_id=? AND status='failed'
      RETURNING subscriber_id`, [attemptedAt, claimId, sessionId, recipient.id]);
    claimed = Boolean(retried.results?.length);
  }
  if (!claimed) {
    const prior = await d1.query("SELECT status FROM newsletter_delivery_recipients WHERE issue_id=? AND subscriber_id=?", [sessionId, recipient.id]);
    const status = prior.results?.[0]?.status;
    if (status === "sent") return { ok: true, status: "already_sent" };
    return { ok: false, status: "delivery_reconciliation_required" };
  }
  let acceptedByProvider = false;
  try {
  const unsubscribeToken = await createUnsubscribeToken(recipient.id, profile.id, { d1 });
  const unsubscribeUrl = `${publicBaseUrl()}/newsletter/unsubscribe/${encodeURIComponent(unsubscribeToken)}`;
    const result = await mail.sendMessage({
      to: [recipient.email],
      subject: buildResult.newsletter.subject,
      bodyText: `${buildResult.plaintext || buildResult.newsletter.previewText || ""}\n\nUnsubscribe: ${unsubscribeUrl}`,
      bodyHtml: withUnsubscribe(buildResult.emailHtml, unsubscribeUrl),
      messageId: `<newsletter-${sessionId}-${recipient.id}@jonathan-harris.online>`,
    });
    acceptedByProvider = true;
    const deliveredAt = new Date().toISOString();
    const persisted = await d1.query(`UPDATE newsletter_delivery_recipients SET status='sent',
      delivered_at=?,provider_message_id=?,error_code=NULL
      WHERE issue_id=? AND subscriber_id=? AND status='pending' AND provider_message_id=?
      RETURNING subscriber_id`,
    [deliveredAt, result.messageId || randomUUID(), sessionId, recipient.id, claimId]);
    if (!persisted.results?.length) throw new Error("newsletter_delivery_claim_lost");
    return { ok: true, status: "sent" };
  } catch (error) {
    const uncertain = acceptedByProvider || Boolean(error?.deliveryUncertain);
    await d1.query(`UPDATE newsletter_delivery_recipients SET status=?,error_code=?
      WHERE issue_id=? AND subscriber_id=? AND status='pending' AND provider_message_id=?`,
    [uncertain ? "reconciliation_required" : "failed", error?.code || "delivery_failed", sessionId, recipient.id, claimId]);
    return { ok: false, status: uncertain ? "delivery_reconciliation_required" : "failed", error: error?.message || String(error) };
  }
}

async function loadStoredIssue(profile, sessionId, date) {
  const prefix = buildIssueKeyPrefix(profile, { date, sessionId });
  const bucketKey = profile.storage.htmlBucketKey;
  const [metadataRaw, emailHtml, plaintext] = await Promise.all([
    getObjectAsText(bucketKey, `${prefix}/metadata.json`),
    getObjectAsText(bucketKey, `${prefix}/email.html`),
    getObjectAsText(bucketKey, `${prefix}/index.txt`),
  ]);
  const metadata = JSON.parse(metadataRaw);
  return {
    metadata,
    newsletter: { subject: metadata.subject, previewText: metadata.previewText, heroHeadline: metadata.heroHeadline },
    emailHtml,
    plaintext,
  };
}

export async function deliverTodaysIssueToSubscriber({ subscriberId, email, publicationId = "ai-edge", date = new Date() }, deps = {}) {
  const { d1, mail } = deps.d1 ? deps : runtime();
  if (!mail) return { ok: false, status: "sender_not_configured" };
  const profile = getNewsletterProfile(publicationId);
  const sessionId = await (deps.findSession || findLatestIssueSessionId)(profile, { date });
  if (!sessionId) return { ok: true, status: "no_issue_today" };
  try {
    const buildResult = await (deps.loadIssue || loadStoredIssue)(profile, sessionId, date);
    const policy = await checkIssueDeliveryPolicy(buildResult.metadata, date, { maintenance: deps.maintenance });
    if (!policy.ok) return { ok: true, status: "issue_deferred", reason: policy.status, sessionId };
    const result = await sendIssueToRecipient({ profile, sessionId, recipient: { id: subscriberId, email }, buildResult, d1, mail });
    return { ...result, sessionId };
  } catch (error) {
    return { ok: false, status: "issue_unavailable", sessionId, error: error?.message || String(error) };
  }
}

export async function getNewsletterDeliveryReadiness({ profile }, deps = {}) {
  try {
    const { d1, mail } = deps.d1 ? deps : runtime();
    if (!mail) return { ok: false, ready: false, status: "sender_not_configured", error: "Newsletter one.com sender is not configured." };
    const audience = await getAudienceReadiness(profile.id, { d1 });
    return { ...audience, provider: "aims-onecom", sender: process.env.COMMS_HUB_EMAIL_NEWSLETTER_ADDRESS || "newsletter@jonathan-harris.online" };
  } catch (error) {
    return { ok: false, ready: false, status: "provider_unavailable", error: error?.message || String(error) };
  }
}

export async function deliverNewsletterIssue({ profile, sessionId, buildResult, date = new Date() }, deps = {}) {
  const policy = await checkIssueDeliveryPolicy(buildResult.metadata, deps.now || new Date(), { maintenance: deps.maintenance });
  if (!policy.ok) return { ...policy, stage: "preflight" };
  if (policy.cutoffAt) buildResult = { ...buildResult, metadata: { ...buildResult.metadata, deliveryCutoffAt: policy.cutoffAt } };
  let d1, mail, existing, recipients;
  try {
    ({ d1, mail } = deps.d1 ? deps : runtime());
    if (!mail) return { ok: false, status: "sender_not_configured", stage: "preflight", error: "Newsletter one.com sender is not configured." };
    existing = await (deps.readDelivery || readCampaignDelivery)({ profile, sessionId, date });
    recipients = await (deps.listRecipients || listEligibleSubscribers)(profile.id, { d1 });
  } catch (error) {
    return { ok: false, status: "delivery_preflight_failed", stage: "preflight", safeToRetry: true, error: error.message };
  }
  if (existing.delivery?.status === "dispatched") return { ok: true, status: "already_dispatched", ...existing.delivery };
  if (!recipients.length) return { ok: false, status: "audience_empty", stage: "preflight", error: "No verified, consented newsletter subscribers are eligible for delivery." };
  const issueId = sessionId;
  let sent = 0;
  let failed = 0;
  for (const recipient of recipients) {
    if (buildResult.metadata?.deliveryCutoffAt && Date.now() >= Date.parse(buildResult.metadata.deliveryCutoffAt)) {
      failed += recipients.length - sent - failed;
      break;
    }
    const result = await sendIssueToRecipient({ profile, sessionId, recipient, buildResult, d1, mail });
    if (result.ok) { sent += 1; continue; }
    failed += 1;
    if (result.status === "delivery_reconciliation_required") {
      return { ok: false, status: result.status, stage: "send", sent, failed, error: result.error };
    }
  }
  const deliveryId = `aims-${sessionId}`;
  await recordCampaignDelivery({
    profile,
    sessionId,
    campaignId: deliveryId,
    listId: profile.id,
    status: failed ? "partial" : "dispatched",
    campaignStatus: failed ? "partial" : "sent",
    createdAt: new Date().toISOString(),
    sentAt: new Date().toISOString(),
    date,
  });
  return { ok: failed === 0, status: failed ? "partial_delivery" : "dispatched", provider: "aims-onecom", deliveryId, audience: recipients.length, sent, failed };
}

export async function getCampaignStatus(deliveryId, { d1 = runtime().d1 } = {}) {
  const issueId = String(deliveryId || "").replace(/^aims-/, "");
  const result = await d1.query("SELECT status, COUNT(*) AS count FROM newsletter_delivery_recipients WHERE issue_id=? GROUP BY status", [issueId]);
  return { ok: true, provider: "aims-onecom", deliveryId, counts: Object.fromEntries((result.results || []).map((row) => [row.status, Number(row.count)])) };
}
