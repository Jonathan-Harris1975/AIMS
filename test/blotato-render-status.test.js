import test from "node:test";
import assert from "node:assert/strict";
import { looksLikePendingVideoError } from "../services/blotato/utils/renderStatus.js";

test("Blotato's ambiguous not-complete message remains pending", () => {
  const error = Object.assign(new Error("Video generation is not complete. You most likely ran out of credits."), {
    statusCode: 500,
  });
  assert.equal(looksLikePendingVideoError(error), true);
});

test("an explicit insufficient-credit response remains terminal", () => {
  const error = Object.assign(new Error("Insufficient credits"), {
    statusCode: 402,
    details: { status: "insufficient-credits" },
  });
  assert.equal(looksLikePendingVideoError(error), false);
});
