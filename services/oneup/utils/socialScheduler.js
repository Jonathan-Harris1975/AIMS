import crypto from "node:crypto";
import { resilientRequest } from "../../shared/utils/ai-service.js";
import { info, warn } from "../../../logger.js";
import { LANE_CONFIG, QUIZ_CONFIG, EBOOK_CONFIG, ONEUP_CATEGORY_NAME_GENERAL, ONEUP_CATEGORY_NAME_EBOOKS, ONEUP_DEFAULT_DRY_RUN, ONEUP_SOCIAL_NETWORK_ID, DEFAULT_TIMEZONE, ONEUP_QUEUE_GUARD_LOOKBACK_PAGES } from "./config.js";
import { buildDailyPrompt, buildQuizPrompt, buildEbookPostPrompt } from "./prompts.js";
import { addDays, nextWeekdayDateString, toScheduledDateTime } from "./date.js";
import { loadRecentRssContext } from "./feedContext.js";
import { getLaneHistory, recordLaneSchedule, getQuizHistory, recordQuizSchedule, claimScheduleSlot, completeScheduleSlot, releaseScheduleSlot } from "./state.js";
import { resolveCategory, listScheduledPosts, scheduleTextPost, scheduleImagePost } from "./oneupClient.js";
import getSponsor from "../../script/utils/getSponsor.js";
import { resolveFeaturedEbook } from "./ebookCatalogue.js";
import { runPhase5OrganicGrowthGate } from "../../content-quality/phase5OrganicGrowthGates.js";


const ONEUP_DAILY_MAX_TOKENS = Math.max(1200, Number(process.env.ONEUP_DAILY_MAX_TOKENS || 1400));
const ONEUP_QUIZ_MAX_TOKENS = Math.max(1800, Number(process.env.ONEUP_QUIZ_MAX_TOKENS || 2200));
const ONEUP_EBOOK_MAX_TOKENS = Math.max(1200, Number(process.env.ONEUP_EBOOK_MAX_TOKENS || 1600));

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

function ensureHashtags(content, hashtags) {
  const base = compactText(content);
  const tags = (Array.isArray(hashtags) ? hashtags : []).filter(Boolean);
  if (!tags.length) return base;

  const missing = tags.filter((tag) => !base.includes(tag));
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

function hasLikelyDuplicate(queuedPosts, { scheduledDateTime, categoryName, imageUrl }) {
  return (Array.isArray(queuedPosts) ? queuedPosts : []).some((item) => {
    const sameTime = String(item?.date_time || "").startsWith(scheduledDateTime);
    const sameCategory = String(item?.category_name || "").trim().toLowerCase() === String(categoryName || "").trim().toLowerCase();
    const sameImage = !imageUrl || String(item?.content_image || "").trim() === String(imageUrl || "").trim();
    return sameTime && sameCategory && sameImage;
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

async function claimOneUpSlot({ scope, scheduledDateTime, categoryName, socialNetworkId, imageUrl, dryRun, apiKey, force }) {
  if (isEffectiveDryRun({ dryRun, apiKey }) || isTruthyOption(force)) {
    return { claimed: false, skipped: true, duplicatePrevented: false, key: null };
  }

  return claimScheduleSlot({ scope, scheduledDateTime, categoryName, socialNetworkId, imageUrl });
}


function statusCodeFromError(error) {
  const status = Number(error?.statusCode || error?.status);
  return Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
}

function safeErrorMessage(error) {
  return error?.message || String(error || "Unknown error");
}

function failedEbookPostResult({ dayKey, publishDate, scheduledDateTime, dryRun, categoryName, error }) {
  const statusCode = statusCodeFromError(error);
  const message = `${dayKey.charAt(0).toUpperCase()}${dayKey.slice(1)} ebook post failed: ${safeErrorMessage(error)}`;
  return {
    publishDate,
    scheduledDateTime,
    scheduled: false,
    dryRun: Boolean(dryRun),
    duplicatePrevented: false,
    failed: true,
    statusCode,
    category: { id: null, category_name: categoryName },
    warnings: [message],
    error: safeErrorMessage(error),
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

async function scheduleToOneUp({ post, scheduledDateTime, categoryName, socialNetworkId, dryRun, apiKey }) {
  const warnings = [];
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
    };
  }

  const category = await resolveCategory({ categoryName }, apiKey);
  const queuedPosts = await getQueuedPosts(apiKey);
  if (hasLikelyDuplicate(queuedPosts, { scheduledDateTime, categoryName: category.category_name, imageUrl: post.imageUrl })) {
    warnings.push("A likely duplicate post is already scheduled for this date/time/category, so no new post was created.");
    return {
      scheduled: false,
      dryRun: false,
      warnings,
      oneUpResponse: null,
      category,
      duplicatePrevented: true,
    };
  }

  const payload = {
    category_id: category.id,
    social_network_id: socialNetworkId,
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
  };
}

function normaliseDailyOutput(raw, lane) {
  const parsed = parseJsonObject(raw, `${lane.key} daily post`);
  return {
    title: compactText(parsed.title || lane.label).slice(0, 80),
    topic: compactText(parsed.topic || lane.label).slice(0, 120),
    content: compactText(parsed.content || ""),
    firstComment: compactText(parsed.firstComment || ""),
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
  const socialNetworkId = options.socialNetworkId || ONEUP_SOCIAL_NETWORK_ID;
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

  try {
    const laneHistory = getLaneHistory(laneKey);
    const rssContext = laneKey === "saturday" || laneKey === "sunday"
      ? await loadRecentRssContext({})
      : { ok: true, items: [], warning: null };

    const prompt = buildDailyPrompt({
      lane,
      publishDate,
      history: laneHistory.topics,
      rssItems: rssContext.items,
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
    };

    const scheduling = await scheduleToOneUp({
      post,
      scheduledDateTime,
      categoryName,
      socialNetworkId,
      dryRun,
      apiKey,
    });

    const warnings = [...(rssContext.warning ? [rssContext.warning] : []), ...(scheduling.warnings || [])];

    if (scheduling.scheduled) {
      recordLaneSchedule(laneKey, {
        scheduledDateTime,
        topic: post.topic,
        title: post.title,
        imageUrl: post.imageUrl,
      });
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
    };
  } catch (error) {
    releaseScheduleSlot(slotClaim);
    throw error;
  }
}

export async function buildAndScheduleEbookWeekly(options = {}) {
  const weekStartDate = options.weekStartDate || nextWeekdayDateString("monday", DEFAULT_TIMEZONE, new Date());
  const categoryName = options.categoryName || ONEUP_CATEGORY_NAME_EBOOKS;
  const socialNetworkId = options.socialNetworkId || ONEUP_SOCIAL_NETWORK_ID;
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
        phase5Gate,
      };

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
  const socialNetworkId = options.socialNetworkId || ONEUP_SOCIAL_NETWORK_ID;
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

    const questionScheduling = questionSlotClaim.duplicatePrevented
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

    const answerScheduling = answerSlotClaim.duplicatePrevented
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

    if (questionScheduling.scheduled || answerScheduling.scheduled) {
      recordQuizSchedule({
        topic: generated.topic,
        questionDateTime,
        answerDateTime,
        questionTitle: questionPost.title,
        answerTitle: answerPost.title,
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
      ok: true,
      lane: "quiz",
      topic: generated.topic,
      dryRun: questionScheduling.dryRun || answerScheduling.dryRun,
      question: {
        publishDate: questionPublishDate,
        scheduledDateTime: questionDateTime,
        scheduled: questionScheduling.scheduled,
        duplicatePrevented: Boolean(questionScheduling.duplicatePrevented),
        category: questionScheduling.category,
        warnings: questionScheduling.warnings || [],
        post: questionPost,
        oneUpResponse: questionScheduling.oneUpResponse,
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
      },
    };
  } catch (error) {
    releaseScheduleSlot(questionSlotClaim);
    releaseScheduleSlot(answerSlotClaim);
    throw error;
  }
}
