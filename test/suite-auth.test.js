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

test("suite auth requires a production guard for Cloudflare purge", async () => {
  await withEnv({
    NODE_ENV: "production",
    AIMS_API_KEY: "test-aims-key",
    CLOUDFLARE_PURGE_SHARED_SECRET: "test-purge-secret",
    CLOUDFLARE_PURGE_ALLOW_PUBLIC: undefined,
  }, async () => {
    const unauthenticated = await request(app)
      .post("/cloudflare/purge")
      .send({});

    assert.equal(unauthenticated.status, 401);

    assert.equal(
      getCloudflarePurgeAuthStrategy({
        method: "POST",
        originalUrl: "/cloudflare/purge",
        get: (name) => (name.toLowerCase() === "authorization" ? "Bearer test-aims-key" : ""),
        headers: {},
      }),
      "suite-bearer"
    );

    assert.equal(
      getCloudflarePurgeAuthStrategy({
        method: "POST",
        originalUrl: "/cloudflare/purge",
        get: (name) => (name.toLowerCase() === "x-cloudflare-purge-secret" ? "test-purge-secret" : ""),
        headers: {},
      }),
      "cloudflare-purge-secret"
    );
  });
});

import {
  getBlotatoPublishAuthStrategy,
  getCloudflarePurgeAuthStrategy,
  isPublicBlotatoPublishPath,
} from "../services/shared/middleware/suiteAuth.js";

test("suite auth recognises weekly Blotato publish-now lane triggers as external hook paths", () => {
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

test("suite auth requires a production guard for Blotato publish-now triggers", async () => {
  await withEnv({
    NODE_ENV: "production",
    AIMS_API_KEY: "test-aims-key",
    BLOTATO_PUBLISH_WEBHOOK_SECRET: "test-blotato-hook",
    BLOTATO_ALLOW_PUBLIC_PUBLISH_HOOKS: undefined,
  }, async () => {
    const unauthenticated = await request(app).post("/blotato/shorts/news-insight/publish-now");
    assert.equal(unauthenticated.status, 401);

    assert.equal(
      getBlotatoPublishAuthStrategy({
        method: "POST",
        originalUrl: "/blotato/shorts/news-insight/publish-now",
        get: (name) => (name.toLowerCase() === "authorization" ? "Bearer test-aims-key" : ""),
        headers: {},
      }),
      "suite-bearer"
    );

    assert.equal(
      getBlotatoPublishAuthStrategy({
        method: "POST",
        originalUrl: "/blotato/shorts/news-insight/publish-now",
        get: (name) => (name.toLowerCase() === "x-blotato-publish-secret" ? "test-blotato-hook" : ""),
        headers: {},
      }),
      "blotato-publish-secret"
    );
  });
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


test("scanner probe paths are dropped before suite auth", async () => {
  await withEnv({ NODE_ENV: "production", AIMS_API_KEY: "test-aims-key" }, async () => {
    for (const path of [
      "/config/keys.json",
      "/internal/secrets.json",
      "/logs/error.log",
      "/.vscode/settings.json",
      "/.ssh/id_rsa",
    ]) {
      const response = await request(app).get(path);
      assert.equal(response.status, 404, path);
      assert.equal(response.text, "", path);
    }
  });
});

test("robots.txt stays quiet and public on the API service", async () => {
  await withEnv({ NODE_ENV: "production", AIMS_API_KEY: "test-aims-key" }, async () => {
    const response = await request(app).get("/robots.txt");
    assert.equal(response.status, 204);
    assert.equal(response.text, "");
  });
});
