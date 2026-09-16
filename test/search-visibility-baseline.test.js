import test from "node:test";
import assert from "node:assert/strict";
import { getSearchVisibilityBaseline } from "../audits/utils/searchVisibilityBaseline.js";

test("search visibility baseline is report-only Batch 1 governance", () => {
  const baseline = getSearchVisibilityBaseline();
  assert.equal(baseline.batch, "Batch 1 - Search visibility baseline");
  assert.equal(baseline.lane, "Lane 1 - Autonomous");
  assert.equal(baseline.mode, "reports-only");
  assert.deepEqual(baseline.skills.map((skill) => skill.name), ["seo-audit", "ai-seo"]);
  assert.equal(baseline.skillSource, "AIMS repository-local skills");
  assert.ok(baseline.skills.every((skill) => skill.skillId === "AIMS-sk002"));
  assert.ok(baseline.skills.every((skill) => skill.sourceUrl.startsWith("repo://config/skills/")));
  assert.match(baseline.guardrails.join("\n"), /do not edit public pages/i);
  assert.match(baseline.guardrails.join("\n"), /approval-gated patch/i);
});
