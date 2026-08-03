import assert from "node:assert/strict";
import test from "node:test";
import { isParameterCompatibilityError } from "../services/shared/utils/openRouterErrorPolicy.js";

test("OpenRouter's current no-endpoints wording triggers relaxed-parameter retry", () => {
  const error = new Error("OpenRouter 404: No endpoints found that can handle the requested parameters. To learn more about provider routing.");
  error.status = 404;
  assert.equal(isParameterCompatibilityError(error), true);
});

test("ordinary missing-model 404s remain non-compatible failures", () => {
  const error = new Error("OpenRouter 404: model not found");
  error.status = 404;
  assert.equal(isParameterCompatibilityError(error), false);
});
