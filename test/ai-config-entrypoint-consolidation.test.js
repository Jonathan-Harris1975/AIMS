import assert from "node:assert/strict";
import test from "node:test";

import rootAiConfig, { aiConfig as namedRootAiConfig } from "../ai-config.js";
import sharedAiConfig, { aiConfig as namedSharedAiConfig } from "../services/shared/utils/ai-config.js";

test("shared AI config compatibility entrypoint resolves to the canonical config object", () => {
  assert.strictEqual(rootAiConfig, namedRootAiConfig);
  assert.strictEqual(sharedAiConfig, rootAiConfig);
  assert.strictEqual(namedSharedAiConfig, rootAiConfig);
});
