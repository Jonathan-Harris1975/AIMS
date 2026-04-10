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
}

const mockServer = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/chat/completions") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;
  const payload = JSON.parse(body || "{}");
  const joined = JSON.stringify(payload.messages || []);

  const content = joined.includes("paired weekly AI quiz")
    ? JSON.stringify({
        topic: "Transformer basics",
        questionTitle: "Weekly AI Quiz",
        questionContent:
          "**Which architecture made modern large language models practical?**\nA) Decision Tree\nB) Transformer\nC) K-Means\nD) Linear Regression\n\nComment your answer below and tag a friend who should try this!",
        answerTitle: "Quiz Answer",
        answerContent:
          "Quiz Answer! The correct answer is B) Transformer. Transformers handle context far better than older sequence models, which is why they sit underneath most modern LLMs. Did you get it right?",
      })
    : JSON.stringify({
        title: "Monday Motivation",
        topic: "Steady systems",
        content:
          '"The future depends on what you do today." - Mahatma Gandhi\n\nAI work gets better when you stop chasing theatre and keep shipping the useful bits.',
        firstComment: "",
      });

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
