import test from "node:test";
import assert from "node:assert/strict";
import { buildLane1SkillsBaseline } from "../audits/utils/lane1Skills.js";

test("Lane 1 skills baseline exposes all autonomous skills and governance", () => {
  const baseline = buildLane1SkillsBaseline();
  assert.equal(baseline.lane, "Lane 1 - Autonomous");
  assert.equal(baseline.repoSideSetup, true);
  assert.equal(baseline.externalInstallRequired, true);
  assert.equal(baseline.skillCount, 14);
  assert.ok(baseline.skills.some((skill) => skill.slug === "seo-audit"));
  assert.ok(baseline.skills.some((skill) => skill.slug === "pdf"));
  assert.ok(baseline.governance.blockedActions.includes("auto-deploy"));
});
