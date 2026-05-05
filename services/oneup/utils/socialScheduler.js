import crypto from "node:crypto";
import { resilientRequest } from "../../shared/utils/ai-service.js";
import { info, warn } from "../../../logger.js";
import { LANE_CONFIG, QUIZ_CONFIG, EBOOK_WEEKLY_CONFIG, ONEUP_CATEGORY_NAME_GENERAL, ONEUP_DEFAULT_DRY_RUN, ONEUP_SOCIAL_NETWORK_ID, DEFAULT_TIMEZONE, ONEUP_QUEUE_GUARD_LOOKBACK_PAGES } from "./config.js";
import { buildDailyPrompt, buildQuizPrompt, buildEbookPostPrompt } from "./prompts.js";
import { addDays, nextWeekdayDateString, toScheduledDateTime } from "./date.js";
import { loadRecentRssContext } from "./feedContext.js";
import { getLaneHistory, recordLaneSchedule, getQuizHistory, recordQuizSchedule } from "./state.js";
import { resolveCategory, listScheduledPosts, scheduleTextPost, scheduleImagePost } from "./oneupClient.js";
import { resolveFeaturedBookForEbooks } from "./featuredBook.js";


const ONEUP_DAILY_MAX_TOKENS = Math.max(1200, Number(process.env.ONEUP_DAILY_MAX_TOKENS || 1400));
const ONEUP_QUIZ_MAX_TOKENS = Math.max(1800, Number(process.env.ONEUP_QUIZ_MAX_TOKENS || 2200));
const ONEUP_EBOOK_MAX_TOKENS = Math.max(1400, Number(process.env.ONEUP_EBOOK_MAX_TOKENS || 1800));

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

function stripHashtags(content) {
  return compactText(content)
    .replace(/(^|\s)#[A-Za-z0-9_]+/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function ensureHashtags(content, hashtags) {
  const base = stripHashtags(content);
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

function normaliseEbookOutput(raw, featuredBook) {
  const parsed = parseJsonObject(raw, "ebook post");
  return {
    title: compactText(parsed.title || featuredBook.title).slice(0, 80),
    topic: compactText(parsed.topic || featuredBook.title).slice(0, 120),
    content: stripHashtags(parsed.content || ""),
    firstComment: `Featured book: ${featuredBook.title}\nRead more: ${featuredBook.bookUrl}`,
  };
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
    imageUrl: options.imageUrl || lane.imageUrl,
    content: ensureHashtags(generated.content, lane.hashtags),
  };

  const scheduling = await scheduleToOneUp({
    post,
    scheduledDateTime,
    categoryName,
    socialNetworkId,
    dryRun: Boolean(options.dryRun),
    apiKey: options.apiKey || process.env.ONEUP_API_KEY,
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
}

function resolveEbookDateTime({ day, publishDate, options }) {
  const scheduledOverrides = options?.scheduledDateTimes || {};
  const timeOverrides = options?.publishTimes || {};
  const lane = LANE_CONFIG[day];

  return scheduledOverrides[day] || toScheduledDateTime(
    publishDate,
    timeOverrides[day] || lane.publishTime
  );
}

export async function buildAndScheduleEbookWeeklySeries(options = {}) {
  const weekStartDate = options.weekStartDate || nextWeekdayDateString("monday", DEFAULT_TIMEZONE, new Date());
  const categoryName = options.categoryName || "Ebooks";
  const socialNetworkId = options.socialNetworkId || ONEUP_SOCIAL_NETWORK_ID;
  const apiKey = options.apiKey || process.env.ONEUP_API_KEY;
  const { featuredBook, warnings: sourceWarnings } = await resolveFeaturedBookForEbooks(options);

  const posts = {};
  const allWarnings = [...sourceWarnings];

  for (const day of EBOOK_WEEKLY_CONFIG.weekdays) {
    const publishDate = addDays(weekStartDate, day === "tuesday" ? 1 : day === "thursday" ? 3 : 5);
    const scheduledDateTime = resolveEbookDateTime({ day, publishDate, options });
    const prompt = buildEbookPostPrompt({ day, publishDate, featuredBook });
    const sessionId = `ONEUP-EBOOK-${day.toUpperCase()}-${publishDate}-${contentHash(featuredBook.title)}`;

    const generated = await requestStructuredOneUpJson({
      routeName: "oneupEbook",
      sessionId,
      prompt,
      label: `${day} ebook post`,
      normalise: (raw) => normaliseEbookOutput(raw, featuredBook),
      maxTokens: ONEUP_EBOOK_MAX_TOKENS,
      temperature: day === "saturday" ? 0.65 : 0.55,
    });

    if (!generated.content) {
      const err = new Error(`The ${day} ebook generator returned empty content.`);
      err.statusCode = 502;
      throw err;
    }

    const post = {
      title: generated.title,
      topic: generated.topic,
      firstComment: generated.firstComment,
      imageUrl: featuredBook.coverArtUrl || "",
      content: ensureHashtags(generated.content, EBOOK_WEEKLY_CONFIG.hashtags),
    };

    const scheduling = await scheduleToOneUp({
      post,
      scheduledDateTime,
      categoryName,
      socialNetworkId,
      dryRun: Boolean(options.dryRun),
      apiKey,
    });

    allWarnings.push(...(scheduling.warnings || []));

    posts[day] = {
      publishDate,
      scheduledDateTime,
      scheduled: scheduling.scheduled,
      dryRun: scheduling.dryRun,
      duplicatePrevented: Boolean(scheduling.duplicatePrevented),
      category: scheduling.category,
      warnings: scheduling.warnings || [],
      post,
      oneUpResponse: scheduling.oneUpResponse,
    };
  }

  const dryRun = Object.values(posts).some((item) => item.dryRun) || Boolean(options.dryRun || ONEUP_DEFAULT_DRY_RUN || !apiKey);

  info("oneup.ebooks.weekly.complete", {
    weekStartDate,
    featuredBookTitle: featuredBook.title,
    dryRun,
    contentHashes: Object.fromEntries(
      Object.entries(posts).map(([day, item]) => [day, contentHash(item.post.content)])
    ),
  });

  return {
    ok: true,
    service: "oneup",
    lane: "ebooks-weekly",
    featuredBookTitle: featuredBook.title,
    featuredBookSource: featuredBook.source,
    weekStartDate,
    dryRun,
    posts,
    warnings: [...new Set(allWarnings)],
  };
}

export async function buildAndScheduleQuizSeries(options = {}) {
  const questionPublishDate = options.questionPublishDate || nextWeekdayDateString("wednesday", DEFAULT_TIMEZONE, new Date());
  const answerPublishDate = options.answerPublishDate || addDays(questionPublishDate, 1);
  const questionDateTime = options.questionScheduledDateTime || toScheduledDateTime(questionPublishDate, QUIZ_CONFIG.questionPublishTime);
  const answerDateTime = options.answerScheduledDateTime || toScheduledDateTime(answerPublishDate, QUIZ_CONFIG.answerPublishTime);
  const categoryName = options.categoryName || ONEUP_CATEGORY_NAME_GENERAL;
  const socialNetworkId = options.socialNetworkId || ONEUP_SOCIAL_NETWORK_ID;
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
    imageUrl: options.questionImageUrl || QUIZ_CONFIG.questionImageUrl,
    content: ensureHashtags(generated.questionContent, QUIZ_CONFIG.questionHashtags),
  };

  const answerPost = {
    title: generated.answerTitle,
    topic: generated.topic,
    firstComment: "",
    imageUrl: options.answerImageUrl || QUIZ_CONFIG.answerImageUrl,
    content: ensureHashtags(generated.answerContent, QUIZ_CONFIG.answerHashtags),
  };

  const apiKey = options.apiKey || process.env.ONEUP_API_KEY;
  const questionScheduling = await scheduleToOneUp({
    post: questionPost,
    scheduledDateTime: questionDateTime,
    categoryName,
    socialNetworkId,
    dryRun: Boolean(options.dryRun),
    apiKey,
  });

  const answerScheduling = await scheduleToOneUp({
    post: answerPost,
    scheduledDateTime: answerDateTime,
    categoryName,
    socialNetworkId,
    dryRun: Boolean(options.dryRun),
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
}
