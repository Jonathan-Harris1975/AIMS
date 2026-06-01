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
  process.env.APP_TMP_DIR = path.join(os.tmpdir(), `ai-mgmt-oneup-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  process.env.OPENROUTER_CHATGPT = "openai/test-model";
  process.env.OPENROUTER_API_KEY_CHATGPT = "test-key";
  delete process.env.OPENROUTER_GOOGLE;
  delete process.env.OPENROUTER_API_KEY_GOOGLE;
  delete process.env.OPENROUTER_DEEPSEEK;
  delete process.env.OPENROUTER_API_KEY_DEEPSEEK;
  delete process.env.ONEUP_API_KEY;
  process.env.ONEUP_DEFAULT_DRY_RUN = "false";
  process.env.ONEUP_CATEGORY_NAME_EBOOKS = "Ebooks";
  process.env.ONEUP_TUESDAY_TIME = "13:00";
  process.env.ONEUP_THURSDAY_TIME = "12:20";
  process.env.ONEUP_SATURDAY_TIME = "10:30";
}

const scheduledRequests = [];
let oneUpScheduleFailuresRemaining = 0;
let oneUpScheduleAttempts = 0;

const mockServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");

  if (req.method === "GET" && url.pathname === "/listcategory") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      message: "OK",
      error: false,
      data: [
        { id: 1, category_name: "General", isPaused: 0 },
        { id: 2, category_name: "Ebooks", isPaused: 0 },
      ],
    }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/listcategoryaccount") {
    const categoryId = url.searchParams.get("category_id");
    const data = categoryId === "1"
      ? [
          { category_id: 1, social_network_name: "Jonathan Harris", social_network_id: "fb-page-1", social_network_type: "Facebook" },
          { category_id: 1, social_network_name: "AI Book Shelf", social_network_id: "ig-account-1", social_network_type: "Instagram" },
        ]
      : [
          { category_id: 2, social_network_name: "AI Book Shelf", social_network_id: "ig-account-1", social_network_type: "Instagram" },
        ];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "OK", error: false, data }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/listsocialaccounts") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      message: "OK",
      error: false,
      data: [
        { username: "Jonathan Harris", social_account_id: "fb-page-1", social_network_type: "Facebook", is_expired: 0, need_refresh: false },
      ],
    }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/getscheduledposts") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "OK", error: false, data: [] }));
    return;
  }

  if (req.method === "POST" && ["/scheduleimagepost", "/scheduletextpost"].includes(url.pathname)) {
    oneUpScheduleAttempts += 1;
    let body = "";
    for await (const chunk of req) body += chunk;
    if (oneUpScheduleFailuresRemaining > 0) {
      oneUpScheduleFailuresRemaining -= 1;
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "temporary OneUp outage", error: true }));
      return;
    }
    const params = new URLSearchParams(body);
    scheduledRequests.push({ endpoint: url.pathname, body: Object.fromEntries(params.entries()) });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "1 new Posts Scheduled.", error: false, data: [] }));
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
        "Quiz Answer! The correct answer is B) Transformer. Transformers handle context far better than older sequence models, which is why they sit underneath most modern LLMs. Did you get it right?",
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
  oneUpScheduleFailuresRemaining = 0;
  oneUpScheduleAttempts = 0;
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

test("OneUp request schema coerces dryRun and array socialNetworkId", async () => {
  const mod = await import(`../services/shared/utils/requestSchemas.js?oneup-schema=${Date.now()}`);
  const parsed = mod.validateBody(mod.oneupDailyBodySchema, {
    dryRun: "true",
    socialNetworkId: ["acc-1", "acc-2"],
    publishDate: "2026-04-13",
  });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.dryRun, true);
  assert.equal(parsed.data.socialNetworkId, '["acc-1","acc-2"]');
});

test("OneUp ebook weekly request schema validates featured book payload and overrides", async () => {
  const mod = await import(`../services/shared/utils/requestSchemas.js?oneup-ebook-schema=${Date.now()}`);
  const parsed = mod.validateBody(mod.oneupEbookWeeklyBodySchema, {
    weekStartDate: "2026-05-04",
    dryRun: "true",
    categoryName: "Ebooks",
    socialNetworkId: ["fb-page", "ig-account"],
    thursdayPublishTime: "15:45",
    featuredBook: FEATURED_BOOK,
  });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.dryRun, true);
  assert.equal(parsed.data.socialNetworkId, '["fb-page","ig-account"]');
  assert.equal(parsed.data.featuredBook.coverArtUrl, FEATURED_BOOK.coverArtUrl);
  assert.equal(parsed.data.thursdayPublishTime, "15:45");

  const invalid = mod.validateBody(mod.oneupEbookWeeklyBodySchema, {
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

  const mod = await import(`../services/oneup/utils/socialScheduler.js?oneup-daily=${Date.now()}`);
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

  const mod = await import(`../services/oneup/utils/socialScheduler.js?oneup-quiz=${Date.now()}`);
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


test("buildAndScheduleEbookWeekly returns dry-run Tuesday, Thursday, and Saturday ebook posts", async () => {
  restoreEnv();
  applyBaseEnv();
  process.env.OPENROUTER_API_BASE = mockBase;

  const mod = await import(`../services/oneup/utils/socialScheduler.js?oneup-ebooks=${Date.now()}`);
  const result = await mod.buildAndScheduleEbookWeekly({
    weekStartDate: "2026-05-04",
    dryRun: true,
    categoryName: "Ebooks",
    socialNetworkId: "ALL",
    featuredBook: FEATURED_BOOK,
  });

  assert.equal(result.ok, true);
  assert.equal(result.service, "oneup");
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

  const scheduler = await import(`../services/oneup/utils/socialScheduler.js?oneup-ebook-details=${Date.now()}`);
  const prompts = await import(`../services/oneup/utils/prompts.js?oneup-ebook-prompt=${Date.now()}`);
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



test("OneUp social network IDs are normalised for API scheduling", async () => {
  const mod = await import(`../services/oneup/utils/config.js?oneup-config=${Date.now()}`);

  assert.equal(mod.normaliseOneUpSocialNetworkId("ALL"), "ALL");
  assert.equal(mod.normaliseOneUpSocialNetworkId("fb-page-1"), '["fb-page-1"]');
  assert.equal(mod.normaliseOneUpSocialNetworkId("fb-page-1,ig-account-1"), '["fb-page-1","ig-account-1"]');
  assert.equal(mod.normaliseOneUpSocialNetworkId('["fb-page-1","ig-account-1"]'), '["fb-page-1","ig-account-1"]');
});

test("buildAndScheduleDailyLane validates Facebook targeting before live scheduling", async () => {
  restoreEnv();
  applyBaseEnv();
  process.env.OPENROUTER_API_BASE = mockBase;
  process.env.ONEUP_API_BASE = mockBase;
  process.env.ONEUP_API_KEY = "oneup-key";
  process.env.ONEUP_REQUIRED_NETWORK_TYPES = "Facebook";
  process.env.ONEUP_VALIDATE_TARGET_ACCOUNTS = "true";

  const mod = await import(`../services/oneup/utils/socialScheduler.js?oneup-live-fb=${Date.now()}`);
  const result = await mod.buildAndScheduleDailyLane("monday", {
    publishDate: "2026-04-13",
    categoryName: "General",
    socialNetworkId: "fb-page-1",
    force: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.scheduled, true);
  assert.equal(result.targeting.ok, true);
  assert.equal(result.targeting.targetedAccounts[0].social_network_type, "Facebook");
  assert.equal(scheduledRequests.at(-1).body.social_network_id, '["fb-page-1"]');
});

test("buildAndScheduleDailyLane retries a transient OneUp scheduling failure", async () => {
  restoreEnv();
  applyBaseEnv();
  process.env.OPENROUTER_API_BASE = mockBase;
  process.env.ONEUP_API_BASE = mockBase;
  process.env.ONEUP_API_KEY = "oneup-key";
  process.env.ONEUP_REQUIRED_NETWORK_TYPES = "Facebook";
  process.env.ONEUP_VALIDATE_TARGET_ACCOUNTS = "true";
  process.env.ONEUP_API_RETRY_ATTEMPTS = "2";
  process.env.ONEUP_API_RETRY_BASE_MS = "1";
  process.env.ONEUP_API_RETRY_MAX_MS = "5";
  oneUpScheduleFailuresRemaining = 1;

  const mod = await import(`../services/oneup/utils/socialScheduler.js?oneup-live-retry=${Date.now()}`);
  const result = await mod.buildAndScheduleDailyLane("monday", {
    publishDate: "2026-04-13",
    categoryName: "General",
    socialNetworkId: "fb-page-1",
    force: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.scheduled, true);
  assert.equal(oneUpScheduleAttempts, 2);
  assert.equal(scheduledRequests.length, 1);
  assert.deepEqual(result.oneUpResponse._oneUpRetry, { attempts: 2, recovered: true, operation: "POST scheduleimagepost" });
});


test("buildAndScheduleDailyLane fails loudly when required Facebook targeting is missing", async () => {
  restoreEnv();
  applyBaseEnv();
  process.env.OPENROUTER_API_BASE = mockBase;
  process.env.ONEUP_API_BASE = mockBase;
  process.env.ONEUP_API_KEY = "oneup-key";
  process.env.ONEUP_REQUIRED_NETWORK_TYPES = "Facebook";
  process.env.ONEUP_VALIDATE_TARGET_ACCOUNTS = "true";

  const mod = await import(`../services/oneup/utils/socialScheduler.js?oneup-missing-fb=${Date.now()}`);

  await assert.rejects(
    () => mod.buildAndScheduleDailyLane("monday", {
      publishDate: "2026-04-13",
      categoryName: "Ebooks",
      socialNetworkId: "ALL",
      force: true,
    }),
    /OneUp target setup failed.*Facebook/
  );

  assert.equal(scheduledRequests.length, 0);
});

test("Tuesday lane uses the updated brand-safe hashtag set", async () => {
  restoreEnv();
  applyBaseEnv();
  process.env.OPENROUTER_API_BASE = mockBase;

  const mod = await import(`../services/oneup/utils/socialScheduler.js?oneup-tuesday=${Date.now()}`);
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
