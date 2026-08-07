import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseStructuredJson, strictJsonResponseFormat } from "../services/shared/utils/structuredJson.js";
import { buildArtworkImagePayload } from "../services/artwork/utils/openrouterImagePayload.js";
import { looksLikePendingVideoError } from "../services/blotato/utils/renderStatus.js";
import { pollUntil } from "../services/blotato/utils/pollUntil.js";

test("OpenRouter structured responses use strict JSON Schema and parse bounded objects", () => {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: { score: { type: "number" } },
    required: ["score"],
  };
  const format = strictJsonResponseFormat("newsletter review", schema);
  assert.equal(format.type, "json_schema");
  assert.equal(format.json_schema.strict, true);
  assert.equal(format.json_schema.name, "newsletter_review");
  assert.deepEqual(parseStructuredJson('prefix {"score":91} suffix', "review"), { score: 91 });
});

test("artwork payload supports explicit deterministic seeds and model-specific shape", () => {
  const seedream = buildArtworkImagePayload({
    model: "bytedance-seed/seedream-4.5",
    prompt: "source-specific scene",
    mode: "newsletter",
    seed: 12345,
  });
  assert.equal(seedream.seed, 12345);
  assert.equal(seedream.resolution, "2K");
  assert.equal(seedream.aspect_ratio, "16:9");

  const flux = buildArtworkImagePayload({
    model: "black-forest-labs/flux.2-pro",
    prompt: "source-specific scene",
    mode: "newsletter",
    seed: 67890,
  });
  assert.equal(flux.seed, 67890);
  assert.equal(flux.output_format, "png");
  assert.equal("aspect_ratio" in flux, false);
  assert.equal("resolution" in flux, false);
});

test("Blotato accepts only the observed not-complete 500 as bounded pending", () => {
  assert.equal(looksLikePendingVideoError({
    statusCode: 500,
    message: "Video generation is not complete. You most likely ran out of credits.",
  }), true);
  assert.equal(looksLikePendingVideoError({
    statusCode: 500,
    message: "Internal server error",
  }), false);
  assert.equal(looksLikePendingVideoError({
    statusCode: 402,
    message: "Payment required: insufficient credits",
  }), false);
  assert.equal(looksLikePendingVideoError({
    statusCode: 429,
    message: "Rate limit exceeded",
  }), true);
  assert.equal(looksLikePendingVideoError({
    name: "TypeError",
    message: "fetch failed: socket terminated",
  }), true);
  assert.equal(looksLikePendingVideoError({
    statusCode: 404,
    message: "Creation not found",
  }), false);
});

test("pollUntil fails after a bounded run of provider pending errors", async () => {
  let attempts = 0;
  await assert.rejects(
    pollUntil({
      label: "Blotato render",
      run: async () => {
        attempts += 1;
        const error = new Error("temporarily pending");
        error.statusCode = 429;
        throw error;
      },
      isPendingError: () => true,
      extractStatus: () => "",
      isDone: () => false,
      isFailed: () => false,
      maxAttempts: 20,
      intervalMs: 1,
      maxConsecutivePendingErrors: 3,
      wait: async () => {},
    }),
    (error) => error?.code === "blotato-poll-provider-error-limit"
  );
  assert.equal(attempts, 3);
});

test("provider integrations follow current Blotato and OpenRouter contracts", async () => {
  const [blotatoClient, autoPublish, capabilities, council, compose, visualQa, env] = await Promise.all([
    readFile(new URL("../services/blotato/utils/blotatoClient.js", import.meta.url), "utf8"),
    readFile(new URL("../services/blotato/utils/autoPublishService.js", import.meta.url), "utf8"),
    readFile(new URL("../services/artwork/utils/openrouterImageCapabilities.js", import.meta.url), "utf8"),
    readFile(new URL("../services/newsletter/engine/editorialCouncil.js", import.meta.url), "utf8"),
    readFile(new URL("../services/newsletter/engine/compose.js", import.meta.url), "utf8"),
    readFile(new URL("../services/artwork/utils/artworkVisualQa.js", import.meta.url), "utf8"),
    readFile(new URL("../config/production.defaults.env", import.meta.url), "utf8"),
  ]);

  assert.match(blotatoClient, /if \(useBrandKit === true\) body\.useBrandKit = true/);
  assert.match(blotatoClient, /`videos\/\$\{encodeURIComponent\(cleaned\)\}`/);
  assert.match(blotatoClient, /Math\.max\(exponentialWaitMs, providerRetryAfterMs\)/);
  assert.match(autoPublish, /BLOTATO_USE_BRAND_KIT/);
  assert.match(autoPublish, /id,title,name,description,inputs/);
  assert.match(autoPublish, /BLOTATO_VIDEO_PENDING_ERROR_LIMIT", 120, 180/);
  assert.match(capabilities, /images\/models\/\$\{encodeURIComponent\(author\)\}/);
  assert.match(capabilities, /filterImagePayloadByCapabilities/);
  assert.match(council, /strictJsonResponseFormat/);
  assert.match(compose, /strictJsonResponseFormat/);
  assert.match(visualQa, /strictJsonResponseFormat/);
  assert.doesNotMatch(council, /type: "json_object"/);
  assert.doesNotMatch(compose, /type: "json_object"/);
  assert.doesNotMatch(visualQa, /type: "json_object"/);
  assert.match(env, /^BLOTATO_NEWS_TEMPLATE_ID=\/base\/v2\/ai-story-video\/5903fe43-514d-40ee-a060-0d6628c5f8fd\/v1$/m);
  assert.match(env, /^BLOTATO_TEMPLATE_ID_MODE=uuid$/m);
  assert.match(env, /^BLOTATO_VIDEO_POLL_ATTEMPTS=120$/m);
  assert.match(env, /^BLOTATO_VIDEO_POLL_MAX_DURATION_MS=600000$/m);
  assert.match(env, /^BLOTATO_STATUS_RETRY_ATTEMPTS=1$/m);
  assert.match(env, /^BLOTATO_VIDEO_PENDING_ERROR_LIMIT=120$/m);
  assert.match(env, /^BLOTATO_PENDING_500_COMPAT=true$/m);
  assert.match(env, /^ARTWORK_TASK_TIMEOUT_MS=600000$/m);
  assert.match(env, /^BLOG_FALLBACK_IMAGE_URL=$/m);
  assert.match(env, /^BLOG_SOCIAL_FALLBACK_IMAGE_URL=$/m);
});
