// The AI Edge social lane reuses yesterday's dispatched issue, not fresh AI research.
// The HTML edition is email-only, so copy and approved hero art are read from private R2.
import { getNewsletterProfile } from "../../newsletter/config/profiles.js";
import { buildIssueKeyPrefix, findLatestIssueSessionId, readCampaignDelivery } from "../../newsletter/engine/storage.js";
import { getObjectAsText } from "../../shared/utils/r2-client.js";
import { buildIntentHash, recordEditorialEvent } from "../../social/editorialLedger.js";
import { completeScheduleSlot, releaseScheduleSlot } from "./state.js";
import { addDays, nextWeekdayDateString, toScheduledDateTime } from "./date.js";
import { DEFAULT_TIMEZONE, NEWSLETTER_PROMO_CONFIG, ZERNIO_PROFILE_NAME_GENERAL, getZernioAccountId, normaliseZernioAccountId } from "./config.js";
import { claimZernioSlot, runZernioSocialGate, scheduleToZernio } from "./socialScheduler.js";

const DAYS = Object.freeze(["monday", "wednesday", "friday"]);
const EXPECTED_EDITION = Object.freeze({ monday: "sunday", wednesday: "daily", friday: "daily" });

function invalid(message, code = "zernio-newsletter-source-unavailable") {
  const error = new Error(message);
  error.statusCode = 422;
  error.code = code;
  return error;
}

function validatedHttps(value, label) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || !url.hostname) throw new Error("not HTTPS");
    return url.toString();
  } catch {
    throw invalid("AI Edge " + label + " is missing or is not an HTTPS URL.");
  }
}

export function extractNewsletterLead(plaintext = "") {
  const lines = String(plaintext || "").split(/\r?\n/).map((line) => line.trim());
  const start = lines.indexOf("THE BIG THREE");
  if (start < 0) throw invalid("The stored AI Edge edition has no Big Three section.");
  let cursor = start + 1;
  while (cursor < lines.length && !lines[cursor]) cursor += 1;
  const title = lines[cursor] || "";
  const fields = lines.slice(cursor + 1, cursor + 8);
  const value = (label) => fields.find((line) => line.startsWith(label))?.slice(label.length).trim() || "";
  const story = {
    title,
    whatHappened: value("What happened:"),
    whyItMatters: value("Why it matters:"),
    jonathanTake: value("Jonathan's take:"),
  };
  if (!story.title || !story.whatHappened || !story.whyItMatters || !story.jonathanTake) {
    throw invalid("The stored AI Edge lead is incomplete; no social post will be improvised.");
  }
  return story;
}

export async function loadNewsletterPromoContext({ sourceDate, weekday, deps = {} } = {}) {
  if (!DAYS.includes(weekday)) throw invalid("Newsletter promotion is restricted to Monday, Wednesday and Friday.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(sourceDate || ""))) throw invalid("Invalid newsletter source date.");
  const profile = deps.profile || getNewsletterProfile("ai-edge");
  const date = new Date(sourceDate + "T12:00:00Z");
  const findSession = deps.findLatestIssueSessionId || findLatestIssueSessionId;
  const readDelivery = deps.readCampaignDelivery || readCampaignDelivery;
  const readObject = deps.getObjectAsText || getObjectAsText;
  const sessionId = await findSession(profile, { date });
  if (!sessionId) throw invalid("No approved AI Edge issue was stored for " + sourceDate + ".");
  const prefix = buildIssueKeyPrefix(profile, { date, sessionId });
  const raw = await readObject(profile.storage.htmlBucketKey, prefix + "/metadata.json");
  const metadata = JSON.parse(raw);
  if (metadata.profileId !== "ai-edge" || metadata.publicationDate !== sourceDate || metadata.edition !== EXPECTED_EDITION[weekday]) {
    throw invalid("AI Edge issue identity/date/edition does not match the intended previous day.");
  }
  if (metadata.qa?.passed !== true || metadata.qa?.quarantined === true) {
    throw invalid("AI Edge issue did not pass editorial QA.");
  }
  const delivery = await readDelivery({ profile, sessionId, date });
  if (delivery?.delivery?.status !== "dispatched") {
    throw invalid("AI Edge has no confirmed complete send record for " + sourceDate + "; promotion blocked.");
  }
  const heroImageUrl = validatedHttps(metadata.heroImageUrl, "hero artwork");
  if (metadata.heroImageStatus === "failed" || metadata.heroImageStatus === "missing") {
    throw invalid("AI Edge artwork did not pass publication checks.");
  }
  const plaintext = await readObject(profile.storage.htmlBucketKey, prefix + "/index.txt");
  const lead = extractNewsletterLead(plaintext);
  if (metadata.storyTitles?.[0] !== lead.title) {
    throw invalid("AI Edge lead story and selected hero art metadata are not aligned.");
  }
  return { sourceDate, sessionId, edition: metadata.edition, lead, heroImageUrl };
}

function shortExcerpt(value, max = 340) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)/g) || [];
  let kept = "";
  for (const part of sentences) {
    if ((kept + part).length > max) break;
    kept += part;
  }
  if (!kept.trim()) throw invalid("AI Edge lead excerpt is too long to adapt safely without rewriting.");
  return kept.trim();
}

export function buildNewsletterPromoPost({ context, weekday, signupUrl = NEWSLETTER_PROMO_CONFIG.signupUrl } = {}) {
  if (!DAYS.includes(weekday)) throw invalid("Unsupported AI Edge promotional day.");
  const { lead, sourceDate, heroImageUrl } = context || {};
  if (!lead?.title || !sourceDate || !heroImageUrl) throw invalid("No verified AI Edge lead context.");
  const link = new URL(validatedHttps(signupUrl, "subscription destination"));
  link.searchParams.set("utm_source", "zernio");
  link.searchParams.set("utm_medium", "social");
  link.searchParams.set("utm_campaign", "ai-edge");
  link.searchParams.set("utm_content", weekday + "-" + sourceDate);
  const hook = lead.title;
  const fact = shortExcerpt(lead.whatHappened);
  const consequence = shortExcerpt(lead.whyItMatters);
  const judgement = shortExcerpt(lead.jonathanTake);
  const blocks = weekday === "monday"
    ? [hook, fact, consequence, "AI Edge goes beyond the announcement and asks what changes in practice."]
    : weekday === "wednesday"
      ? [hook, consequence, judgement, "That's the kind of reality check AI Edge is written for."]
      : [hook, fact, judgement, "AI Edge covers the practical implications, minus the vendor theatre."];
  const content = blocks.join("\n\n") + "\n\nRead AI Edge and subscribe: " + link.toString();
  return {
    title: "AI Edge " + weekday + " · " + lead.title.slice(0, 48),
    topic: lead.title.slice(0, 110),
    content,
    imageUrl: validatedHttps(heroImageUrl, "hero artwork"),
  };
}

export async function buildAndScheduleNewsletterPromo(options = {}) {
  const weekday = String(options.weekday || "").toLowerCase();
  if (!DAYS.includes(weekday)) throw invalid("Newsletter promotion is restricted to Monday, Wednesday and Friday.");
  const publishDate = options.publishDate || nextWeekdayDateString(weekday, DEFAULT_TIMEZONE);
  const sourceDate = addDays(publishDate, -1);
  const publishTime = NEWSLETTER_PROMO_CONFIG.publishTimes[weekday];
  let scheduledDateTime = options.scheduledDateTime || toScheduledDateTime(publishDate, publishTime);
  const profileName = options.profileName || ZERNIO_PROFILE_NAME_GENERAL;
  const accountId = normaliseZernioAccountId(options.accountId || getZernioAccountId());
  const dryRun = Boolean(options.dryRun);
  const apiKey = options.apiKey;
  const slot = await claimZernioSlot({
    scope: "newsletter-promo:" + weekday,
    scheduledDateTime,
    profileName,
    accountId,
    imageUrl: "",
    dryRun,
    apiKey,
    sourceIntentHash: buildIntentHash({ audienceIntent: "ai-edge-subscription", angle: sourceDate }),
  });
  scheduledDateTime = slot.scheduledDateTime || scheduledDateTime;
  if (slot.duplicatePrevented) return { ok: true, scheduled: false, duplicatePrevented: true, lane: "newsletter-promo", weekday, publishDate, sourceDate };
  try {
    const context = await loadNewsletterPromoContext({ sourceDate, weekday });
    const post = buildNewsletterPromoPost({ context, weekday });
    const gate = runZernioSocialGate({ contentType: "zernio-newsletter-promo", laneKey: "newsletter-promo", post });
    if (!gate.ok) throw invalid("AI Edge promotional copy failed brand review: " + gate.defects.join("; "), "zernio-newsletter-brand-gate");
    const scheduling = await scheduleToZernio({
      post, scheduledDateTime, profileName, accountId, dryRun, apiKey,
      laneKey: "newsletter-promo:" + weekday,
      idempotencySeed: slot.key || "",
    });
    if (scheduling.scheduled) {
      recordEditorialEvent({
        pipeline: "zernio", lane: "newsletter-promo", audienceIntent: "ai-edge-subscription",
        angle: context.lead.title, scheduledDateTime, text: post.content,
        meta: { sourceDate, issueId: context.sessionId, reusedApprovedArtwork: true },
      });
    }
    if (slot.claimed && (scheduling.scheduled || scheduling.duplicatePrevented)) {
      await completeScheduleSlot(slot, { lane: "newsletter-promo", scheduledDateTime, title: post.title, topic: post.topic, duplicatePrevented: Boolean(scheduling.duplicatePrevented) });
    } else {
      await releaseScheduleSlot(slot);
    }
    return { ok: true, lane: "newsletter-promo", weekday, publishDate, sourceDate, issueId: context.sessionId, post,
      scheduled: scheduling.scheduled, dryRun: scheduling.dryRun, duplicatePrevented: Boolean(scheduling.duplicatePrevented),
      zernioResponse: scheduling.zernioResponse, warnings: scheduling.warnings || [] };
  } catch (error) {
    await releaseScheduleSlot(slot);
    throw error;
  }
}
