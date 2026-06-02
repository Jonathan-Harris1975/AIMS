import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "../server.js";

function withEnv(values, fn) {
  const previous = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

test("suite auth leaves service health endpoints public", async () => {
  await withEnv({ NODE_ENV: "production", AIMS_API_KEY: "test-aims-key" }, async () => {
    const response = await request(app).get("/tts/health");
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
  });
});

test("suite auth rejects protected endpoints without bearer token", async () => {
  await withEnv({ NODE_ENV: "production", AIMS_API_KEY: "test-aims-key" }, async () => {
    const response = await request(app).get("/tts/status/TT-auth-test");
    assert.equal(response.status, 401);
    assert.equal(response.headers["www-authenticate"], "Bearer");
    assert.equal(response.body.error, "unauthorized");
  });
});

test("suite auth accepts the AIMS bearer token", async () => {
  await withEnv({ NODE_ENV: "production", AIMS_API_KEY: "test-aims-key" }, async () => {
    const response = await request(app)
      .get("/tts/status/TT-auth-test")
      .set("Authorization", "Bearer test-aims-key");
    assert.equal(response.status, 404);
    assert.equal(response.body.error, "No TTS job found");
  });
});

test("suite auth fails closed in production when AIMS_API_KEY is absent", async () => {
  await withEnv({ NODE_ENV: "production", AIMS_API_KEY: undefined, AIMS_ALLOW_UNAUTHENTICATED_DEV: undefined }, async () => {
    const response = await request(app).get("/tts/status/TT-auth-test");
    assert.equal(response.status, 503);
    assert.match(response.body.error, /AIMS_API_KEY/);
  });
});


test("suite auth unresolved secret placeholders are treated as missing", async () => {
  await withEnv({ NODE_ENV: "production", AIMS_API_KEY: "{{secret.AIMS_API_KEY}}", AIMS_ALLOW_UNAUTHENTICATED_DEV: undefined }, async () => {
    const response = await request(app).get("/tts/status/TT-auth-test");
    assert.equal(response.status, 503);
    assert.match(response.body.error, /AIMS_API_KEY/);
  });
});

test("suite auth leaves Cloudflare purge public for auth, legacy secret, or unauthenticated webhooks", async () => {
  await withEnv({
    NODE_ENV: "production",
    AIMS_API_KEY: "test-aims-key",
    CLOUDFLARE_PURGE_SHARED_SECRET: "test-purge-secret",
  }, async () => {
    const unauthenticated = await request(app)
      .post("/cloudflare/purge")
      .send({});

    assert.notEqual(unauthenticated.status, 401);

    const bearer = await request(app)
      .post("/cloudflare/purge")
      .set("Authorization", "Bearer test-aims-key")
      .send({});

    assert.notEqual(bearer.status, 401);

    const legacySecret = await request(app)
      .post("/cloudflare/purge")
      .set("x-cloudflare-purge-secret", "test-purge-secret")
      .send({});

    assert.notEqual(legacySecret.status, 401);
  });
});

import { isPublicBlotatoPublishPath } from "../services/shared/middleware/suiteAuth.js";

test("suite auth treats all weekly Blotato publish-now lane triggers as public hooks", () => {
  for (const lane of ["news-insight", "model-verdict", "ai-at-work", "reality-check", "ai-playbook"]) {
    assert.equal(
      isPublicBlotatoPublishPath({ method: "POST", originalUrl: `/blotato/shorts/${lane}/publish-now` }),
      true,
      lane
    );
  }

  for (const lane of ["ethics-brief", "ai-spotlight-video", "not-a-lane"]) {
    assert.equal(
      isPublicBlotatoPublishPath({ method: "POST", originalUrl: `/blotato/shorts/${lane}/publish-now` }),
      false,
      lane
    );
  }

  assert.equal(
    isPublicBlotatoPublishPath({ method: "POST", originalUrl: "/blotato/shorts/model-verdict" }),
    false
  );
});

test("ops pretrigger health is public but preflight and warmup require suite auth", async () => {
  await withEnv({ NODE_ENV: "production", AIMS_API_KEY: "test-aims-key" }, async () => {
    const health = await request(app).get("/ops/health?service=blog&sourceJob=blog-daily-social-build&targetPath=/blog/social/daily/build");
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.stage, "health");
    assert.equal(health.body.checkedService, "blog");

    const unauthenticatedPreflight = await request(app).get("/ops/preflight?service=blog&sourceJob=blog-daily-social-build&targetPath=/blog/social/daily/build");
    assert.equal(unauthenticatedPreflight.status, 401);

    const preflight = await request(app)
      .get("/ops/preflight?service=blog&sourceJob=blog-daily-social-build&targetPath=/blog/social/daily/build")
      .set("Authorization", "Bearer test-aims-key");
    assert.equal(preflight.status, 200);
    assert.equal(preflight.body.ok, true);
    assert.equal(preflight.body.stage, "preflight");

    const warmup = await request(app)
      .get("/ops/warmup?service=blog&sourceJob=blog-daily-social-build&targetPath=/blog/social/daily/build&deep=true")
      .set("Authorization", "Bearer test-aims-key");
    assert.equal(warmup.status, 200);
    assert.equal(warmup.body.ok, true);
    assert.equal(warmup.body.stage, "warmup");
    assert.equal(warmup.body.deep, true);
  });
});
