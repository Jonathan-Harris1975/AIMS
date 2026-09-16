import test from "node:test";
import assert from "node:assert/strict";
import { buildLane1SkillsBaseline } from "../audits/utils/lane1Skills.js";

test("Lane 1 skills baseline exposes repository-local governance metadata", () => {
  const baseline = buildLane1SkillsBaseline();
  assert.equal(baseline.lane, "Lane 1 - Autonomous");
  assert.equal(baseline.repoSideSetup, true);
  assert.equal(baseline.centralSkillPool, false);
  assert.equal(baseline.localSkillRegistry, true);
  assert.equal(baseline.externalInstallRequired, false);
  assert.equal(baseline.localAgentsRequired, false);
  assert.equal(baseline.skillCount, 14);
  assert.ok(baseline.skills.some((skill) => skill.slug === "seo-audit"));
  assert.ok(baseline.skills.some((skill) => skill.slug === "pdf"));
  assert.ok(baseline.skills.every((skill) => skill.skillId === "AIMS-sk002"));
  assert.ok(baseline.skills.every((skill) => skill.descriptorPath.startsWith("config/skills/")));
  assert.equal(baseline.skillRegistry.externalStoreRequired, false);
  assert.ok(baseline.governance.blockedActions.includes("auto-deploy"));
  assert.equal(baseline.governance.skillSource, "AIMS repository-local skills");
});
