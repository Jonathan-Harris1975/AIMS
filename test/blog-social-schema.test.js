import test from "node:test";
import assert from "node:assert/strict";
import { validateBody, blogSocialDailyBuildBodySchema } from "../services/shared/utils/requestSchemas.js";

test("blogSocialDailyBuildBodySchema accepts date days dryRun and force", () => {
  const parsed = validateBody(blogSocialDailyBuildBodySchema, { date: "2026-05-06", days: "3", dryRun: "yes", force: 1 });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.date, "2026-05-06");
  assert.equal(parsed.data.days, 3);
  assert.equal(parsed.data.dryRun, true);
  assert.equal(parsed.data.force, true);
});

test("blogSocialDailyBuildBodySchema defaults days and rejects oversized windows", () => {
  const defaults = validateBody(blogSocialDailyBuildBodySchema, {});
  assert.equal(defaults.ok, true);
  assert.equal(defaults.data.days, 1);
  assert.equal(defaults.data.dryRun, false);
  assert.equal(defaults.data.force, false);
  const tooLarge = validateBody(blogSocialDailyBuildBodySchema, { days: 8 });
  assert.equal(tooLarge.ok, false);
  assert.match(tooLarge.error, /days/);
});
