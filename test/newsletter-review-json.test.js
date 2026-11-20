import test from "node:test";
import assert from "node:assert/strict";
import { parseNewsletterReview } from "../services/newsletter/engine/reviewJson.js";

const schema = { required: ["score", "blocking", "issues", "verdict"], properties: {
  score: { type: "number" }, blocking: { type: "boolean" }, issues: { type: "array" },
  verdict: { type: "string", enum: ["pass", "revise"] },
} };
const valid = { score: 90, blocking: false, issues: [], verdict: "pass" };

test("portable newsletter review accepts a complete typed verdict", () => {
  assert.deepEqual(parseNewsletterReview(JSON.stringify(valid), schema, "review"), valid);
});

test("malformed, incomplete or incorrectly typed reviews cannot authorise publication", () => {
  for (const raw of ['{"score":90', '{}', 'null', ...[
    { ...valid, score: "90" }, { ...valid, score: 101 }, { ...valid, score: -1 },
    { ...valid, blocking: "false" }, { ...valid, issues: [{}] }, { ...valid, verdict: "approved" },
  ].map(JSON.stringify)]) {
    assert.throws(() => parseNewsletterReview(raw, schema, "review"));
  }
});


test("invalid council chair priority fixes is classified as repairable structured output", () => {
  const chairSchema = { required: ["score", "blocking", "issues", "verdict", "priorityFixes"], properties: {
    ...schema.properties, priorityFixes: { type: "array" },
  } };
  assert.throws(() => parseNewsletterReview(JSON.stringify({ ...valid, priorityFixes: "retry" }), chairSchema, "chair"),
    (error) => error.code === "AI_INVALID_STRUCTURED_OUTPUT" && error.status === "invalid_completion");
});
