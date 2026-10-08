#!/usr/bin/env node
// Read-only production snapshot. Run inside the AIMS service so Koyeb keeps
// provider credentials private; print only booleans, IDs and delivery states.
import "../config/loadEnv.js";
import { loadCommsHubConfig } from "../services/comms-hub/config.js";
import { D1Client } from "../services/comms-hub/clients/d1Client.js";
import { readJsonStateFresh } from "../services/shared/utils/stateFile.js";
import { getObjectAsText, listKeys } from "../services/shared/utils/r2-client.js";
import { getNewsletterProfile } from "../services/newsletter/config/profiles.js";
import { buildIssueKeyPrefix, findLatestIssueSessionId, readCampaignDelivery } from "../services/newsletter/engine/storage.js";
import { getNewsletterDeliveryReadiness, getCampaignStatus } from "../services/newsletter/delivery/aimsDelivery.js";

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

function failureSignals(task = {}) {
  if (task.ok === true) return [];
  const child = task.asyncJob?.job || task.asyncJob || {};
  const message = [task.error, task.reason, child.error?.message, child.result?.error, task.result?.error]
    .filter((value) => typeof value === "string").join(" ").toLowerCase();
  const patterns = [
    ["visual-qa", /visual qa|visual quality|quality gate/],
    ["authentication", /\b(?:401|403)\b|unauthori[sz]ed|invalid api key|forbidden/],
    ["credits-or-billing", /\b402\b|insufficient (?:credits|balance)|payment required|billing/],
    ["rate-limit", /\b429\b|rate limit|too many requests/],
    ["timeout", /timed out|timeout|duration-exceeded|poll-attempt-limit|aborted/],
    ["missing-image-data", /no image data|image data missing/],
    ["storage", /\br2\b|\bs3\b|upload failed|no such bucket/],
  ];
  return patterns.filter(([, pattern]) => pattern.test(message)).map(([signal]) => signal);
}

function summariseTask(task = {}) {
  const result = childResult(task);
  const summary = { ok: task.ok === true, status: task.status || null, errorCode: task.errorCode || null };
  if (task.ok !== true) summary.failureSignals = failureSignals(task);
  if (/^blotato-/.test(task.name || "")) {
    summary.scheduledTime = result.scheduledTime || null;
    summary.confirmedChannels = Array.isArray(result.posts) ? result.posts.filter((post) => post.confirmed).length : null;
    summary.partial = result.partial === true;
  }
  if (task.name === "podcast") {
    summary.artworkGenerated = result.artwork?.source === "generated" && Boolean(result.artwork?.key);
    summary.rssPublished = result.rss?.ok === true;
    summary.publicationConfirmed = task.ok === true && result.ok === true;
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
      const status = await getCampaignStatus(delivery.campaignId);
      provider = status.ok ? { status: delivery.campaignStatus || delivery.status || "unknown", recipientCounts: status.counts }
        : { status: "lookup_failed" };
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

// Provider payloads stay inside the service. Never print answers, addresses,
// webhook URLs (which may contain secrets), submission IDs or raw errors.
async function newsletterIntakeSnapshot() {
  const config = loadCommsHubConfig(process.env, { requireEnabled: true });
  const formId = config.jotformForms.newsletter_signup.formId;
  const d1 = new D1Client(config);
  async function providerGet(path) {
    const response = await fetch(`${config.jotformApiBaseUrl}${path}`, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { accept: "application/json", APIKEY: config.jotformApiKey },
    });
    const payload = await response.json();
    if (!response.ok || Number(payload.responseCode) !== 200) {
      return { ok: false, httpStatus: response.status, providerStatus: Number(payload.responseCode) || null };
    }
    return { ok: true, content: payload.content };
  }
  const webhook = await safeCheck(async () => {
    const result = await providerGet(`/form/${formId}/webhooks`);
    if (!result.ok) return result;
    const urls = Object.values(result.content || {}).filter((value) => typeof value === "string");
    const expected = new URL("/comms-hub/intake/jotform", config.publicBaseUrl);
    return { ok: true, registeredCount: urls.length, canonicalIntakeRegistered: urls.some((value) => {
      try { const url = new URL(value); return url.origin === expected.origin && url.pathname === expected.pathname; }
      catch { return false; }
    }) };
  });
  const recentSubmissions = await safeCheck(async () => {
    // Limit the query to the last two calendar days; Jotform timestamps do not
    // specify an offset, so this is a bounded sample, not an exact UTC window.
    const since = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10) + " 00:00:00";
    const query = new URLSearchParams({ limit: "100", filter: JSON.stringify({ "created_at:gt": since }) });
    const result = await providerGet(`/form/${formId}/submissions?${query}`);
    if (!result.ok) return result;
    if (!Array.isArray(result.content)) return { ok: false, status: "invalid-submission-list" };
    const submissions = result.content.filter((row) => /^\d+$/.test(String(row.id || "")));
    let consentRecorded = 0;
    let confirmationRecorded = 0;
    for (const row of submissions) {
      const events = await d1.query("SELECT event_type FROM newsletter_consent_events WHERE publication_id=? AND source_reference=?", [
        "ai-edge", `jotform:${formId}:${row.id}`,
      ]);
      const types = new Set((events.results || []).map((event) => event.event_type));
      if (types.has("consent_requested")) consentRecorded += 1;
      if (types.has("confirmation_sent")) confirmationRecorded += 1;
    }
    return { ok: true, sampleCount: submissions.length, sampleLimit: 100,
      mayBeTruncated: result.content.length === 100, consentRecorded, confirmationRecorded };
  });
  const confirmations = await safeCheck(async () => {
    const result = await d1.query("SELECT status, COUNT(*) AS count FROM newsletter_confirmation_deliveries GROUP BY status");
    return { ok: true, counts: Object.fromEntries((result.results || []).map((row) => [row.status, Number(row.count)])) };
  });
  return { webhook, recentSubmissions, confirmations };
}

const profile = getNewsletterProfile("ai-edge");
const readiness = await safeCheck(async () => {
  const result = await getNewsletterDeliveryReadiness({ profile, provisionSender: false });
  return {
    ok: result.ok, ready: result.ready, stage: result.stage || null,
    status: result.status || null,
    sender: result.sender || null,
    audienceActive: result.audience?.active ?? null,
    audiencePending: result.audience?.pending ?? null,
  };
});

const report = {
  checkedAt: new Date().toISOString(),
  londonDay: londonDay(),
  configuration: {
    zernioKeyPresent: configured("ZERNIO_API_KEY") || configured("ZERNIO_META_API_KEY"),
    blotatoKeyPresent: configured("BLOTATO_API_KEY") || configured("Blotato_API_key"),
    newsletterSenderConfigured: configured("ONECOM_NEWSLETTER_PASSWORD") && configured("COMMS_HUB_EMAIL_NEWSLETTER_ADDRESS"),
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
  newsletterIntake: await safeCheck(newsletterIntakeSnapshot),
  latestNewsletterIssue: await safeCheck(() => issueSnapshot(profile)),
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
