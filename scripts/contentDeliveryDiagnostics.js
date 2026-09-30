#!/usr/bin/env node
// Read-only production snapshot. Run inside the AIMS service so Koyeb keeps
// provider credentials private; print only booleans, IDs and delivery states.
import { readJsonStateFresh } from "../services/shared/utils/stateFile.js";
import { getObjectAsText, listKeys } from "../services/shared/utils/r2-client.js";
import { getNewsletterProfile } from "../services/newsletter/config/profiles.js";
import { buildIssueKeyPrefix, findLatestIssueSessionId, readCampaignDelivery } from "../services/newsletter/engine/storage.js";
import { getNewsletterDeliveryReadiness } from "../services/newsletter/brevo/campaign.js";
import { getCampaign } from "../services/newsletter/brevo/client.js";

function londonDay(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function recentDays(count = 7) {
  const now = Date.now();
  return Array.from({ length: count }, (_, offset) => londonDay(new Date(now - offset * 86_400_000)));
}

function requiredMonthlyBlotatoEstimate(day = londonDay()) {
  const [year, month] = day.split("-").map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weekdays = Array.from({ length: days }, (_, index) => new Date(Date.UTC(year, month - 1, index + 1)).getUTCDay())
    .filter((weekday) => weekday > 0 && weekday < 6).length;
  return weekdays * 2 * Number(process.env.BLOTATO_MAX_EXPECTED_CREDITS || 10);
}

function configured(name) {
  const value = String(process.env[name] || "").trim();
  return Boolean(value && !/^\{\{\s*secret\./i.test(value));
}

function childResult(task = {}) {
  return task.asyncJob?.job?.result || task.asyncJob?.result || task.result || {};
}

function summariseTask(task = {}) {
  const result = childResult(task);
  const summary = { ok: task.ok === true, status: task.status || null, errorCode: task.errorCode || null };
  if (/^blotato-/.test(task.name || "")) {
    summary.scheduledTime = result.scheduledTime || null;
    summary.confirmedChannels = Array.isArray(result.posts) ? result.posts.filter((post) => post.confirmed).length : null;
    summary.partial = result.partial === true;
  }
  if (task.name === "podcast") {
    summary.artworkGenerated = result.artwork?.source === "generated" && Boolean(result.artwork?.key);
    summary.rssPublished = result.rss?.ok === true;
    summary.publicationConfirmed = result.ok === true;
  }
  return summary;
}

async function operationSnapshot() {
  const state = await readJsonStateFresh("operation-window-state.json", { receipts: [] });
  const days = new Set(recentDays());
  return (Array.isArray(state.receipts) ? state.receipts : [])
    .filter((receipt) => days.has(String(receipt.id || "").slice(0, 10)))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .map((receipt) => ({
      day: String(receipt.id).slice(0, 10),
      window: receipt.window,
      status: receipt.status,
      failures: receipt.failures,
      tasks: Object.fromEntries((receipt.results || [])
        .filter((task) => /^(zernio-|blotato-|newsletter-|podcast$)/.test(task.name || ""))
        .map((task) => [task.name, summariseTask(task)])),
    }));
}

async function issueSnapshot(profile) {
  for (const day of recentDays()) {
    const date = new Date(`${day}T12:00:00Z`);
    const sessionId = await findLatestIssueSessionId(profile, { date });
    if (!sessionId) continue;

    const prefix = buildIssueKeyPrefix(profile, { date, sessionId });
    const metadata = JSON.parse(await getObjectAsText(profile.storage.htmlBucketKey, `${prefix}/metadata.json`));
    const emailHtml = await getObjectAsText(profile.storage.htmlBucketKey, `${prefix}/email.html`);
    const artKey = metadata.heroImageKey || "";
    const artBucket = metadata.heroImageBucketKey || "";
    const artworkObjectConfirmed = artKey && artBucket
      ? (await listKeys(artBucket, artKey)).includes(artKey) : null;
    const { delivery } = await readCampaignDelivery({ profile, sessionId, date });
    let provider = null;
    if (delivery?.campaignId) {
      const campaign = await getCampaign(delivery.campaignId);
      provider = campaign.ok ? {
        status: String(campaign.data?.status || "unknown"),
        subjectMatches: campaign.data?.subject === metadata.subject,
        artworkInCampaign: Boolean(metadata.heroImageUrl && String(campaign.data?.htmlContent || "").includes(metadata.heroImageUrl)),
        recipientListMatches: Array.isArray(campaign.data?.recipients?.listIds)
          ? campaign.data.recipients.listIds.some((id) => Number(id) === Number(delivery.listId)) : null,
      } : { status: "lookup_failed", httpStatus: campaign.status || null };
    }
    return {
      day, sessionId,
      qaPassed: metadata.qa?.passed === true,
      heroImageRecorded: Boolean(metadata.heroImageUrl),
      heroImageStatus: metadata.heroImageStatus || "legacy-unknown",
      artworkObjectConfirmed,
      emailHtmlStored: emailHtml.length > 10,
      artworkInStoredEmail: Boolean(metadata.heroImageUrl && emailHtml.includes(metadata.heroImageUrl)),
      delivery: delivery ? { status: delivery.status, campaignStatus: delivery.campaignStatus, campaignId: delivery.campaignId } : null,
      provider,
    };
  }
  return { status: "no-issue-in-last-seven-days" };
}

async function safeCheck(run) {
  try { return await run(); }
  catch (error) { return { status: "check-failed", errorType: String(error?.name || "Error").slice(0, 80) }; }
}

const profile = getNewsletterProfile("ai-edge");
const readiness = await safeCheck(async () => {
  const result = await getNewsletterDeliveryReadiness({ profile, provisionSender: false });
  return {
    ok: result.ok, ready: result.ready, stage: result.stage || null,
    status: result.status || null,
    senderExists: result.sender?.exists ?? null,
    senderVerified: result.sender?.verified ?? null,
    audienceReady: result.audience?.ready ?? null,
    eligibleContactCheck: result.audience?.subscriberCountSource || null,
  };
});

const report = {
  checkedAt: new Date().toISOString(),
  londonDay: londonDay(),
  configuration: {
    zernioKeyPresent: configured("ZERNIO_API_KEY") || configured("ZERNIO_META_API_KEY"),
    blotatoKeyPresent: configured("BLOTATO_API_KEY") || configured("Blotato_API_key"),
    brevoKeyPresent: configured("BREVO_API_KEY"),
    artworkKeyPresent: configured("OPENROUTER_API_KEY") || configured("OPENROUTER_API_KEY_ART") || configured("OPENROUTER_API_KEY_ART_BACKUP"),
    artworkModelPresent: configured("OPENROUTER_ART") || configured("OPENROUTER_ART_BACKUP") || configured("AI_MODEL_IMAGE"),
    newsletterEnabled: String(process.env.AIMS_OPERATION_NEWSLETTER_ENABLED || "true").toLowerCase() !== "false",
    blotatoDailyPaidRenderCap: Number(process.env.BLOTATO_DAILY_PAID_RENDER_CAP || 2),
    blotatoMonthlyEstimatedCreditCap: Number(process.env.BLOTATO_MONTHLY_ESTIMATED_CREDIT_CAP || 100),
    blotatoTwoDailyEstimatedCreditsForMonth: requiredMonthlyBlotatoEstimate(),
    blotatoTwoDailyCapConfigured: Number(process.env.BLOTATO_DAILY_PAID_RENDER_CAP || 2) >= 2,
    blotatoMonthlyEstimateCoversTwoDaily: Number(process.env.BLOTATO_MONTHLY_ESTIMATED_CREDIT_CAP || 100) >= requiredMonthlyBlotatoEstimate(),
  },
  operations: await safeCheck(operationSnapshot),
  newsletterReadiness: readiness,
  latestNewsletterIssue: await safeCheck(() => issueSnapshot(profile)),
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
