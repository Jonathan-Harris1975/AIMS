import { getLane1SkillReferences, getLocalSkillRegistryConfig } from "../../services/shared/localSkills.js";

const LANE_1_GOVERNANCE = Object.freeze({
  mode: "reports-only",
  skillSource: "AIMS repository-local skills",
  blockedActions: Object.freeze(["auto-deploy", "direct-push", "secret-write", "blind-browser-action"]),
  requiredGates: Object.freeze(["dry-run", "evidence-capture", "manual-review-before-write"]),
});

export function buildLane1SkillsBaseline(upstreamBaseline = undefined) {
  const registry = getLocalSkillRegistryConfig();
  const skills = getLane1SkillReferences();
  const batchCounts = { "AIMS local Lane 1 skill": skills.length };

  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: "aims.local-skills.lane1.v1",
    lane: "Lane 1 - Autonomous",
    repoSideSetup: true,
    centralSkillPool: false,
    localSkillRegistry: true,
    externalInstallRequired: false,
    localAgentsRequired: false,
    upstreamBaselinePresent: Boolean(upstreamBaseline && typeof upstreamBaseline === "object"),
    upstreamSkillCount: Number(upstreamBaseline?.skillCount || 0),
    skillRegistry: registry,
    skillCount: skills.length,
    skills: skills.map((skill) => ({
      skill: skill.name,
      slug: skill.slug,
      skillId: skill.skillId,
      referencePrefix: skill.referencePrefix,
      descriptorPath: skill.descriptorPath,
      batch: "AIMS local Lane 1 skill",
      priority: "repo-local",
      repository: "AIMS",
      ecosystemFit: "AIMS owns the report lens metadata and executes the underlying audit workflow locally.",
      manualCheckpoint: "Review required before any write, deploy, browser or token-bearing action.",
    })),
    batchCounts,
    governance: LANE_1_GOVERNANCE,
  };
}

export default { buildLane1SkillsBaseline };
