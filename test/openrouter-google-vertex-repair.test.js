import test from "node:test";
import assert from "node:assert/strict";
import { isGoogleTextPartAdapterFailure } from "../services/shared/utils/ai-service.js";

const googleSchemaFailure = {
  status: 400,
  bodySnippet: JSON.stringify({ error: { message: 'text content parts must carry a string "text" (got undefined)',
    code: 400, metadata: { provider_name: "Google" } } }),
};

test("only an identified Google 400 with valid outbound text permits bounded provider exclusion", () => {
  const valid = [{ role: "system", content: "Keep source evidence" }, { role: "user", content: "Prepare a mini-series" }];
  assert.equal(isGoogleTextPartAdapterFailure(googleSchemaFailure, valid), true);
  assert.equal(isGoogleTextPartAdapterFailure(googleSchemaFailure, [{ role: "user", content: [{ type: "text" }] }]), false,
    "never hide a malformed local message behind a provider fallback");
  assert.equal(isGoogleTextPartAdapterFailure({ ...googleSchemaFailure, status: 500 }, valid), false);
  assert.equal(isGoogleTextPartAdapterFailure({ ...googleSchemaFailure, bodySnippet: "irrelevant 400" }, valid), false);
  assert.equal(isGoogleTextPartAdapterFailure({ ...googleSchemaFailure,
    bodySnippet: googleSchemaFailure.bodySnippet.replace("Google", "Anthropic") }, valid), false);
});

test("Google Vertex repair retains authorised model and Headroom and cannot recurse indefinitely", async () => {
  const source = (await import("node:fs")).readFileSync(new URL("../services/shared/utils/ai-service.js", import.meta.url), "utf8");
  assert.match(source, /\^zernioMiniSeries/);
  assert.match(source, /avoidGoogleVertex = false/);
  assert.match(source, /"google-vertex"/);
  assert.match(source, /!avoidGoogleVertex &&/);
  assert.match(source, /const headroom = await compressForOpenRouter/);
});
