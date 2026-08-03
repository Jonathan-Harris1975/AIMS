import assert from "node:assert/strict";
import test from "node:test";
import { normaliseStatusBasePath, statusUrlFor } from "../services/shared/utils/asyncServiceStatusUrl.js";

function request() {
  return { protocol: "https", get(name) { return name === "host" ? "app.example.test" : ""; } };
}

test("nested blog routes publish status URLs under their mounted route", () => {
  assert.equal(
    statusUrlFor(request(), "blog-social", "daily-build", "ops-1", "/blog/social/jobs"),
    "https://app.example.test/blog/social/jobs/daily-build/ops-1",
  );
  assert.equal(
    statusUrlFor(request(), "blog", "weekly-build", "ops-2", "/blog/weekly/jobs/"),
    "https://app.example.test/blog/weekly/jobs/weekly-build/ops-2",
  );
});

test("flat services keep the canonical service jobs fallback", () => {
  assert.equal(normaliseStatusBasePath("", "rss"), "/rss/jobs");
  assert.equal(statusUrlFor(null, "rss", "rewrite", "ops-3"), "/rss/jobs/rewrite/ops-3");
});
