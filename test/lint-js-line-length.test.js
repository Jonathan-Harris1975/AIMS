import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_JAVASCRIPT_LINE_LENGTH,
  javascriptLineLengthFailures,
} from "../scripts/lintRules.js";

test("JavaScript line-length lint accepts the 200-character boundary", () => {
  const source = "x".repeat(MAX_JAVASCRIPT_LINE_LENGTH);
  assert.deepEqual(javascriptLineLengthFailures(source, "fixture.js"), []);
});

test("JavaScript line-length lint reports lines over 200 characters", () => {
  const source = [
    "const ok = true;",
    "x".repeat(MAX_JAVASCRIPT_LINE_LENGTH + 1),
  ].join("\n");

  assert.deepEqual(javascriptLineLengthFailures(source, "fixture.js"), [
    "fixture.js:2: line is 201 characters; maximum is 200",
  ]);
});
