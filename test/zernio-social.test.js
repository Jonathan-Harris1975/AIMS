import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
}

function applyBaseEnv() {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  process.env.ALLOW_EPHEMERAL_STATE = "true";
  process.env.APP_TMP_DIR = path.join(os.tmpdir(), `ai-mgmt-zernio-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  process.env.OPENROUTER_CHATGPT = "openai/test-model";
  process.env.OPENROUTER_API_KEY_CHATGPT = "test-key";
  delete process.env.OPENROUTER_GOOGLE;
  delete process.env.OPENROUTER_API_KEY_GOOGLE;
  delete process.env.OPENROUTER_DEEPSEEK;
  delete process.env.OPENROUTER_API_KEY_DEEPSEEK;
  delete process.env.ZERNIO_META_API_KEY;
  process.env.ZERNIO_DEFAULT_DRY_RUN = "false";
  process.env.ZERNIO_PROFILE_NAME_EBOOKS = "Ebooks";
  process.env.ZERNIO_TUESDAY_TIME = "13:00";
  process.env.ZERNIO_THURSDAY_TIME = "12:20";
  process.env.ZERNIO_SATURDAY_TIME = "10:30";
}

const scheduledRequests = [];
let zernioScheduleFailuresRemaining = 0;
let zernioScheduleAttempts = 0;
let quizAnswerContentOverride = null;

// Mock server shaped after the documented Zernio REST API
// (https://docs.zernio.com/): GET /profiles, GET /accounts, GET /analytics,
// POST /posts. This replaces the OneUp-shaped mock server this test used
// before the migration (listcategory, listcategoryaccount, getscheduledposts,
// scheduletextpost/scheduleimagepost).
const mockServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");

  if (req.method === "GET" && url.pathname === "/profiles") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      profiles: [
        { _id: "prof-general", name: "General" },
        { _id: "prof-ebooks", name: "Ebooks" },
      ],
    }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/accounts") {
    const profileId = url.searchParams.get("profileId");
    const data = profileId === "prof-general"
      ? [
          { _id: "fb-page-1", username: "Jonathan Harris", platform: "facebook" },
          { _id: "ig-account-1", username: "AI Book Shelf", platform: "instagram" },
        ]
      : profileId === "prof-ebooks"
        ? [{ _id: "ig-account-1", username: "AI Book Shelf", platform: "instagram" }]
        : [{ _id: "fb-page-1", username: "Jonathan Harris", platform: "facebook", isExpired: false, needsReconnect: false }];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ accounts: data }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/analytics") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ posts: [] }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/posts") {
    zernioScheduleAttempts += 1;
    let body = "";
    for await (const chunk of req) body += chunk;
    if (zernioScheduleFailuresRemaining > 0) {
      zernioScheduleFailuresRemaining -= 1;
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "temporary Zernio outage" }));
      return;
    }
    const parsed = JSON.parse(body || "{}");
    scheduledRequests.push({ endpoint: url.pathname, body: parsed });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ post: { _id: "post_abc123", status: "scheduled" } }));
    return;
  }

  if (req.method !== "POST" || url.pathname !== "/chat/completions") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;
  const payload = JSON.parse(body || "{}");
  const joined = JSON.stringify(payload.messages || []);

  let content;
  if (joined.includes("Create one ebook social post")) {
    const userMessage = (payload.messages || []).find((message) => message?.role === "user")?.content || "";
    const day = userMessage.match(/Post day:\s*(Tuesday|Thursday|Saturday)/)?.[1] || "Tuesday";
    content = JSON.stringify({
      title: `${day} Ebook Angle`,
      topic: `${day} book angle`,
      content: `${day} post copy for readers who want to understand artificial intelligence without swallowing the hype. The book helps them spot weak claims, ask better questions, and use tools carefully in ordinary work. It is practical, grounded, and useful even before anyone clicks through. #ModelNoise`,
      firstComment: "Featured book: Practical AI Thinking\nRead more: https://example.com/practical-ai-thinking",
    });
  } else if (joined.includes("paired weekly AI quiz")) {
    content = JSON.stringify({
      topic: "Transformer basics",
      questionTitle: "Weekly AI Quiz",
      questionContent:
        "Which architecture made modern large language models practical?\nA) Decision Tree\nB) Transformer\nC) K-Means\nD) Linear Regression\n\nComment your answer below.",
      answerTitle: "Quiz Answer",
      answerContent:
        quizAnswerContentOverride ?? "Quiz Answer! The correct answer is B) Transformer. Transformers handle context far better than older sequence models, which is why they sit underneath most modern LLMs. Did you get it right?",
    });
  } else {
    content = JSON.stringify({
      title: "Monday Motivation",
      topic: "Steady systems",
      content:
        '"There is nothing so useless as doing efficiently that which should not be done at all." - Peter Drucker\n\nAI work gets better when you stop chasing theatre and keep shipping the useful bits.',
      firstComment: "",
    });
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      choices: [
        {
          message: {
            content,
          },
        },
      ],
    })
  );
});

await new Promise((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
const mockAddress = mockServer.address();
const mockBase = `http://127.0.0.1:${mockAddress.port}`;

test.after(async () => {
  await new Promise((resolve, reject) => mockServer.close((err) => (err ? reject(err) : resolve())));
});

test.afterEach(() => {
  scheduledRequests.length = 0;
  zernioScheduleFailuresRemaining = 0;
  zernioScheduleAttempts = 0;
  quizAnswerContentOverride = null;
  restoreEnv();
});

const FEATURED_BOOK = {
  title: "Practical AI Thinking",
  shortDescription: "A plain-English guide to using AI tools without swallowing the hype.",
  summary: "Explains practical AI decisions, everyday workflows, and the judgement needed around modern tools.",
  keywords: "artificial intelligence, AI literacy, workflows",
  audience: "Curious readers, authors, creators, and small business owners",
  whoThisBookIsFor: "Readers who want useful AI understanding without technical fog.",
  whatThisBookCovers: "AI basics, practical workflows, risks, and better questions to ask before adopting tools.",
  whatYouWillLearn: "How to judge AI use cases, spot weak claims, and apply tools sensibly.",
  whyItMatters: "AI decisions are moving into ordinary work, not just technical teams.",
  bookUrl: "https://example.com/practical-ai-thinking",
  coverArtUrl: "https://example.com/practical-ai-thinking-cover.jpg",
};

test("Zernio request schema coerces dryRun and array accountId", async () => {
  const mod = await import(`../services/shared/utils/requestSchemas.js?zernio-schema=${Date.now()}`);
  const parsed = mod.validateBody(mod.zernioDailyBodySchema, {
    dryRun: "true",
    accountId: ["acc-1", "acc-2"],
    publishDate: "2026-04-13",
  });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.dryRun, true);
  assert.equal(parsed.data.accountId, '["acc-1","acc-2"]');
});

test("Zernio ebook weekly request schema validates featured book payload and overrides", async () => {
  const mod = await import(`../services/shared/utils/requestSchemas.js?zernio-ebook-schema=${Date.now()}`);
  const parsed = mod.validateBody(mod.zernioEbookWeeklyBodySchema, {
    weekStartDate: "2026-05-04",
    dryRun: "true",
    profileName: "Ebooks",
    accountId: ["fb-page", "ig-account"],
    thursdayPublishTime: "15:45",
    featuredBook: FEATURED_BOOK,
  });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.dryRun, true);
  assert.equal(parsed.data.accountId, '["fb-page","ig-account"]');
  assert.equal(parsed.data.featuredBook.coverArtUrl, FEATURED_BOOK.coverArtUrl);
  assert.equal(parsed.data.thursdayPublishTime, "15:45");

  const invalid = mod.validateBody(mod.zernioEbookWeeklyBodySchema, {
    weekStartDate: "2026/05/04",
    featuredBook: { ...FEATURED_BOOK, title: "", bookUrl: "not-a-url" },
  });

  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /weekStartDate|featuredBook\.title|featuredBook\.bookUrl/);
});

test("buildAndScheduleDailyLane returns a dry-run Monday preview with hashtags", async () => {
  restoreEnv();
  applyBaseEnv();
  process.env.OPENROUTER_API_BASE = mockBase;

  const mod = await import(`../services/zernio/utils/socialScheduler.js?zernio-daily=${Date.now()}`);
  const result = await mod.buildAndScheduleDailyLane("monday", {
    publishDate: "2026-04-13",
    dryRun: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.scheduled, false);
  assert.equal(result.publishDate, "2026-04-13");
  assert.match(result.post.content, /#ArtificialIntelligence/);
  assert.match(result.post.content, /shipping the useful bits/i);
});

test("buildAndScheduleQuizSeries returns dry-run question and answer posts", async () => {
  restoreEnv();
  applyBaseEnv();
  process.env.OPENROUTER_API_BASE = mockBase;

  const mod = await import(`../services/zernio/utils/socialScheduler.js?zernio-quiz=${Date.now()}`);
  const result = await mod.buildAndScheduleQuizSeries({
    questionPublishDate: "2026-04-15",
    answerPublishDate: "2026-04-16",
    dryRun: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.question.scheduled, false);
  assert.equal(result.answer.scheduled, false);
  assert.match(result.question.post.content, /#AIQuiz/);
  assert.match(result.answer.post.content, /Did you get it right\?/);
});

test("buildAndScheduleQuizSeries repairs a missing answer marker before the gate runs", async () => {
  restoreEnv();
  applyBaseEnv();
  process.env.OPENROUTER_API_BASE = mockBase;
  quizAnswerContentOverride =
    "The correct answer is B) Transformer. Transformers use attention to track context across a sequence, which is why they became the backbone of modern LLMs. Did you get it right?";

  const mod = await import(`../services/zernio/utils/socialScheduler.js?zernio-quiz-marker=${Date.now()}`);
  const result = await mod.buildAndScheduleQuizSeries({
    questionPublishDate: "2026-04-22",
    answerPublishDate: "2026-04-23",
    dryRun: true,
  });

  assert.equal(result.ok, true);
  assert.match(result.answer.post.content, /^Quiz Answer! The correct answer is B\) Transformer/);
  assert.match(result.answer.post.content, /#AIQuiz/);
});


test("buildAndScheduleEbookWeekly returns dry-run Tuesday, Thursday, and Saturday ebook posts", async () => {
  restoreEnv();
  applyBaseEnv();
  process.env.OPENROUTER_API_BASE = mockBase;

  const mod = await import(`../services/zernio/utils/socialScheduler.js?zernio-ebooks=${Date.now()}`);
  const result = await mod.buildAndScheduleEbookWeekly({
    weekStartDate: "2026-05-04",
    dryRun: true,
    profileName: "Ebooks",
    accountId: "ALL",
    featuredBook: FEATURED_BOOK,
  });

  assert.equal(result.ok, true);
  assert.equal(result.service, "zernio");
  assert.equal(result.lane, "ebooks-weekly");
  assert.equal(result.featuredBookTitle, FEATURED_BOOK.title);
  assert.equal(result.dryRun, true);
  assert.deepEqual(Object.keys(result.posts), ["tuesday", "thursday", "saturday"]);
  assert.equal(result.posts.tuesday.publishDate, "2026-05-05");
  assert.equal(result.posts.thursday.publishDate, "2026-05-07");
  assert.equal(result.posts.saturday.publishDate, "2026-05-09");
  assert.equal(result.posts.tuesday.scheduledDateTime, "2026-05-05 16:00");
  assert.equal(result.posts.thursday.scheduledDateTime, "2026-05-07 15:30");
  assert.equal(result.posts.saturday.scheduledDateTime, "2026-05-09 14:30");
  assert.equal(result.posts.tuesday.scheduled, false);
  assert.equal(result.posts.thursday.scheduled, false);
  assert.equal(result.posts.saturday.scheduled, false);
});

test("buildAndScheduleEbookWeekly keeps one featured book, appends scheduler hashtags, and uses cover art", async () => {
  restoreEnv();
  applyBaseEnv();
  process.env.OPENROUTER_API_BASE = mockBase;

  const scheduler = await import(`../services/zernio/utils/socialScheduler.js?zernio-ebook-details=${Date.now()}`);
  const prompts = await import(`../services/zernio/utils/prompts.js?zernio-ebook-prompt=${Date.now()}`);
  const prompt = prompts.buildEbookPostPrompt({
    day: "tuesday",
    publishDate: "2026-05-05",
    featuredBook: FEATURED_BOOK,
  });

  assert.match(prompt.system, /no hashtags in the model output/);
  assert.doesNotMatch(prompt.user, /#ArtificialIntelligence|#AIBooks|#AIExplained|#JonathanHarris/);

  const result = await scheduler.buildAndScheduleEbookWeekly({
    weekStartDate: "2026-05-04",
    dryRun: true,
    featuredBook: FEATURED_BOOK,
  });

  for (const day of ["tuesday", "thursday", "saturday"]) {
    const post = result.posts[day].post;
    assert.equal(post.firstComment, `Featured book: ${FEATURED_BOOK.title}\nRead more: ${FEATURED_BOOK.bookUrl}`);
    assert.equal(post.imageUrl, FEATURED_BOOK.coverArtUrl);
    assert.match(post.content, /#ArtificialIntelligence/);
    assert.match(post.content, /#AIBooks/);
    assert.match(post.content, /#AIExplained/);
    assert.doesNotMatch(post.content, /#JonathanHarris/);
    assert.doesNotMatch(post.content, /#ModelNoise/);
    assert.doesNotMatch(post.firstComment, /#ArtificialIntelligence|#AIBooks|#AIExplained|#JonathanHarris/);
  }
});



test("Zernio account IDs are normalised for API scheduling", async () => {
  const mod = await import(`../services/zernio/utils/config.js?zernio-config=${Date.now()}`);

  assert.equal(mod.normaliseZernioAccountId("ALL"), "ALL");
  assert.equal(mod.normaliseZernioAccountId("fb-page-1"), '["fb-page-1"]');
  assert.equal(mod.normaliseZernioAccountId("fb-page-1,ig-account-1"), '["fb-page-1","ig-account-1"]');
  assert.equal(mod.normaliseZernioAccountId('["fb-page-1","ig-account-1"]'), '["fb-page-1","ig-account-1"]');
});

test("buildAndScheduleDailyLane validates Facebook targeting before live scheduling", async () => {
  restoreEnv();
  applyBaseEnv();
  process.env.OPENROUTER_API_BASE = mockBase;
  process.env.ZERNIO_API_BASE_URL = mockBase;
  process.env.ZERNIO_META_API_KEY = "zernio-key";
  process.env.ZERNIO_REQUIRED_PLATFORMS = "facebook";
  process.env.ZERNIO_VALIDATE_TARGET_ACCOUNTS = "true";

  const mod = await import(`../services/zernio/utils/socialScheduler.js?zernio-live-fb=${Date.now()}`);
  const result = await mod.buildAndScheduleDailyLane("monday", {
    publishDate: "2026-04-13",
    profileName: "General",
    accountId: "fb-page-1",
    force: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.scheduled, true);
  assert.equal(result.targeting.ok, true);
  assert.equal(result.targeting.targetedAccounts[0].platform, "facebook");
  assert.deepEqual(scheduledRequests.at(-1).body.platforms, [{ platform: "facebook", accountId: "fb-page-1" }]);
  // Regression test: lane images are served from extensionless URLs
  // (e.g. https://images.jonathan-harris.online/Monday). Zernio's
  // `mediaUrls` shorthand infers media type from the URL and silently
  // drops images with no file extension, so the request must use
  // `mediaItems` with an explicit `type` instead.
  assert.equal(scheduledRequests.at(-1).body.mediaUrls, undefined);
  assert.deepEqual(scheduledRequests.at(-1).body.mediaItems, [
    { type: "image", url: "https://images.jonathan-harris.online/Monday" },
  ]);
});

test("buildAndScheduleDailyLane retries a transient Zernio scheduling failure", async () => {
  restoreEnv();
  applyBaseEnv();
  process.env.OPENROUTER_API_BASE = mockBase;
  process.env.ZERNIO_API_BASE_URL = mockBase;
  process.env.ZERNIO_META_API_KEY = "zernio-key";
  process.env.ZERNIO_REQUIRED_PLATFORMS = "facebook";
  process.env.ZERNIO_VALIDATE_TARGET_ACCOUNTS = "true";
  process.env.ZERNIO_API_RETRY_ATTEMPTS = "2";
  process.env.ZERNIO_API_RETRY_BASE_MS = "1";
  process.env.ZERNIO_API_RETRY_MAX_MS = "5";
  zernioScheduleFailuresRemaining = 1;

  const mod = await import(`../services/zernio/utils/socialScheduler.js?zernio-live-retry=${Date.now()}`);
  const result = await mod.buildAndScheduleDailyLane("monday", {
    publishDate: "2026-04-13",
    profileName: "General",
    accountId: "fb-page-1",
    force: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.scheduled, true);
  assert.equal(zernioScheduleAttempts, 2);
  assert.equal(scheduledRequests.length, 1);
  assert.deepEqual(result.zernioResponse._zernioRetry, { attempts: 2, recovered: true, operation: "POST posts" });
});


test("buildAndScheduleDailyLane fails loudly when required Facebook targeting is missing", async () => {
  restoreEnv();
  applyBaseEnv();
  process.env.OPENROUTER_API_BASE = mockBase;
  process.env.ZERNIO_API_BASE_URL = mockBase;
  process.env.ZERNIO_META_API_KEY = "zernio-key";
  process.env.ZERNIO_REQUIRED_PLATFORMS = "facebook";
  process.env.ZERNIO_VALIDATE_TARGET_ACCOUNTS = "true";

  const mod = await import(`../services/zernio/utils/socialScheduler.js?zernio-missing-fb=${Date.now()}`);

  await assert.rejects(
    () => mod.buildAndScheduleDailyLane("monday", {
      publishDate: "2026-04-13",
      profileName: "Ebooks",
      accountId: "ALL",
      force: true,
    }),
    /Zernio target setup failed.*facebook/
  );

  assert.equal(scheduledRequests.length, 0);
});

test("Tuesday lane uses the updated brand-safe hashtag set", async () => {
  restoreEnv();
  applyBaseEnv();
  process.env.OPENROUTER_API_BASE = mockBase;

  const mod = await import(`../services/zernio/utils/socialScheduler.js?zernio-tuesday=${Date.now()}`);
  const result = await mod.buildAndScheduleDailyLane("tuesday", {
    publishDate: "2026-04-14",
    dryRun: true,
  });

  assert.equal(result.ok, true);
  assert.doesNotMatch(result.post.content, /#TechTalkTuesday/);
  assert.match(result.post.content, /#AIExplained/);
  assert.match(result.post.content, /#ArtificialIntelligence/);
  assert.match(result.post.content, /#PracticalAI/);
});
