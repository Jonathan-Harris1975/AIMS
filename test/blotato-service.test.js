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

const mockServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");

  if (req.method === "POST" && url.pathname === "/chat/completions") {
    const payload = await readJsonBody(req);
    assert.ok(payload.messages.some((message) => String(message.content || "").includes("Create one short-form AI news insight pack")));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            internalTitle: "Agents move into admin",
            angle: "The useful story is workflow delegation, not another shiny demo.",
            hook: "AI agents are moving from chat to chores.",
            script: "AI agents are moving from chat to chores. The important part is not the demo theatre. It is that teams are starting to hand over repeatable admin, research, drafting, routing and checking tasks. That does not remove judgement. It moves judgement to the design of the workflow. The winners will not be people who ask better one-off questions. They will be the ones who build better systems around the tools.",
            visualDirection: "Dark editorial AI newsroom, task cards moving through a clean workflow, captions emphasising chores, workflow and judgement.",
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

  if (req.method === "GET" && url.pathname === "/v2/users/me/accounts") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ items: [{ id: "acc-tiktok", platform: url.searchParams.get("platform") || "tiktok", username: "jh" }] }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/v2/users/me/accounts/acc-facebook/subaccounts") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ items: [{ id: "page-1", accountId: "acc-facebook", name: "Jonathan Harris" }] }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/v2/videos/templates") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ items: [{ id: "tpl-ai-video", name: "AI Video with AI Voice", inputs: {} }] }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/v2/videos/from-templates") {
    const body = await readJsonBody(req);
    assert.equal(body.templateId, "tpl-ai-video");
    assert.equal(body.render, true);
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
    assert.equal(body.post.accountId, "acc-tiktok");
    assert.equal(body.post.content.platform, "tiktok");
    assert.equal(body.post.target.targetType, "tiktok");
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ postSubmissionId: "post-1" }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/v2/posts/post-1") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ postSubmissionId: "post-1", status: "published", publicUrl: "https://example.com/p/1" }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ message: "not found" }));
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
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.AI_MODEL_STANDARD = "openai/test-model";
process.env.AI_MODEL_FAST = "openai/test-model";
process.env.AI_MODEL_SUMMARY = "openai/test-model";

const { app } = await import(`../server.js?blotato-suite=${Date.now()}`);

const auth = { Authorization: "Bearer suite-key" };

test.after(async () => {
  await new Promise((resolve, reject) => mockServer.close((err) => (err ? reject(err) : resolve())));
  restoreEnv();
});

test.afterEach(() => {
  process.env.Blotato_API_key = "test-blotato-key";
  process.env.BLOTATO_API_BASE = `${mockBase}/v2`;
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
  assert.equal(accounts.body.items[0].id, "acc-tiktok");
  assert.equal(accounts.body.items[0].platform, "tiktok");

  const subaccounts = await request(app)
    .get("/blotato/accounts/acc-facebook/subaccounts")
    .set(auth);

  assert.equal(subaccounts.status, 200);
  assert.equal(subaccounts.body.items[0].id, "page-1");

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
  assert.match(response.body.visualPrompt, /Thumbnail text/);
});

