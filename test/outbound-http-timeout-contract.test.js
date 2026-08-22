import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const TIMEOUT_CLIENT_PATHS = [
  "../services/blog/weekly/buildWeeklyBlogPost.js",
  "../services/blog/social/buildDailySocialBlogPost.js",
  "../audits/utils/onBrandEvidence.js",
  "../audits/utils/podcastWebsiteReports.js",
  "../audits/utils/githubDispatch.js",
  "../services/zernio/utils/zernioClient.js",
];

test("critical outbound HTTP paths use the shared timeout-aware client", async () => {
  for (const relativePath of TIMEOUT_CLIENT_PATHS) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    assert.match(source, /fetchWithTimeout\s*\(/, `${relativePath} must call fetchWithTimeout`);

    const withoutHelperCalls = source.replace(/fetchWithTimeout\s*\(/g, "");
    assert.doesNotMatch(
      withoutHelperCalls,
      /(?:^|[^A-Za-z0-9_$])fetch\s*\(/m,
      `${relativePath} must not contain an unbounded raw fetch call`,
    );
  }
});
