import test from "node:test";
import assert from "node:assert/strict";

import { inferWebsitePipelineSessionIdFromPrefix } from "../audits/utils/auditPaths.js";

test("website audit child report prefixes recover the canonical parent session", () => {
  const parent = "AUD-WEBSITE-website-1785726979673";
  assert.equal(
    inferWebsitePipelineSessionIdFromPrefix(
      `audits/_tmp/website/${parent}/digital-growth`,
      "digital-growth"
    ),
    parent
  );
  assert.equal(
    inferWebsitePipelineSessionIdFromPrefix(
      `audits/_tmp/website/${parent}/seo-aeo-geo/`,
      "seo-aeo-geo"
    ),
    parent
  );
  assert.equal(
    inferWebsitePipelineSessionIdFromPrefix(
      `audits/_tmp/website/${parent}/mobile-ux`,
      "mobile-ux"
    ),
    parent
  );
});

test("website audit parent recovery rejects cross-stage and final-report prefixes", () => {
  const parent = "AUD-WEBSITE-website-1785726979673";
  assert.equal(
    inferWebsitePipelineSessionIdFromPrefix(
      `audits/_tmp/website/${parent}/mobile-ux`,
      "seo-aeo-geo"
    ),
    null
  );
  assert.equal(
    inferWebsitePipelineSessionIdFromPrefix(
      `audits/website/2026-08/${parent}`,
      "mobile-ux"
    ),
    null
  );
});
