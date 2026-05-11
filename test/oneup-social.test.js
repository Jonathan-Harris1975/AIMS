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
  process.env.ONEUP_API_BASE = mockBase;
  process.env.ONEUP_CATEGORY_NAME_EBOOKS = "Ebooks";
  process.env.ONEUP_TUESDAY_TIME = "13:00";
  process.env.ONEUP_THURSDAY_TIME = "12:20";
  process.env.ONEUP_SATURDAY_TIME = "10:30";
}

const oneUpScheduleRequests = [];

const mockServer = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");

  if (req.method === "GET" && url.pathname === "/listcategory") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      error: false,
      message: "OK",
      data: [
        { id: "cat-general", category_name: "General" },
        { id: "cat-ebooks", category_name: "Ebooks" },
      ],
    }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/getscheduledposts") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: false, message: "OK", data: [] }));
    return;
  }

  if (req.method === "POST" && ["/scheduleimagepost", "/scheduletextpost"].includes(url.pathname)) {
    let body = "";
    for await (const chunk of req) body += chunk;
    const payload = Object.fromEntries(new URLSearchParams(body));
    oneUpScheduleRequests.push({ endpoint: url.pathname, payload });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: false, message: "OK", data: { id: `post-${oneUpScheduleRequests.length}` } }));
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
      content: `${day} post copy about using artificial intelligence carefully, without pretending the tools are magic. #ModelNoise`,
      firstComment: "Featured book: Practical AI Thinking\nRead more: https://example.com/practical-ai-thinking",
    });
  } else if (joined.includes("paired weekly AI quiz")) {
    content = JSON.stringify({
      topic: "Transformer basics",
      questionTitle: "Weekly AI Quiz",
      questionContent:
        "**Which architecture made modern large language models practical?**\nA) Decision Tree\nB) Transformer\nC) K-Means\nD) Linear Regression\n\nComment your answer below and tag a friend who should try this!",
      answerTitle: "Quiz Answer",
      answerContent:
        "Quiz Answer! The correct answer is B) Transformer. Transformers handle context far better than older sequence models, which is why they sit underneath most modern LLMs. Did you get it right?",
    });
  } else {
    content = JSON.stringify({
      title: "Monday Motivation",
      topic: "Steady systems",
      content:
        '"The future depends on what you do today." - Mahatma Gandhi\n\nAI work gets better when you stop chasing theatre and keep shipping the useful bits.',
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
  assert.match(result.post.content, /#MondayMotivation/);
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
  assert.equal(result.posts.tuesday.scheduledDateTime, "2026-05-05 13:00");
  assert.equal(result.posts.thursday.scheduledDateTime, "2026-05-07 12:20");
  assert.equal(result.posts.saturday.scheduledDateTime, "2026-05-09 10:30");
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
    assert.match(post.content, /#JonathanHarris/);
    assert.doesNotMatch(post.content, /#ModelNoise/);
    assert.doesNotMatch(post.firstComment, /#ArtificialIntelligence|#AIBooks|#AIExplained|#JonathanHarris/);
  }
});

test("Tuesday lane uses the updated educational hashtag set", async () => {
  restoreEnv();
  applyBaseEnv();
  process.env.OPENROUTER_API_BASE = mockBase;

  const mod = await import(`../services/oneup/utils/socialScheduler.js?oneup-tuesday=${Date.now()}`);
  const result = await mod.buildAndScheduleDailyLane("tuesday", {
    publishDate: "2026-04-14",
    dryRun: true,
  });

  assert.equal(result.ok, true);
  assert.match(result.post.content, /#TechTalkTuesday/);
  assert.match(result.post.content, /#AIExplained/);
  assert.match(result.post.content, /#MachineLearning/);
});


test("buildAndScheduleDailyLane suppresses a second direct same-slot run", async () => {
  restoreEnv();
  applyBaseEnv();
  oneUpScheduleRequests.length = 0;
  process.env.OPENROUTER_API_BASE = mockBase;
  process.env.ONEUP_API_BASE = mockBase;
  process.env.ONEUP_API_KEY = "test-oneup-key";

  const mod = await import(`../services/oneup/utils/socialScheduler.js?oneup-dedupe-daily=${Date.now()}`);
  const first = await mod.buildAndScheduleDailyLane("monday", {
    publishDate: "2026-06-01",
    categoryName: "General",
    socialNetworkId: "ALL",
  });
  const second = await mod.buildAndScheduleDailyLane("monday", {
    publishDate: "2026-06-01",
    categoryName: "General",
    socialNetworkId: "ALL",
  });

  assert.equal(first.scheduled, true);
  assert.equal(first.duplicatePrevented, false);
  assert.equal(second.scheduled, false);
  assert.equal(second.duplicatePrevented, true);
  assert.equal(oneUpScheduleRequests.length, 1);
  assert.equal(oneUpScheduleRequests[0].payload.scheduled_date_time, "2026-06-01 14:00");
});

test("buildAndScheduleEbookWeekly suppresses repeated weekly ebook slots", async () => {
  restoreEnv();
  applyBaseEnv();
  oneUpScheduleRequests.length = 0;
  process.env.OPENROUTER_API_BASE = mockBase;
  process.env.ONEUP_API_BASE = mockBase;
  process.env.ONEUP_API_KEY = "test-oneup-key";

  const mod = await import(`../services/oneup/utils/socialScheduler.js?oneup-dedupe-ebooks=${Date.now()}`);
  const first = await mod.buildAndScheduleEbookWeekly({
    weekStartDate: "2026-06-08",
    categoryName: "Ebooks",
    socialNetworkId: "ALL",
    featuredBook: FEATURED_BOOK,
  });
  const second = await mod.buildAndScheduleEbookWeekly({
    weekStartDate: "2026-06-08",
    categoryName: "Ebooks",
    socialNetworkId: "ALL",
    featuredBook: FEATURED_BOOK,
  });

  assert.equal(first.posts.tuesday.scheduled, true);
  assert.equal(first.posts.thursday.scheduled, true);
  assert.equal(first.posts.saturday.scheduled, true);
  assert.equal(second.posts.tuesday.duplicatePrevented, true);
  assert.equal(second.posts.thursday.duplicatePrevented, true);
  assert.equal(second.posts.saturday.duplicatePrevented, true);
  assert.equal(oneUpScheduleRequests.length, 3);
  assert.deepEqual(
    oneUpScheduleRequests.map((item) => item.payload.scheduled_date_time),
    ["2026-06-09 13:00", "2026-06-11 12:20", "2026-06-13 10:30"]
  );
});
