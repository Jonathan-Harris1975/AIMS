import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import request from "supertest";

const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

const AI_STORY_TEMPLATE_PATH = "/base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d6628c5f8fd/v1";
const AI_STORY_TEMPLATE_UUID = "5903fe43-514d-40ee-a060-0d6628c5f8fd";
const capturedChatRequests = [];
const capturedVisualRequests = [];
const capturedPostRequests = [];

function countHashtags(value = "") {
  return (String(value || "").match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length;
}

async function handleMockRequest(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");

  if (req.method === "GET" && url.pathname === "/feed.xml") {
    res.writeHead(200, { "content-type": "application/rss+xml" });
    res.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Jonathan Harris AI News</title>
    <item>
      <title>AI agents move from chat to office tasks</title>
      <link>https://example.com/agents-office-tasks</link>
      <description>A new wave of agent tools is aimed at routine admin and workflow tasks.</description>
      <pubDate>${new Date().toUTCString()}</pubDate>
    </item>
  </channel>
</rss>`);
    return;
  }

  if (req.method === "POST" && url.pathname === "/chat/completions") {
    const payload = await readJsonBody(req);
    capturedChatRequests.push(payload);
    const isRepair = payload.messages.some((message) => String(message.content || "").includes("Repair malformed JSON"));
    if (!isRepair) {
      assert.ok(payload.messages.some((message) => String(message.content || "").includes("Create one short-form AI social video pack")));
      assert.ok(payload.messages.some((message) => String(message.content || "").includes("Spartan and informative")));
      assert.ok(payload.messages.some((message) => String(message.content || "").includes("Instagram must have no more than 5 hashtags")));
      assert.ok(payload.messages.some((message) => String(message.content || "").includes("Target duration: 45 seconds minimum")));
      assert.equal(payload.response_format?.type, "json_schema");
      assert.equal(payload.response_format?.json_schema?.name, "blotato_news_short_pack");
      assert.ok(payload.messages.some((message) => String(message.content || "").includes("Provide exactly 7 scenes")));
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            internalTitle: "Agents move into admin",
            angle: "The useful story is workflow delegation, not another shiny demo.",
            hook: "AI agents are moving from chat to chores.",
            script: "AI agents are moving from chat to chores. The important part is not the demo theatre. It is that teams are starting to hand over repeatable admin, research, drafting, routing and checking tasks. That does not remove judgement. It moves judgement to the design of the workflow. The useful move is boring on purpose: choose one repeatable task, set clear checks, review the result, then widen the workflow only when it behaves. The winners will not be people who ask better one-off questions. They will be the ones who build better systems around the tools.",
            visualDirection: "Dark editorial AI newsroom, task cards moving through a clean workflow, captions emphasising chores, workflow and judgement.",
            scenes: [
              {
                mediaSource: "Faceless dark editorial newsroom visual with task cards moving from chat bubbles into workflow columns.",
                script: "AI agents are moving from chat to chores."
              },
              {
                mediaSource: "Minimal dashboard showing admin, research, drafting, routing and checking tasks flowing through a clean system.",
                script: "Teams are starting to hand over repeatable admin, research, drafting, routing and checking tasks."
              },
              {
                mediaSource: "Abstract workflow builder with human approval checkpoints and clean captions about judgement.",
                script: "That does not remove judgement. It moves judgement to the design of the workflow."
              },
              {
                mediaSource: "Premium dark technology graphic showing connected systems around practical AI tools, no robot imagery.",
                script: "The winners will be the ones who build better systems around the tools."
              }
            ],
            thumbnailText: "AI Gets Chores",
            youtubeTitle: "AI agents are moving from chat to chores",
            youtubeDescription: "AI agents are becoming workflow tools, not magic. #ArtificialIntelligence #AINews #AIAgents",
            tiktokCaption: "AI agents are getting practical. Less magic, more workflow. #ArtificialIntelligence #AINews #AIAgents #FutureOfWork",
            instagramCaption: "The useful AI agent story is not the demo. It is the workflow shift. #ArtificialIntelligence #AINews #AIAgents #FutureOfWork #Automation #TechCommentary",
            facebookCaption: "AI agents are becoming less about chat and more about repeatable work. That changes how teams design workflows.",
            qualityNotes: "The angle is practical and avoids overclaiming.",
          }),
        },
      }],
    }));
    return;
  }

  if (req.headers["blotato-api-key"] !== "test-blotato-key") {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "bad key" }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/v2/users/me") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "user-1", email: "john@example.com" }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/v2/users/me/accounts") {
    const platform = url.searchParams.get("platform") || "tiktok";
    const ids = {
      instagram: process.env.BLOTATO_INSTAGRAM_ACCOUNT_ID || "acc-instagram",
      youtube: process.env.BLOTATO_YOUTUBE_ACCOUNT_ID || "acc-youtube",
      tiktok: process.env.BLOTATO_TIKTOK_ACCOUNT_ID || "acc-tiktok",
      facebook: process.env.BLOTATO_FACEBOOK_ACCOUNT_ID || "acc-facebook",
    };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ items: [{ id: ids[platform] || `acc-${platform}`, platform, username: "jh" }] }));
    return;
  }

  if (req.method === "GET" && url.pathname === `/v2/users/me/accounts/${process.env.BLOTATO_FACEBOOK_ACCOUNT_ID || "acc-facebook"}/subaccounts`) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ items: [{ id: process.env.BLOTATO_FACEBOOK_PAGE_ID || "page-1", accountId: process.env.BLOTATO_FACEBOOK_ACCOUNT_ID || "acc-facebook", name: "Jonathan Harris" }] }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/v2/videos/templates") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ items: [{ id: "tpl-ai-video", name: "AI Video with AI Voice", inputs: {} }] }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/v2/videos/from-templates") {
    const body = await readJsonBody(req);
    capturedVisualRequests.push(body);
    assert.ok(["tpl-ai-video", AI_STORY_TEMPLATE_PATH, AI_STORY_TEMPLATE_UUID].includes(body.templateId));
    assert.equal(body.render, true);
    assert.equal(body.text_to_image_model, undefined);
    assert.equal(body.image_to_video_model, undefined);
    assert.equal(body.textToImageModel, undefined);
    assert.equal(body.imageToVideoModel, undefined);
    assert.equal(body.useBrandKit, undefined);
    if (body.templateId === AI_STORY_TEMPLATE_PATH) {
      assert.ok(Array.isArray(body.inputs.scenes));
      assert.ok(body.inputs.scenes.length >= 3);
      assert.equal(body.inputs.aspectRatio, "9:16");
      assert.equal(body.inputs.captionPosition, "bottom");
    }
    if (body.templateId === AI_STORY_TEMPLATE_UUID) {
      assert.deepEqual(body.inputs, {});
      assert.match(body.prompt, /Cost guard/i);
    }
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ item: { id: "visual-1", status: "queueing" } }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/v2/videos/creations/visual-1") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ item: { id: "visual-1", status: "done", mediaUrl: "https://example.com/video.mp4" } }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/v2/posts") {
    const body = await readJsonBody(req);
    capturedPostRequests.push(body);
    assert.equal(body.post.content.platform, body.post.target.targetType);

    if (body.post.content.platform === "tiktok") {
      assert.ok([process.env.BLOTATO_TIKTOK_ACCOUNT_ID || "acc-tiktok", "acc-tiktok"].includes(body.post.accountId));
      assert.ok(countHashtags(body.post.content.text) <= 5);
      if (body.post.accountId === process.env.BLOTATO_TIKTOK_ACCOUNT_ID) {
        assert.equal(body.post.target.privacyLevel, "PUBLIC_TO_EVERYONE");
        assert.equal(body.post.target.disabledComments, false);
        assert.equal(body.post.target.disabledDuet, false);
        assert.equal(body.post.target.disabledStitch, false);
        assert.equal(body.post.target.isBrandedContent, false);
        assert.equal(body.post.target.isYourBrand, false);
        assert.equal(body.post.target.isAiGenerated, true);
      }
    }

    if (body.post.content.platform === "instagram") {
      assert.equal(body.post.accountId, process.env.BLOTATO_INSTAGRAM_ACCOUNT_ID || "acc-instagram");
      assert.equal(body.post.target.mediaType, "reel");
      assert.deepEqual(body.post.content.mediaUrls, ["https://example.com/video.mp4"]);
      assert.ok(countHashtags(body.post.content.text) <= 5);
    }

    if (body.post.content.platform === "youtube") {
      assert.equal(body.post.accountId, process.env.BLOTATO_YOUTUBE_ACCOUNT_ID || "acc-youtube");
      assert.equal(body.post.target.privacyStatus, "public");
      assert.equal(body.post.target.containsSyntheticMedia, true);
      assert.deepEqual(body.post.content.mediaUrls, ["https://example.com/video.mp4"]);
    }

    if (body.post.content.platform === "facebook") {
      assert.equal(body.post.accountId, process.env.BLOTATO_FACEBOOK_ACCOUNT_ID || "acc-facebook");
      assert.equal(body.post.target.pageId, process.env.BLOTATO_FACEBOOK_PAGE_ID || "page-1");
      assert.equal(body.post.target.mediaType, "reel");
    }

    const id = body.post.content.platform === "tiktok" ? "post-1" : `post-${body.post.content.platform}`;
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ postSubmissionId: id }));
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/v2/posts/post-")) {
    const id = url.pathname.split("/").pop();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ postSubmissionId: id, status: "published", publicUrl: `https://example.com/p/${id}` }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ message: "not found" }));
}

const mockServer = http.createServer((req, res) => {
  handleMockRequest(req, res).catch((error) => {
    const payload = JSON.stringify({
      message: "mock server error",
      error: error?.message || String(error),
    });

    if (res.headersSent) {
      res.destroy(error);
      return;
    }

    res.writeHead(500, { "content-type": "application/json" });
    res.end(payload);
  });
});

await new Promise((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
const mockAddress = mockServer.address();
const mockBase = `http://127.0.0.1:${mockAddress.port}`;

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.AIMS_API_KEY = "suite-key";
process.env.Blotato_API_key = "test-blotato-key";
process.env.BLOTATO_API_BASE = `${mockBase}/v2`;
process.env.OPENROUTER_API_BASE = mockBase;
process.env.OPENROUTER_BASE_URL = mockBase;
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.AI_MODEL_STANDARD = "openai/test-model";
process.env.AI_MODEL_FAST = "openai/test-model";
process.env.AI_MODEL_SUMMARY = "openai/test-model";
process.env.BLOTATO_NEWS_RSS_URL = `${mockBase}/feed.xml`;
process.env.BLOTATO_RSS_PREFER_R2 = "false";
process.env.BLOTATO_INLINE_PUBLISH_JOBS = "true";
process.env.BLOTATO_VIDEO_POLL_ATTEMPTS = "2";
process.env.BLOTATO_VIDEO_POLL_INTERVAL_MS = "1";
process.env.BLOTATO_POST_POLL_ATTEMPTS = "2";
process.env.BLOTATO_POST_POLL_INTERVAL_MS = "1";
process.env.BLOTATO_INSTAGRAM_ACCOUNT_ID = "48812";
process.env.BLOTATO_YOUTUBE_ACCOUNT_ID = "37622";
process.env.BLOTATO_TIKTOK_ACCOUNT_ID = "44263";
process.env.BLOTATO_FACEBOOK_ACCOUNT_ID = "34013";
process.env.BLOTATO_FACEBOOK_PAGE_ID = "562160556971997";
process.env.BLOTATO_DEFAULT_CHANNELS = "instagram,youtube,tiktok,facebook";
process.env.BLOTATO_NEWS_TEMPLATE_ID = AI_STORY_TEMPLATE_PATH;
process.env.BLOTATO_TEMPLATE_ID_MODE = "uuid";
process.env.BLOTATO_TEMPLATE_VERIFY = "true";
process.env.BLOTATO_TEMPLATE_AUTO_DISCOVERY = "true";
process.env.BLOTATO_NEWS_TEMPLATE_SEARCH = "AI Video with AI Voice,AI Story Video,AI Voice,Story Video";
process.env.BLOTATO_USE_MANUAL_TEMPLATE_INPUTS = "false";
process.env.BLOTATO_VIDEO_SCENE_COUNT = "7";
process.env.BLOTATO_MAX_EXPECTED_CREDITS = "70";
process.env.BLOTATO_NEWS_JSON_RESPONSE_FORMAT = "true";
process.env.BLOTATO_NEWS_RESPONSE_FORMAT_MODE = "json_schema";
process.env.BLOTATO_STEP0_PREFLIGHT_ENABLED = "true";
process.env.BLOTATO_PREFLIGHT_REQUIRE_LISTED_ACCOUNTS = "true";
process.env.BLOTATO_PREFLIGHT_REQUIRE_LISTED_SUBACCOUNTS = "true";
process.env.BLOTATO_FACEBOOK_MEDIA_TYPE = "reel";
process.env.BLOTATO_KEEPALIVE_ENABLED = "false";
process.env.BLOTATO_PUBLISH_SEQUENTIAL = "true";
process.env.BLOTATO_PUBLISH_STAGGER_MS = "1";
process.env.BLOTATO_API_RETRY_ATTEMPTS = "2";
process.env.BLOTATO_API_RETRY_MAX_MS = "10";
process.env.BLOTATO_SCRIPT_MODEL = "openai/test-model";
process.env.APP_TMP_DIR = `/tmp/aims-blotato-test-${Date.now()}`;

const { app } = await import(`../server.js?blotato-suite=${Date.now()}`);

const auth = { Authorization: "Bearer suite-key" };

test.after(async () => {
  await new Promise((resolve, reject) => mockServer.close((err) => (err ? reject(err) : resolve())));
  restoreEnv();
});

test.afterEach(() => {
  process.env.Blotato_API_key = "test-blotato-key";
  process.env.BLOTATO_API_BASE = `${mockBase}/v2`;
  process.env.BLOTATO_NEWS_RSS_URL = `${mockBase}/feed.xml`;
  process.env.BLOTATO_RSS_PREFER_R2 = "false";
  process.env.BLOTATO_INLINE_PUBLISH_JOBS = "true";
  process.env.BLOTATO_VIDEO_POLL_ATTEMPTS = "2";
  process.env.BLOTATO_VIDEO_POLL_INTERVAL_MS = "1";
  process.env.BLOTATO_POST_POLL_ATTEMPTS = "2";
  process.env.BLOTATO_POST_POLL_INTERVAL_MS = "1";
  process.env.BLOTATO_INSTAGRAM_ACCOUNT_ID = "48812";
  process.env.BLOTATO_YOUTUBE_ACCOUNT_ID = "37622";
  process.env.BLOTATO_TIKTOK_ACCOUNT_ID = "44263";
  process.env.BLOTATO_FACEBOOK_ACCOUNT_ID = "34013";
  process.env.BLOTATO_FACEBOOK_PAGE_ID = "562160556971997";
  process.env.BLOTATO_DEFAULT_CHANNELS = "instagram,youtube,tiktok,facebook";
  process.env.BLOTATO_NEWS_TEMPLATE_ID = AI_STORY_TEMPLATE_PATH;
  process.env.BLOTATO_TEMPLATE_ID_MODE = "uuid";
  process.env.BLOTATO_TEMPLATE_VERIFY = "true";
  process.env.BLOTATO_TEMPLATE_AUTO_DISCOVERY = "true";
  process.env.BLOTATO_NEWS_TEMPLATE_SEARCH = "AI Video with AI Voice,AI Story Video,AI Voice,Story Video";
  process.env.BLOTATO_USE_MANUAL_TEMPLATE_INPUTS = "false";
  process.env.BLOTATO_VIDEO_SCENE_COUNT = "7";
  process.env.BLOTATO_MAX_EXPECTED_CREDITS = "70";
  process.env.BLOTATO_NEWS_JSON_RESPONSE_FORMAT = "true";
  process.env.BLOTATO_NEWS_RESPONSE_FORMAT_MODE = "json_schema";
  process.env.BLOTATO_STEP0_PREFLIGHT_ENABLED = "true";
  process.env.BLOTATO_PREFLIGHT_REQUIRE_LISTED_ACCOUNTS = "true";
  process.env.BLOTATO_PREFLIGHT_REQUIRE_LISTED_SUBACCOUNTS = "true";
  process.env.BLOTATO_FACEBOOK_MEDIA_TYPE = "reel";
  process.env.BLOTATO_KEEPALIVE_ENABLED = "false";
  process.env.BLOTATO_PUBLISH_SEQUENTIAL = "true";
  process.env.BLOTATO_PUBLISH_STAGGER_MS = "1";
  process.env.BLOTATO_API_RETRY_ATTEMPTS = "2";
  process.env.BLOTATO_API_RETRY_MAX_MS = "10";
  process.env.BLOTATO_SCRIPT_MODEL = "openai/test-model";
  process.env.OPENROUTER_API_BASE = mockBase;
  process.env.OPENROUTER_BASE_URL = mockBase;
});

test("Blotato health endpoint is public and reports configured API key", async () => {
  const response = await request(app).get("/blotato/health");
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.service, "blotato");
  assert.equal(response.body.apiKeyConfigured, true);
});

test("Blotato account and template routes call the API", async () => {
  const accounts = await request(app)
    .get("/blotato/accounts?platform=tiktok")
    .set(auth);

  assert.equal(accounts.status, 200);
  assert.equal(accounts.body.items[0].id, process.env.BLOTATO_TIKTOK_ACCOUNT_ID || "acc-tiktok");
  assert.equal(accounts.body.items[0].platform, "tiktok");

  const subaccounts = await request(app)
    .get(`/blotato/accounts/${process.env.BLOTATO_FACEBOOK_ACCOUNT_ID || "acc-facebook"}/subaccounts`)
    .set(auth);

  assert.equal(subaccounts.status, 200);
  assert.equal(subaccounts.body.items[0].id, process.env.BLOTATO_FACEBOOK_PAGE_ID || "page-1");

  const templates = await request(app)
    .get("/blotato/templates?search=AI")
    .set(auth);

  assert.equal(templates.status, 200);
  assert.equal(templates.body.items[0].id, "tpl-ai-video");
});

test("Blotato visual and post lifecycle routes call the API", async () => {
  const visual = await request(app)
    .post("/blotato/visuals")
    .set(auth)
    .send({ templateId: "tpl-ai-video", inputs: {}, prompt: "make a short", render: true });

  assert.equal(visual.status, 201);
  assert.equal(visual.body.item.id, "visual-1");

  const status = await request(app)
    .get("/blotato/visuals/visual-1")
    .set(auth);

  assert.equal(status.status, 200);
  assert.equal(status.body.item.status, "done");

  const post = await request(app)
    .post("/blotato/posts")
    .set(auth)
    .send({
      accountId: "acc-tiktok",
      platform: "tiktok",
      text: "AI news, minus the fog. #ArtificialIntelligence #AINews",
      mediaUrls: ["https://example.com/video.mp4"],
      target: { targetType: "tiktok" },
    });

  assert.equal(post.status, 201);
  assert.equal(post.body.postSubmissionId, "post-1");

  const postStatus = await request(app)
    .get("/blotato/posts/post-1")
    .set(auth);

  assert.equal(postStatus.status, 200);
  assert.equal(postStatus.body.status, "published");
});

test("Blotato publish schema rejects target/platform mismatch", async () => {
  const response = await request(app)
    .post("/blotato/posts")
    .set(auth)
    .send({
      accountId: "acc-tiktok",
      platform: "tiktok",
      text: "Mismatch test",
      mediaUrls: [],
      target: { targetType: "youtube" },
    });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /must match platform/);
});

test("Blotato lane registry exposes the five weekday short formats", async () => {
  const response = await request(app)
    .get("/blotato/shorts/lanes")
    .set(auth);

  assert.equal(response.status, 200);
  assert.deepEqual(
    response.body.lanes.map((lane) => lane.slug),
    ["news-insight", "model-verdict", "ai-at-work", "reality-check", "ai-playbook"]
  );
  assert.equal(response.body.lanes[0].weekday, "Monday");
  assert.equal(response.body.lanes[4].weekday, "Friday");
});

test("Blotato news insight route builds a dry-run short pack", async () => {
  const response = await request(app)
    .post("/blotato/shorts/news-insight")
    .set(auth)
    .send({
      dryRun: true,
      theme: "what-it-means",
      article: {
        title: "AI agents move from chat to office tasks",
        summary: "A new wave of agent tools is aimed at routine admin and workflow tasks.",
        link: "https://example.com/agents-office-tasks",
      },
      templateId: "tpl-ai-video",
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.createdVisual, false);
  assert.match(response.body.pack.script, /workflow/i);
  assert.ok(response.body.pack.script.split(/\s+/).length >= 95);
  assert.match(response.body.visualPrompt, /Thumbnail text/);
  assert.ok(Array.isArray(response.body.pack.scenes));
  assert.ok(response.body.pack.scenes.length >= 3);
  assert.ok(Array.isArray(response.body.visualInputs.scenes));
});

test("Blotato generic weekly lane route builds a model-verdict dry-run pack", async () => {
  const response = await request(app)
    .post("/blotato/shorts/model-verdict")
    .set(auth)
    .send({
      dryRun: true,
      article: {
        title: "New AI model improves long task handling",
        summary: "The model is aimed at coding and longer workflow tasks.",
        link: "https://example.com/model-long-tasks",
      },
      templateId: "tpl-ai-video",
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.lane, "model-verdict-short");
  assert.equal(response.body.pack.lane, "model-verdict");
  assert.match(response.body.visualPrompt, /AI Tool or Model Verdict/);
});


test("Blotato publish-now endpoint is public and runs the RSS-to-all configured social job", async () => {
  const response = await request(app).post("/blotato/shorts/news-insight/publish-now");

  assert.equal(response.status, 202);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.started, true);
  assert.equal(response.body.job.type, "blotato-news-insight-publish");
  assert.match(response.body.job.statusUrl, /\/blotato\/jobs\//);

  const jobStatus = await request(app).get(`/blotato/jobs/${response.body.job.sessionId}`);
  assert.equal(jobStatus.status, 200);
  assert.equal(jobStatus.body.ok, true);
  assert.equal(jobStatus.body.job.status, "completed");
  assert.equal(jobStatus.body.job.result.source.article.title, "AI agents move from chat to office tasks");
  assert.deepEqual(
    jobStatus.body.job.result.publishes.map((item) => item.platform),
    ["instagram", "youtube", "tiktok", "facebook"]
  );
  assert.ok(["tpl-ai-video", AI_STORY_TEMPLATE_UUID].includes(jobStatus.body.job.result.templateId));
  assert.equal(jobStatus.body.job.result.video.creditBudget.expectedCredits <= 70, true);
  assert.ok(jobStatus.body.job.result.video.visualInputs.scenes.length >= 3);
  const instagramPost = capturedPostRequests.filter((item) => item.post.content.platform === "instagram").at(-1);
  assert.ok(instagramPost);
  assert.ok(countHashtags(instagramPost.post.content.text) <= 5);
  const tiktokPost = capturedPostRequests.filter((item) => item.post.content.platform === "tiktok").at(-1);
  assert.ok(tiktokPost);
  assert.equal(tiktokPost.post.accountId, "44263");
  assert.ok(countHashtags(tiktokPost.post.content.text) <= 5);
  assert.equal(tiktokPost.post.target.privacyLevel, "PUBLIC_TO_EVERYONE");
  assert.equal(tiktokPost.post.target.isAiGenerated, true);
  const facebookPost = capturedPostRequests.filter((item) => item.post.content.platform === "facebook").at(-1);
  assert.ok(facebookPost);
  assert.equal(facebookPost.post.accountId, "34013");
  assert.equal(facebookPost.post.target.pageId, "562160556971997");
  assert.equal(facebookPost.post.target.mediaType, "reel");
  assert.equal(jobStatus.body.job.result.channelPreflight.ready, true);
  assert.deepEqual(
    jobStatus.body.job.result.channelPreflight.platforms.map((item) => item.platform),
    ["instagram", "youtube", "tiktok", "facebook"]
  );
});
