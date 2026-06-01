import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { resilientRequest } from "../../shared/utils/ai-service.js";
import { info, warn } from "../../../logger.js";
import { LANE_CONFIG, QUIZ_CONFIG, EBOOK_CONFIG, ONEUP_CATEGORY_NAME_GENERAL, ONEUP_CATEGORY_NAME_EBOOKS, ONEUP_DEFAULT_DRY_RUN, DEFAULT_TIMEZONE, ONEUP_QUEUE_GUARD_LOOKBACK_PAGES, getOneUpRequiredNetworkTypes, getOneUpSocialNetworkId, normaliseOneUpSocialNetworkId, shouldValidateOneUpTargetAccounts } from "./config.js";
import { buildDailyPrompt, buildQuizPrompt, buildEbookPostPrompt } from "./prompts.js";
import { addDays, nextWeekdayDateString, toScheduledDateTime } from "./date.js";
import { loadRecentRssContext } from "./feedContext.js";
import { getLaneHistory, getWeeklyTopicLedger, recordLaneSchedule, getQuizHistory, recordQuizSchedule, claimScheduleSlot, completeScheduleSlot, releaseScheduleSlot, isRecentSpotlightPerson, recordSpotlightPerson, recordUsedSocialSource } from "./state.js";
import { resolveCategory, inspectOneUpTargeting, listScheduledPosts, scheduleTextPost, scheduleImagePost } from "./oneupClient.js";
import getSponsor from "../../script/utils/getSponsor.js";
import { resolveFeaturedEbook } from "./ebookCatalogue.js";
import { runPhase5OrganicGrowthGate } from "../../content-quality/phase5OrganicGrowthGates.js";
import { ANTI_HYPE_HEDGING_PHRASES, BANNED_PROMO_PATTERNS, ENGAGEMENT_BAIT_PATTERNS, GENERIC_HASHTAGS, INFLATED_EBOOK_CLAIM_PATTERNS, MOTIVATIONAL_HASHTAGS, MOTIVATIONAL_TONE_PATTERNS, findAmericanSpellings, findPatternBreaches } from "../../content-quality/brandLexicon.js";
import { buildIntentHash, completeEditorialReservation, hasRecentAudienceIntent, recordEditorialEvent, releaseEditorialReservation, reserveEditorialSource } from "../../social/editorialLedger.js";


const ONEUP_DAILY_MAX_TOKENS = Math.max(1200, Number(process.env.ONEUP_DAILY_MAX_TOKENS || 1400));
const ONEUP_QUIZ_MAX_TOKENS = Math.max(1800, Number(process.env.ONEUP_QUIZ_MAX_TOKENS || 2200));
const ONEUP_EBOOK_MAX_TOKENS = Math.max(1200, Number(process.env.ONEUP_EBOOK_MAX_TOKENS || 1600));


const VERIFIED_QUOTES = Object.freeze(JSON.parse(readFileSync(new URL("../data/verified-quotes.json", import.meta.url), "utf8")));

function validateVerifiedQuotes(quotes = []) {
  const missing = quotes
    .filter((item) => !item?.quote || !item?.author || !(item?.sourceUrl || item?.sourceTitle || item?.sourceNote))
    .map((item) => item?.id || item?.author || "unknown");
  if (missing.length) {
    const err = new Error(`Verified quote ledger entries missing provenance fields: ${missing.join(", ")}`);
    err.statusCode = 500;
    throw err;
  }
}

validateVerifiedQuotes(VERIFIED_QUOTES);

function stableIndex(value = "", length = 1) {
  const total = Math.max(1, Number(length) || 1);
  let hash = 0;
  for (const char of String(value || "")) {
    hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  }
  return hash % total;
}

function selectVerifiedQuote(publishDate = "") {
  return VERIFIED_QUOTES[stableIndex(publishDate, VERIFIED_QUOTES.length)] || VERIFIED_QUOTES[0];
}

function resolveVerifiedBuildContext(options = {}) {
  const raw = options.buildContext ?? process.env.ONEUP_FRIDAY_BUILD_CONTEXT ?? "";
  const warnings = [];
  if (!String(raw || "").trim()) return { text: "", warnings };

  let parsed = null;
  if (typeof raw === "object" && raw !== null) {
    parsed = raw;
  } else {
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      parsed = null;
    }
  }

  if (!parsed) {
    warnings.push("Friday build context is plain text. Prefer JSON with text, source, date, and ttlDays so stale first-person detail can be rejected.");
    return { text: String(raw || "").trim(), warnings };
  }

  const text = String(parsed.text || parsed.summary || parsed.context || "").trim();
  const source = String(parsed.source || parsed.sourceUrl || parsed.commit || parsed.deployment || "").trim();
  const dateValue = parsed.date || parsed.createdAt || parsed.updatedAt || parsed.deployedAt;
  const ttlDays = Math.max(1, Number(parsed.ttlDays || process.env.ONEUP_FRIDAY_BUILD_CONTEXT_TTL_DAYS || 14));
  const dateMs = Date.parse(dateValue || "");

  if (!text) return { text: "", warnings: ["Friday build context JSON did not include a text/summary/context field."] };
  if (!source) warnings.push("Friday build context JSON has no source field. Treating it as lower-trust context.");
  if (!Number.isFinite(dateMs)) warnings.push("Friday build context JSON has no valid date. Treating it as lower-trust context.");
  if (Number.isFinite(dateMs) && Date.now() - dateMs > ttlDays * 86400000) {
    return {
      text: "",
      warnings: [`Friday build context is older than ${ttlDays} days, so first-person specifics were disabled.`],
    };
  }

  return { text, warnings };
}

function normaliseSimple(value = "") {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function extractHashtags(value = "") {
  return [...String(value || "").matchAll(/(^|\s)(#[A-Za-z0-9_]+)/g)].map((match) => match[2]);
}

function wordCount(value = "") {
  const text = compactText(value).replace(/(^|\s)#[A-Za-z0-9_]+/g, " ").trim();
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function findPlainPhraseBreaches(text = "", phrases = []) {
  const source = compactText(text).toLowerCase();
  return (Array.isArray(phrases) ? phrases : [])
    .map((phrase) => String(phrase || "").trim())
    .filter(Boolean)
    .filter((phrase) => source.includes(phrase.toLowerCase()));
}

function imageUrlHostWarning(imageUrl = "") {
  const raw = String(imageUrl || "").trim();
  if (!raw) return [];
  const allowedHosts = String(process.env.ONEUP_CANONICAL_IMAGE_HOSTS || "images.jonathan-harris.online,pub-f6b6cfd7d07e46f695d08e4a8dc3bd6b.r2.dev")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return allowedHosts.length && !allowedHosts.includes(host)
      ? [`Image URL host '${host}' is outside the configured canonical image host list.`]
      : [];
  } catch {
    return ["Image URL is not a valid absolute URL."];
  }
}

function scoreFromGate(defects = [], warnings = []) {
  return Math.max(0, 100 - defects.length * 18 - warnings.length * 5);
}

function buildGateError(gate, label = "OneUp social gate") {
  const err = new Error(`${label} failed (${gate.score}/86): ${gate.defects.join(" | ")}`);
  err.statusCode = 422;
  err.oneUpSocialGate = gate;
  return err;
}

function detectSpotlightPerson(post = {}) {
  const supplied = compactText(post.spotlightPerson || "");
  if (supplied) return supplied;
  const text = `${post.topic || ""} ${post.title || ""}`.trim();
  const candidate = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/)?.[0];
  return candidate || String(post.topic || "").replace(/^(spotlight|profile|figure):?\s*/i, "").trim();
}

function runOneUpSocialGate({ contentType = "oneup-social", laneKey = "", post = {}, verifiedQuote = null, buildContext = "" } = {}) {
  const defects = [];
  const warnings = [];
  const text = compactText([post.title, post.topic, post.content, post.firstComment].filter(Boolean).join("\n"));
  const content = compactText(post.content || "");
  const hashtags = extractHashtags(content);
  const words = wordCount(content);

  if (!content) defects.push("Post content is empty.");
  if (hashtags.length > 3) defects.push("Post has more than three hashtags.");
  const genericTags = hashtags.filter((tag) => GENERIC_HASHTAGS.includes(String(tag).toLowerCase()));
  if (genericTags.length > 1) warnings.push("Post uses more than one generic hashtag; keep premium channels tidy.");
  const motivationalTags = hashtags.filter((tag) => MOTIVATIONAL_HASHTAGS.includes(String(tag).toLowerCase()));
  if (motivationalTags.length) defects.push(`Motivational hashtag(s) do not fit the brand: ${motivationalTags.join(", ")}`);
  for (const phrase of findPlainPhraseBreaches(text, ANTI_HYPE_HEDGING_PHRASES)) {
    defects.push(`Generic hedging phrase detected: ${phrase}`);
  }
  for (const breach of findPatternBreaches(text, MOTIVATIONAL_TONE_PATTERNS)) {
    defects.push(`Motivational tone drift: ${breach}`);
  }
  if (/```|\*\*|^\s*[-*]\s+/m.test(content)) defects.push("Post contains markdown or bullet formatting.");
  if (/\p{Extended_Pictographic}/u.test(content)) defects.push("Post contains emoji despite brand rules.");

  for (const breach of findPatternBreaches(text, BANNED_PROMO_PATTERNS)) {
    defects.push(`Brand tone breach: ${breach}`);
  }
  for (const { american, british } of findAmericanSpellings(text)) {
    defects.push(`British English drift: use ${british} instead of ${american}`);
  }

  const baitCheckText = content.replace(/Comment your answer below\.?/gi, "");
  for (const breach of findPatternBreaches(baitCheckText, ENGAGEMENT_BAIT_PATTERNS)) {
    defects.push(`Engagement bait detected: ${breach}`);
  }

  if (/quiz-question/i.test(contentType)) {
    if (!/A\)/.test(content) || !/B\)/.test(content) || !/C\)/.test(content) || !/D\)/.test(content)) {
      defects.push("Quiz question must include A), B), C), and D) options.");
    }
    if (content.split("\n").some((line) => line.length > 140)) warnings.push("Quiz contains a long line that may be weak on static-image layouts.");
    if (words > 90) warnings.push("Quiz post is long for a static-image quiz card.");
  } else if (/quiz-answer/i.test(contentType)) {
    if (!/Quiz Answer!/i.test(content)) defects.push("Quiz answer must start with the answer marker.");
    if (words > 80) warnings.push("Quiz answer is long for a static-image answer card.");
  } else if (words > 130) {
    warnings.push("OneUp post is long for organic static social copy.");
  }

  if (laneKey === "monday") {
    const quote = verifiedQuote?.quote || "";
    const author = verifiedQuote?.author || "";
    if (!quote || !author) defects.push("Monday post requires a verified quote source.");
    if (quote && !normaliseSimple(content).includes(normaliseSimple(quote))) defects.push("Monday post does not include the exact verified quote.");
    if (author && !normaliseSimple(content).includes(normaliseSimple(author))) defects.push("Monday post does not include the verified quote author.");
  }

  if (laneKey === "friday" && !String(buildContext || "").trim()) {
    if (/\b(I|I've|I'm|my|we|we've|we're|our)\b/i.test(content)) {
      defects.push("Friday post has first-person specifics without verified build context.");
    }
    if (/\bbug|metric|deployed|deployment|failed|fixed|shipped|Koyeb|R2|Hookdeck|API|endpoint|workflow tweak\b/i.test(content)) {
      defects.push("Friday post claims specific build work without verified build context.");
    }
  }

  if (/ebook/i.test(contentType)) {
    for (const breach of findPatternBreaches(content, INFLATED_EBOOK_CLAIM_PATTERNS)) {
      defects.push(`Inflated ebook claim detected: ${breach}`);
    }
  }

  return {
    ok: defects.length === 0 && scoreFromGate(defects, warnings) >= 86,
    score: scoreFromGate(defects, warnings),
    contentType,
    laneKey,
    defects,
    warnings,
    checkedAt: new Date().toISOString(),
  };
}

const EBOOK_POST_DAYS = [
  { key: "tuesday", offset: 1, publishTimeKey: "tuesdayPublishTime" },
  { key: "thursday", offset: 3, publishTimeKey: "thursdayPublishTime" },
  { key: "saturday", offset: 5, publishTimeKey: "saturdayPublishTime" },
];

function safeModelPreview(value = "", max = 500) {
  const text = String(value || "")
    .replace(/sk-or-[A-Za-z0-9_-]{8,}/g, "sk-or-***")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "github_pat_***")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function isJsonModelError(error) {
  return Number(error?.statusCode) === 502 && /Invalid .* JSON from model/i.test(String(error?.message || ""));
}

async function requestStructuredOneUpJson({ routeName, sessionId, prompt, label, normalise, maxTokens, temperature }) {
  const messages = [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user },
  ];

  const raw = await resilientRequest(routeName, {
    sessionId,
    messages,
    max_tokens: maxTokens,
    temperature,
  });

  try {
    return normalise(raw);
  } catch (err) {
    if (!isJsonModelError(err)) throw err;

    warn("oneup.model.json.invalid.retry", {
      sessionId,
      label,
      error: err.message,
      rawPreview: safeModelPreview(raw),
    });

    const retryRaw = await resilientRequest(routeName, {
      sessionId: `${sessionId}-JSON-RETRY`,
      messages: [
        ...messages,
        {
          role: "assistant",
          content: safeModelPreview(raw, 900) || "The previous response was empty or truncated.",
        },
        {
          role: "user",
          content: [
            "The previous response was invalid or truncated JSON.",
            "Return exactly one complete JSON object now.",
            "Use the exact required keys only.",
            "Every value must be a plain string.",
            "No markdown fences, no notes, no labels outside the JSON.",
          ].join("\n"),
        },
      ],
      max_tokens: maxTokens + 700,
      temperature: 0.2,
      maxRetries: 0,
    });

    return normalise(retryRaw);
  }
}

function extractJsonCandidate(raw = "") {
  const text = String(raw || "").trim();
  if (!text) return "";
  try {
    JSON.parse(text);
    return text;
  } catch {}
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  return text;
}

function parseJsonObject(raw, label) {
  const candidate = extractJsonCandidate(raw);
  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${label} response was not a JSON object`);
    }
    return parsed;
  } catch (error) {
    const err = new Error(`Invalid ${label} JSON from model: ${error.message}`);
    err.statusCode = 502;
    throw err;
  }
}

function compactText(value = "") {
  return String(value || "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeRegExp(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ensureHashtags(content, hashtags, { maxTags = 3 } = {}) {
  const base = compactText(content);
  const tags = (Array.isArray(hashtags) ? hashtags : [])
    .map((tag) => String(tag || "").trim())
    .filter(Boolean)
    .filter((tag, index, array) => array.findIndex((item) => item.toLowerCase() === tag.toLowerCase()) === index)
    .slice(0, Math.max(0, Number(maxTags || 3)));
  if (!tags.length) return base;

  const missing = tags.filter((tag) => !new RegExp(`(^|\\s)${escapeRegExp(tag)}(?=\\s|$)`, "i").test(base));
  if (!missing.length) return base;
  return `${base}\n\n${missing.join(" ")}`;
}

function contentHash(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 12);
}

async function getQueuedPosts(apiKey) {
  const output = [];
  for (let page = 0; page < ONEUP_QUEUE_GUARD_LOOKBACK_PAGES; page += 1) {
    const start = page * 50;
    const result = await listScheduledPosts({ start }, apiKey);
    const rows = Array.isArray(result?.data) ? result.data : [];
    output.push(...rows);
    if (rows.length < 50) break;
  }
  return output;
}

function parseScheduleTime(value = "") {
  const text = String(value || "").trim();
  if (!text) return NaN;
  return Date.parse(text.replace(" ", "T"));
}

function isWithinDuplicateWindow(first = "", second = "", hours = 48) {
  const a = parseScheduleTime(first);
  const b = parseScheduleTime(second);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= Math.max(1, Number(hours || 48)) * 3600000;
}

function hasLikelyDuplicate(queuedPosts, { scheduledDateTime, categoryName, imageUrl, content, allowCrosspost = false }) {
  const expectedHash = content ? contentHash(content) : "";
  const crosspostWindowHours = Math.max(1, Number(process.env.ONEUP_CROSSPOST_DEDUPE_HOURS || 48));
  return (Array.isArray(queuedPosts) ? queuedPosts : []).some((item) => {
    const itemDateTime = item?.date_time || item?.scheduled_date_time || item?.publish_at || "";
    const sameTime = String(itemDateTime || "").startsWith(scheduledDateTime);
    const sameCategory = String(item?.category_name || "").trim().toLowerCase() === String(categoryName || "").trim().toLowerCase();
    const sameImage = !imageUrl || String(item?.content_image || "").trim() === String(imageUrl || "").trim();
    const queuedContent = item?.content || item?.post_content || item?.content_text || item?.caption || "";
    const sameContent = expectedHash && queuedContent ? contentHash(queuedContent) === expectedHash : false;
    if (!allowCrosspost && sameContent && isWithinDuplicateWindow(itemDateTime, scheduledDateTime, crosspostWindowHours)) return true;
    return sameTime && sameCategory && (sameImage || sameContent);
  });
}

function isTruthyOption(value) {
  if (value === true) return true;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  return false;
}

function isEffectiveDryRun({ dryRun, apiKey }) {
  return Boolean(dryRun || ONEUP_DEFAULT_DRY_RUN || !apiKey);
}

function duplicateSlotWarning(reason) {
  return `A OneUp post for this exact schedule slot was already ${reason === "same-slot-already-running" ? "being processed" : "processed"}, so no new post was created.`;
}

async function claimOneUpSlot({ scope, scheduledDateTime, categoryName, socialNetworkId, imageUrl, dryRun, apiKey, force, sourceIntentHash }) {
  if (isEffectiveDryRun({ dryRun, apiKey }) || isTruthyOption(force)) {
    return { claimed: false, skipped: true, duplicatePrevented: false, key: null };
  }

  return claimScheduleSlot({ scope, scheduledDateTime, categoryName, socialNetworkId, imageUrl, sourceIntentHash });
}


function statusCodeFromError(error) {
  const status = Number(error?.statusCode || error?.status);
  return Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
}

function safeErrorMessage(error) {
  return error?.message || String(error || "Unknown error");
}

function retrySummaryFromError(error) {
  const retry = error?.oneUpRetry;
  if (!retry) return null;
  return {
    attempts: retry.attempts,
    maxAttempts: retry.maxAttempts,
    retryable: retry.retryable,
    operation: retry.operation || null,
  };
}

function retryWarningFromError(error) {
  const retry = retrySummaryFromError(error);
  if (!retry) return null;
  return `OneUp API retry attempts used: ${retry.attempts}/${retry.maxAttempts}${retry.operation ? ` (${retry.operation})` : ""}.`;
}

function failedEbookPostResult({ dayKey, publishDate, scheduledDateTime, dryRun, categoryName, error }) {
  const statusCode = statusCodeFromError(error);
  const message = `${dayKey.charAt(0).toUpperCase()}${dayKey.slice(1)} ebook post failed: ${safeErrorMessage(error)}`;
  const retryWarning = retryWarningFromError(error);
  return {
    publishDate,
    scheduledDateTime,
    scheduled: false,
    dryRun: Boolean(dryRun),
    duplicatePrevented: false,
    failed: true,
    statusCode,
    category: { id: null, category_name: categoryName },
    warnings: [message, retryWarning].filter(Boolean),
    error: safeErrorMessage(error),
    retry: retrySummaryFromError(error),
    post: null,
    oneUpResponse: null,
    phase5Gate: error?.phase5Gate || null,
  };
}

function slotDuplicatePostResult({ publishDate, scheduledDateTime, dryRun = false, categoryName, reason }) {
  return {
    publishDate,
    scheduledDateTime,
    scheduled: false,
    dryRun,
    duplicatePrevented: true,
    category: { id: null, category_name: categoryName },
    warnings: [duplicateSlotWarning(reason)],
    post: null,
    oneUpResponse: null,
    phase5Gate: null,
  };
}

async function scheduleToOneUp({ post, scheduledDateTime, categoryName, socialNetworkId, dryRun, apiKey, preflightOnly = false }) {
  const warnings = [];
  const normalisedSocialNetworkId = normaliseOneUpSocialNetworkId(socialNetworkId, getOneUpSocialNetworkId());
  const requiredNetworkTypes = getOneUpRequiredNetworkTypes();
  const effectiveDryRun = Boolean(dryRun || ONEUP_DEFAULT_DRY_RUN || !apiKey);
  if (!apiKey) {
    warnings.push("ONEUP_API_KEY is missing, so this run was returned as a dry run preview.");
  }

  if (effectiveDryRun) {
    return {
      scheduled: false,
      dryRun: true,
      warnings,
      oneUpResponse: null,
      category: { id: null, category_name: categoryName },
      targeting: { checked: false, socialNetworkId: normalisedSocialNetworkId },
    };
  }

  const targeting = shouldValidateOneUpTargetAccounts() || requiredNetworkTypes.length
    ? await inspectOneUpTargeting({
        categoryName,
        socialNetworkId: normalisedSocialNetworkId,
        requiredNetworkTypes,
      }, apiKey)
    : { ok: true, category: await resolveCategory({ categoryName }, apiKey), warnings: [], socialNetworkId: normalisedSocialNetworkId };

  if (!targeting.ok) {
    const err = new Error(`OneUp target setup failed for category '${categoryName}': ${(targeting.warnings || []).join(" | ") || "no eligible accounts found"}`);
    err.statusCode = 409;
    err.oneUpTargeting = targeting;
    throw err;
  }

  warnings.push(...(targeting.warnings || []));
  warnings.push(...imageUrlHostWarning(post.imageUrl));
  info("oneup.targeting.coverage", {
    categoryName,
    socialNetworkId: normalisedSocialNetworkId,
    requiredNetworkTypes,
    connectedNetworkTypes: [...new Set((targeting.categoryAccounts || []).map((account) => account.social_network_type).filter(Boolean))],
    targetedNetworkTypes: [...new Set((targeting.targetedAccounts || []).map((account) => account.social_network_type).filter(Boolean))],
    missingRequiredNetworkTypes: targeting.missingRequiredNetworkTypes || [],
    targetedAccountCount: targeting.targetedAccountCount,
  });
  const category = targeting.category;
  const queuedPosts = await getQueuedPosts(apiKey);
  if (hasLikelyDuplicate(queuedPosts, { scheduledDateTime, categoryName: category.category_name, imageUrl: post.imageUrl, content: post.content, allowCrosspost: Boolean(post.crosspost) })) {
    warnings.push("A likely duplicate post is already scheduled in the guarded window, so no new post was created.");
    return {
      scheduled: false,
      dryRun: false,
      warnings,
      oneUpResponse: null,
      category,
      duplicatePrevented: true,
      targeting,
    };
  }

  if (preflightOnly) {
    return {
      scheduled: false,
      dryRun: false,
      preflightOnly: true,
      warnings,
      oneUpResponse: null,
      category,
      targeting,
    };
  }

  const payload = {
    category_id: category.id,
    social_network_id: normalisedSocialNetworkId,
    scheduled_date_time: scheduledDateTime,
    title: post.title || "",
    content: post.content,
    first_comment: post.firstComment || "",
  };

  const oneUpResponse = post.imageUrl
    ? await scheduleImagePost({ ...payload, image_url: post.imageUrl }, apiKey)
    : await scheduleTextPost(payload, apiKey);

  return {
    scheduled: true,
    dryRun: false,
    warnings,
    oneUpResponse,
    category,
    targeting,
  };
}

function normaliseDailyOutput(raw, lane) {
  const parsed = parseJsonObject(raw, `${lane.key} daily post`);
  return {
    title: compactText(parsed.title || lane.label).slice(0, 80),
    topic: compactText(parsed.topic || lane.label).slice(0, 120),
    content: compactText(parsed.content || ""),
    firstComment: compactText(parsed.firstComment || ""),
    spotlightPerson: compactText(parsed.spotlightPerson || "").slice(0, 80),
  };
}

function normaliseQuizOutput(raw) {
  const parsed = parseJsonObject(raw, "quiz pair");
  return {
    topic: compactText(parsed.topic || "AI quiz").slice(0, 120),
    questionTitle: compactText(parsed.questionTitle || "Weekly AI Quiz").slice(0, 80),
    questionContent: compactText(parsed.questionContent || ""),
    answerTitle: compactText(parsed.answerTitle || "Quiz Answer").slice(0, 80),
    answerContent: compactText(parsed.answerContent || ""),
  };
}

function stripHashtags(value = "") {
  return compactText(value)
    .replace(/(^|\s)#[A-Za-z0-9_]+/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normaliseEbookOutput(raw, featuredBook, dayKey) {
  const parsed = parseJsonObject(raw, `${dayKey} ebook post`);
  return {
    title: compactText(parsed.title || `${featuredBook.title} ${dayKey}`).slice(0, 80),
    topic: compactText(parsed.topic || featuredBook.title).slice(0, 120),
    content: stripHashtags(parsed.content || ""),
    firstComment: buildEbookFirstComment(featuredBook),
  };
}

function buildEbookFirstComment(featuredBook) {
  return `Featured book: ${featuredBook.title}\nRead more: ${featuredBook.bookUrl}`;
}

function resolveEbookPublishTime(options, day) {
  const override = options.publishTimes?.[day];
  if (override && /^\d{2}:\d{2}$/.test(String(override))) return override;
  const envKey = `${day}PublishTime`;
  return EBOOK_CONFIG[envKey];
}

function resolveEbookScheduledDateTime(options, day, publishDate) {
  const fromMap = options.scheduledDateTimes?.[day];
  const fromFlat = options[`${day}ScheduledDateTime`];
  if (fromMap) return fromMap;
  if (fromFlat) return fromFlat;
  return toScheduledDateTime(publishDate, resolveEbookPublishTime(options, day));
}

export async function buildAndScheduleDailyLane(laneKey, options = {}) {
  const lane = LANE_CONFIG[laneKey];
  if (!lane) {
    const err = new Error(`Unsupported lane '${laneKey}'`);
    err.statusCode = 404;
    throw err;
  }

  const publishDate = options.publishDate || nextWeekdayDateString(laneKey, DEFAULT_TIMEZONE, new Date());
  const scheduledDateTime = options.scheduledDateTime || toScheduledDateTime(publishDate, lane.publishTime);
  const categoryName = options.categoryName || ONEUP_CATEGORY_NAME_GENERAL;
  const socialNetworkId = normaliseOneUpSocialNetworkId(options.socialNetworkId || getOneUpSocialNetworkId());
  const apiKey = options.apiKey || process.env.ONEUP_API_KEY;
  const imageUrl = options.imageUrl || lane.imageUrl;
  const dryRun = Boolean(options.dryRun);

  const slotClaim = await claimOneUpSlot({
    scope: `daily:${laneKey}`,
    scheduledDateTime,
    categoryName,
    socialNetworkId,
    imageUrl,
    dryRun,
    apiKey,
    force: options.force,
    sourceIntentHash: buildIntentHash({ audienceIntent: lane.audienceIntent, angle: laneKey }),
  });

  if (slotClaim.duplicatePrevented) {
    const warnings = [duplicateSlotWarning(slotClaim.reason)];
    info("oneup.daily.duplicate_prevented", {
      lane: laneKey,
      publishDate,
      scheduledDateTime,
      slotKey: slotClaim.key,
      reason: slotClaim.reason,
    });

    return {
      ok: true,
      lane: laneKey,
      publishDate,
      scheduledDateTime,
      dryRun: false,
      scheduled: false,
      duplicatePrevented: true,
      category: { id: null, category_name: categoryName },
      warnings,
      post: null,
      oneUpResponse: null,
    };
  }

  let editorialReservation = null;

  try {
    const laneHistory = getLaneHistory(laneKey);
    const weeklyHistory = getWeeklyTopicLedger();
    const verifiedQuote = laneKey === "monday" ? selectVerifiedQuote(publishDate) : null;
    const buildContextResolved = laneKey === "friday" ? resolveVerifiedBuildContext(options) : { text: "", warnings: [] };
    const buildContext = buildContextResolved.text;
    const rssContext = laneKey === "saturday" || laneKey === "sunday"
      ? await loadRecentRssContext({})
      : { ok: true, items: [], warning: null };
    const audienceIntentWarning = hasRecentAudienceIntent(lane.audienceIntent, { excludePipeline: "oneup" })
      ? `Recent cross-pipeline post already used audience intent '${lane.audienceIntent}'. Review angle before publishing.`
      : null;
    if (!dryRun && apiKey && Array.isArray(rssContext.items) && rssContext.items[0]) {
      const reservation = await reserveEditorialSource({
        pipeline: "oneup",
        lane: laneKey,
        source: rssContext.items[0],
        audienceIntent: lane.audienceIntent,
        angle: lane.label,
        scheduledDateTime,
      });
      if (reservation.duplicatePrevented) {
        const err = new Error(`Editorial source already reserved for another social pipeline: ${rssContext.items[0].title}`);
        err.statusCode = 409;
        throw err;
      }
      editorialReservation = reservation.reservation;
    }

    const prompt = buildDailyPrompt({
      lane,
      publishDate,
      history: laneHistory.topics,
      weeklyHistory: weeklyHistory.topics,
      rssItems: rssContext.items,
      verifiedQuote,
      buildContext,
    });

    const sessionId = `ONEUP-${lane.key.toUpperCase()}-${publishDate}`;
    const generated = await requestStructuredOneUpJson({
      routeName: "oneupDaily",
      sessionId,
      prompt,
      label: `${lane.key} daily post`,
      normalise: (raw) => normaliseDailyOutput(raw, lane),
      maxTokens: ONEUP_DAILY_MAX_TOKENS,
      temperature: laneKey === "friday" ? 0.8 : 0.65,
    });
    if (!generated.content) {
      const err = new Error(`The ${lane.label} generator returned empty content.`);
      err.statusCode = 502;
      throw err;
    }

    const post = {
      title: generated.title,
      topic: generated.topic,
      firstComment: generated.firstComment,
      imageUrl,
      content: ensureHashtags(generated.content, lane.hashtags),
      spotlightPerson: generated.spotlightPerson || "",
    };

    const oneUpSocialGate = runOneUpSocialGate({
      contentType: `oneup-daily-${laneKey}`,
      laneKey,
      post,
      verifiedQuote,
      buildContext,
    });
    if (!oneUpSocialGate.ok) throw buildGateError(oneUpSocialGate, `${lane.label} social gate`);

    if (laneKey === "sunday") {
      const spotlightPerson = detectSpotlightPerson(post);
      if (!spotlightPerson) {
        const err = new Error("Sunday spotlight requires a canonical spotlightPerson value.");
        err.statusCode = 422;
        err.oneUpSocialGate = { ...oneUpSocialGate, defects: [...oneUpSocialGate.defects, err.message] };
        throw err;
      }
      if (spotlightPerson && isRecentSpotlightPerson(spotlightPerson)) {
        const err = new Error(`Sunday spotlight repetition guard blocked recent person: ${spotlightPerson}`);
        err.statusCode = 422;
        err.oneUpSocialGate = { ...oneUpSocialGate, defects: [...oneUpSocialGate.defects, err.message] };
        throw err;
      }
    }

    const scheduling = await scheduleToOneUp({
      post,
      scheduledDateTime,
      categoryName,
      socialNetworkId,
      dryRun,
      apiKey,
    });

    const warnings = [
      ...(rssContext.warning ? [rssContext.warning] : []),
      ...(buildContextResolved.warnings || []),
      ...(audienceIntentWarning ? [audienceIntentWarning] : []),
      ...(scheduling.warnings || []),
    ];

    if (scheduling.scheduled) {
      recordLaneSchedule(laneKey, {
        scheduledDateTime,
        topic: post.topic,
        title: post.title,
        imageUrl: post.imageUrl,
      });
      if (laneKey === "sunday") recordSpotlightPerson(detectSpotlightPerson(post), { scheduledDateTime, topic: post.topic, title: post.title });
      for (const item of Array.isArray(rssContext.items) ? rssContext.items.slice(0, 1) : []) {
        recordUsedSocialSource({ lane: `oneup:${laneKey}`, title: item.title, link: item.link, pubDate: item.pubDate, scheduledDateTime });
      }
      if (editorialReservation) {
        completeEditorialReservation(editorialReservation, {
          pipeline: "oneup",
          lane: laneKey,
          source: Array.isArray(rssContext.items) ? rssContext.items[0] : null,
          audienceIntent: lane.audienceIntent,
          angle: post.topic || post.title,
          scheduledDateTime,
          text: post.content,
          meta: { contentType: "oneup-daily" },
        });
      } else {
        recordEditorialEvent({
          pipeline: "oneup",
          lane: laneKey,
          audienceIntent: lane.audienceIntent,
          angle: post.topic || post.title,
          scheduledDateTime,
          text: post.content,
          meta: { contentType: "oneup-daily", dryRun: Boolean(scheduling.dryRun) },
        });
      }
    }

    if (slotClaim.claimed && (scheduling.scheduled || scheduling.duplicatePrevented)) {
      completeScheduleSlot(slotClaim, {
        lane: laneKey,
        scheduledDateTime,
        topic: post.topic,
        title: post.title,
        duplicatePrevented: Boolean(scheduling.duplicatePrevented),
      });
    } else {
      releaseScheduleSlot(slotClaim);
    }

    info("oneup.daily.complete", {
      lane: laneKey,
      publishDate,
      scheduledDateTime,
      dryRun: scheduling.dryRun,
      scheduled: scheduling.scheduled,
      topic: post.topic,
      contentHash: contentHash(post.content),
    });

    return {
      ok: true,
      lane: laneKey,
      publishDate,
      scheduledDateTime,
      dryRun: scheduling.dryRun,
      scheduled: scheduling.scheduled,
      duplicatePrevented: Boolean(scheduling.duplicatePrevented),
      category: scheduling.category,
      warnings,
      post,
      oneUpResponse: scheduling.oneUpResponse,
      targeting: scheduling.targeting || null,
      oneUpSocialGate,
    };
  } catch (error) {
    releaseScheduleSlot(slotClaim);
    if (editorialReservation) releaseEditorialReservation(editorialReservation);
    throw error;
  }
}

export async function buildAndScheduleEbookWeekly(options = {}) {
  const weekStartDate = options.weekStartDate || nextWeekdayDateString("monday", DEFAULT_TIMEZONE, new Date());
  const categoryName = options.categoryName || ONEUP_CATEGORY_NAME_EBOOKS;
  const socialNetworkId = normaliseOneUpSocialNetworkId(options.socialNetworkId || getOneUpSocialNetworkId());
  const warnings = [];

  let sponsor = null;
  if (options.usePodcastFeaturedBook !== false && !options.featuredBook) {
    sponsor = await getSponsor({
      apiUrl: process.env.NODE_ENV === "test" ? options.featuredBookApiUrl : undefined,
      timeout: options.featuredBookTimeoutMs,
    });
    if (sponsor?.source === "fallback") {
      warnings.push("Podcast featured-book API was unavailable or invalid, so the local spreadsheet ebook catalogue rotation was used.");
    }
  }

  const resolved = resolveFeaturedEbook({
    weekStartDate,
    featuredBook: options.featuredBook,
    sponsor,
    cataloguePath: process.env.NODE_ENV === "test" ? options.cataloguePath : undefined,
  });

  const featuredBook = resolved.book;
  warnings.push(...(resolved.warnings || []));
  if (!featuredBook.coverArtUrl) {
    warnings.push("Featured ebook has no coverArtUrl, so OneUp will create text-only posts.");
  }
  if (!featuredBook.manuscriptUrl) {
    warnings.push("Featured ebook has no manuscriptUrl in the local catalogue.");
  }

  const apiKey = options.apiKey || process.env.ONEUP_API_KEY;
  const dryRun = Boolean(options.dryRun);
  const posts = {};

  for (const dayConfig of EBOOK_POST_DAYS) {
    const dayKey = dayConfig.key;
    const publishDate = addDays(weekStartDate, dayConfig.offset);
    const scheduledDateTime = resolveEbookScheduledDateTime(options, dayKey, publishDate);
    const imageUrl = options.imageUrl || featuredBook.coverArtUrl || "";
    const slotClaim = await claimOneUpSlot({
      scope: `ebooks:${dayKey}`,
      scheduledDateTime,
      categoryName,
      socialNetworkId,
      imageUrl,
      dryRun,
      apiKey,
      force: options.force,
      sourceIntentHash: buildIntentHash({ audienceIntent: EBOOK_CONFIG.audienceIntent, angle: `${featuredBook.title}:${dayKey}` }),
    });

    if (slotClaim.duplicatePrevented) {
      const duplicate = slotDuplicatePostResult({
        publishDate,
        scheduledDateTime,
        dryRun: false,
        categoryName,
        reason: slotClaim.reason,
      });
      posts[dayKey] = duplicate;
      warnings.push(...duplicate.warnings);
      info("oneup.ebooks.duplicate_prevented", {
        weekStartDate,
        day: dayKey,
        scheduledDateTime,
        slotKey: slotClaim.key,
        reason: slotClaim.reason,
      });
      continue;
    }

    try {
      const prompt = buildEbookPostPrompt({
        day: dayKey,
        publishDate,
        featuredBook,
      });

      const generated = await requestStructuredOneUpJson({
        routeName: "oneupEbook",
        sessionId: `ONEUP-EBOOK-${dayKey.toUpperCase()}-${publishDate}`,
        prompt,
        label: `${dayKey} ebook post`,
        normalise: (raw) => normaliseEbookOutput(raw, featuredBook, dayKey),
        maxTokens: ONEUP_EBOOK_MAX_TOKENS,
        temperature: dayKey === "saturday" ? 0.65 : 0.55,
      });

      if (!generated.content) {
        const err = new Error(`The ${dayKey} ebook generator returned empty content.`);
        err.statusCode = 502;
        throw err;
      }

      const post = {
        title: generated.title,
        topic: generated.topic,
        firstComment: buildEbookFirstComment(featuredBook),
        imageUrl,
        manuscriptUrl: featuredBook.manuscriptUrl || "",
        content: ensureHashtags(generated.content, EBOOK_CONFIG.hashtags),
      };

      const phase5Gate = runPhase5OrganicGrowthGate({
        contentType: "ebook-conversion-social-post",
        generated: post,
        featuredBook,
        day: dayKey,
        platforms: ["facebook", "instagram", "tiktok"],
      });

      if (!phase5Gate.ok) {
        const err = new Error(`Phase 5 ebook conversion gate failed (${phase5Gate.score}/88): ${phase5Gate.defects.join(" | ")}`);
        err.statusCode = 422;
        err.phase5Gate = phase5Gate;
        throw err;
      }

      const oneUpSocialGate = runOneUpSocialGate({
        contentType: "oneup-ebook-conversion",
        laneKey: `ebook-${dayKey}`,
        post,
      });
      if (!oneUpSocialGate.ok) throw buildGateError(oneUpSocialGate, `${dayKey} ebook social gate`);

      const scheduling = await scheduleToOneUp({
        post,
        scheduledDateTime,
        categoryName,
        socialNetworkId,
        dryRun,
        apiKey,
      });

      posts[dayKey] = {
        publishDate,
        scheduledDateTime,
        scheduled: scheduling.scheduled,
        dryRun: scheduling.dryRun,
        duplicatePrevented: Boolean(scheduling.duplicatePrevented),
        category: scheduling.category,
        warnings: scheduling.warnings || [],
        post,
        oneUpResponse: scheduling.oneUpResponse,
        targeting: scheduling.targeting || null,
        phase5Gate,
        oneUpSocialGate,
      };

      if (scheduling.scheduled) {
        recordLaneSchedule("ebooks-weekly", {
          scheduledDateTime,
          topic: post.topic,
          title: `${featuredBook.title} ${dayKey}`,
          imageUrl: post.imageUrl,
        });
      }

      if (slotClaim.claimed && (scheduling.scheduled || scheduling.duplicatePrevented)) {
        completeScheduleSlot(slotClaim, {
          lane: "ebooks-weekly",
          day: dayKey,
          scheduledDateTime,
          topic: post.topic,
          title: post.title,
          featuredBookTitle: featuredBook.title,
          duplicatePrevented: Boolean(scheduling.duplicatePrevented),
        });
      } else {
        releaseScheduleSlot(slotClaim);
      }

      warnings.push(...(scheduling.warnings || []));
    } catch (error) {
      releaseScheduleSlot(slotClaim);
      const failedPost = failedEbookPostResult({
        dayKey,
        publishDate,
        scheduledDateTime,
        dryRun,
        categoryName,
        error,
      });
      posts[dayKey] = failedPost;
      warnings.push(...failedPost.warnings);
      warn("oneup.ebooks.day.fail", {
        weekStartDate,
        day: dayKey,
        scheduledDateTime,
        statusCode: failedPost.statusCode,
        error: failedPost.error,
      });
    }
  }

  const postValues = Object.values(posts);
  const dryRunResult = postValues.some((item) => item.dryRun);
  const failedDays = Object.entries(posts)
    .filter(([, value]) => value?.failed)
    .map(([day, value]) => ({ day, statusCode: value.statusCode, error: value.error }));
  const hasFailures = failedDays.length > 0;

  info("oneup.ebooks.weekly.complete", {
    weekStartDate,
    featuredBookTitle: featuredBook.title,
    dryRun: dryRunResult,
    ok: !hasFailures,
    failedDays: failedDays.map((item) => item.day),
    contentHashes: Object.fromEntries(Object.entries(posts).map(([day, value]) => [day, contentHash(value.post?.content || "")])),
    imageUrl: featuredBook.coverArtUrl,
    selectionMethod: resolved.selection?.method,
    phase5GateScores: Object.fromEntries(Object.entries(posts).map(([day, value]) => [day, value.phase5Gate?.score ?? null])),
  });

  return {
    ok: !hasFailures,
    partialFailure: hasFailures,
    service: "oneup",
    lane: "ebooks-weekly",
    featuredBookTitle: featuredBook.title,
    featuredBook: {
      title: featuredBook.title,
      bookUrl: featuredBook.bookUrl,
      coverArtUrl: featuredBook.coverArtUrl,
      manuscriptUrl: featuredBook.manuscriptUrl,
      slug: featuredBook.slug,
      source: featuredBook.source,
    },
    selection: resolved.selection,
    dryRun: dryRunResult,
    posts,
    failedDays,
    warnings: [...new Set(warnings.filter(Boolean))],
  };
}

export async function buildAndScheduleQuizSeries(options = {}) {
  const questionPublishDate = options.questionPublishDate || nextWeekdayDateString("wednesday", DEFAULT_TIMEZONE, new Date());
  const answerPublishDate = options.answerPublishDate || addDays(questionPublishDate, 1);
  const questionDateTime = options.questionScheduledDateTime || toScheduledDateTime(questionPublishDate, QUIZ_CONFIG.questionPublishTime);
  const answerDateTime = options.answerScheduledDateTime || toScheduledDateTime(answerPublishDate, QUIZ_CONFIG.answerPublishTime);
  const categoryName = options.categoryName || ONEUP_CATEGORY_NAME_GENERAL;
  const socialNetworkId = normaliseOneUpSocialNetworkId(options.socialNetworkId || getOneUpSocialNetworkId());
  const apiKey = options.apiKey || process.env.ONEUP_API_KEY;
  const dryRun = Boolean(options.dryRun);
  const questionImageUrl = options.questionImageUrl || QUIZ_CONFIG.questionImageUrl;
  const answerImageUrl = options.answerImageUrl || QUIZ_CONFIG.answerImageUrl;

  const questionSlotClaim = await claimOneUpSlot({
    scope: "quiz:question",
    scheduledDateTime: questionDateTime,
    categoryName,
    socialNetworkId,
    imageUrl: questionImageUrl,
    dryRun,
    apiKey,
    force: options.force,
    sourceIntentHash: buildIntentHash({ audienceIntent: QUIZ_CONFIG.audienceIntent, angle: questionPublishDate }),
  });
  const answerSlotClaim = await claimOneUpSlot({
    scope: "quiz:answer",
    scheduledDateTime: answerDateTime,
    categoryName,
    socialNetworkId,
    imageUrl: answerImageUrl,
    dryRun,
    apiKey,
    force: options.force,
    sourceIntentHash: buildIntentHash({ audienceIntent: QUIZ_CONFIG.audienceIntent, angle: answerPublishDate }),
  });

  if (questionSlotClaim.duplicatePrevented && answerSlotClaim.duplicatePrevented) {
    const question = slotDuplicatePostResult({
      publishDate: questionPublishDate,
      scheduledDateTime: questionDateTime,
      dryRun: false,
      categoryName,
      reason: questionSlotClaim.reason,
    });
    const answer = slotDuplicatePostResult({
      publishDate: answerPublishDate,
      scheduledDateTime: answerDateTime,
      dryRun: false,
      categoryName,
      reason: answerSlotClaim.reason,
    });

    info("oneup.quiz.duplicate_prevented", {
      questionDateTime,
      answerDateTime,
      questionReason: questionSlotClaim.reason,
      answerReason: answerSlotClaim.reason,
    });

    return {
      ok: true,
      lane: "quiz",
      topic: null,
      dryRun: false,
      duplicatePrevented: true,
      question,
      answer,
    };
  }

  try {
    const quizHistory = getQuizHistory();

    const prompt = buildQuizPrompt({
      questionDate: questionPublishDate,
      answerDate: answerPublishDate,
      history: quizHistory.topics,
    });

    const sessionId = `ONEUP-QUIZ-${questionPublishDate}`;
    const generated = await requestStructuredOneUpJson({
      routeName: "oneupQuiz",
      sessionId,
      prompt,
      label: "quiz pair",
      normalise: normaliseQuizOutput,
      maxTokens: ONEUP_QUIZ_MAX_TOKENS,
      temperature: 0.55,
    });
    if (!generated.questionContent || !generated.answerContent) {
      const err = new Error("The quiz generator returned empty content.");
      err.statusCode = 502;
      throw err;
    }

    const questionPost = {
      title: generated.questionTitle,
      topic: generated.topic,
      firstComment: "",
      imageUrl: questionImageUrl,
      content: ensureHashtags(generated.questionContent, QUIZ_CONFIG.questionHashtags),
    };

    const answerPost = {
      title: generated.answerTitle,
      topic: generated.topic,
      firstComment: "",
      imageUrl: answerImageUrl,
      content: ensureHashtags(generated.answerContent, QUIZ_CONFIG.answerHashtags),
    };

    const questionGate = runOneUpSocialGate({ contentType: "oneup-quiz-question", laneKey: "quiz-question", post: questionPost });
    if (!questionGate.ok) throw buildGateError(questionGate, "Quiz question social gate");
    const answerGate = runOneUpSocialGate({ contentType: "oneup-quiz-answer", laneKey: "quiz-answer", post: answerPost });
    if (!answerGate.ok) throw buildGateError(answerGate, "Quiz answer social gate");

    if (!dryRun && apiKey && !questionSlotClaim.duplicatePrevented && !answerSlotClaim.duplicatePrevented) {
      await scheduleToOneUp({ post: questionPost, scheduledDateTime: questionDateTime, categoryName, socialNetworkId, dryRun, apiKey, preflightOnly: true });
      await scheduleToOneUp({ post: answerPost, scheduledDateTime: answerDateTime, categoryName, socialNetworkId, dryRun, apiKey, preflightOnly: true });
    }

    let answerScheduling;
    try {
      answerScheduling = answerSlotClaim.duplicatePrevented
        ? slotDuplicatePostResult({
            publishDate: answerPublishDate,
            scheduledDateTime: answerDateTime,
            dryRun: false,
            categoryName,
            reason: answerSlotClaim.reason,
          })
        : await scheduleToOneUp({
            post: answerPost,
            scheduledDateTime: answerDateTime,
            categoryName,
            socialNetworkId,
            dryRun,
            apiKey,
          });
    } catch (error) {
      answerScheduling = {
        publishDate: answerPublishDate,
        scheduledDateTime: answerDateTime,
        scheduled: false,
        dryRun: Boolean(dryRun),
        duplicatePrevented: false,
        failed: true,
        statusCode: statusCodeFromError(error),
        category: { id: null, category_name: categoryName },
        warnings: [`Quiz answer post failed before the question was scheduled: ${safeErrorMessage(error)}`, retryWarningFromError(error)].filter(Boolean),
        error: safeErrorMessage(error),
        retry: retrySummaryFromError(error),
        post: answerPost,
        oneUpResponse: null,
        targeting: error?.oneUpTargeting || null,
        oneUpSocialGate: error?.oneUpSocialGate || answerGate,
      };
    }

    let questionScheduling = answerScheduling.failed
      ? {
          publishDate: questionPublishDate,
          scheduledDateTime: questionDateTime,
          scheduled: false,
          dryRun: Boolean(dryRun),
          duplicatePrevented: false,
          failed: true,
          statusCode: 424,
          category: { id: null, category_name: categoryName },
          warnings: ["Quiz question was not scheduled because the answer post failed pre-question. This prevents an unanswered public quiz."],
          error: "answer-scheduling-failed-before-question",
          post: questionPost,
          oneUpResponse: null,
          targeting: null,
          oneUpSocialGate: questionGate,
        }
      : questionSlotClaim.duplicatePrevented
        ? slotDuplicatePostResult({
            publishDate: questionPublishDate,
            scheduledDateTime: questionDateTime,
            dryRun: false,
            categoryName,
            reason: questionSlotClaim.reason,
          })
        : await scheduleToOneUp({
            post: questionPost,
            scheduledDateTime: questionDateTime,
            categoryName,
            socialNetworkId,
            dryRun,
            apiKey,
          });

    if (questionScheduling.scheduled || answerScheduling.scheduled) {
      recordQuizSchedule({
        topic: generated.topic,
        questionDateTime,
        answerDateTime,
        questionTitle: questionPost.title,
        answerTitle: answerPost.title,
      });
      recordEditorialEvent({
        pipeline: "oneup",
        lane: "quiz",
        audienceIntent: QUIZ_CONFIG.audienceIntent,
        angle: generated.topic,
        scheduledDateTime: questionDateTime,
        text: `${questionPost.content}

${answerPost.content}`,
        meta: { contentType: "quiz-pair", answerScheduled: Boolean(answerScheduling.scheduled) },
      });
    }

    if (questionSlotClaim.claimed && (questionScheduling.scheduled || questionScheduling.duplicatePrevented)) {
      completeScheduleSlot(questionSlotClaim, {
        lane: "quiz",
        part: "question",
        scheduledDateTime: questionDateTime,
        topic: generated.topic,
        title: questionPost.title,
        duplicatePrevented: Boolean(questionScheduling.duplicatePrevented),
      });
    } else {
      releaseScheduleSlot(questionSlotClaim);
    }

    if (answerSlotClaim.claimed && (answerScheduling.scheduled || answerScheduling.duplicatePrevented)) {
      completeScheduleSlot(answerSlotClaim, {
        lane: "quiz",
        part: "answer",
        scheduledDateTime: answerDateTime,
        topic: generated.topic,
        title: answerPost.title,
        duplicatePrevented: Boolean(answerScheduling.duplicatePrevented),
      });
    } else {
      releaseScheduleSlot(answerSlotClaim);
    }

    info("oneup.quiz.complete", {
      questionDateTime,
      answerDateTime,
      dryRun: questionScheduling.dryRun || answerScheduling.dryRun,
      topic: generated.topic,
      questionHash: contentHash(questionPost.content),
      answerHash: contentHash(answerPost.content),
    });

    return {
      ok: !answerScheduling.failed,
      partialFailure: Boolean(answerScheduling.failed),
      lane: "quiz",
      topic: generated.topic,
      dryRun: questionScheduling.dryRun || answerScheduling.dryRun,
      warnings: [...new Set([...(questionScheduling.warnings || []), ...(answerScheduling.warnings || [])].filter(Boolean))],
      question: {
        publishDate: questionPublishDate,
        scheduledDateTime: questionDateTime,
        scheduled: questionScheduling.scheduled,
        duplicatePrevented: Boolean(questionScheduling.duplicatePrevented),
        category: questionScheduling.category,
        warnings: questionScheduling.warnings || [],
        post: questionPost,
        oneUpResponse: questionScheduling.oneUpResponse,
        targeting: questionScheduling.targeting || null,
        oneUpSocialGate: questionGate,
      },
      answer: {
        publishDate: answerPublishDate,
        scheduledDateTime: answerDateTime,
        scheduled: answerScheduling.scheduled,
        duplicatePrevented: Boolean(answerScheduling.duplicatePrevented),
        category: answerScheduling.category,
        warnings: answerScheduling.warnings || [],
        post: answerPost,
        oneUpResponse: answerScheduling.oneUpResponse,
        targeting: answerScheduling.targeting || null,
        failed: Boolean(answerScheduling.failed),
        error: answerScheduling.error || null,
        oneUpSocialGate: answerGate,
      },
    };
  } catch (error) {
    releaseScheduleSlot(questionSlotClaim);
    releaseScheduleSlot(answerSlotClaim);
    throw error;
  }
}
