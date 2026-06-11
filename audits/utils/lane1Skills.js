import { getHiveSkillPoolConfig, getLane1SkillReferences } from "../../services/shared/hiveSkillPool.js";

const LANE_1_GOVERNANCE = Object.freeze({
  mode: "reports-only",
  skillSource: "central HIVE R2 shared skill pool",
  blockedActions: Object.freeze(["auto-deploy", "direct-push", "secret-write", "blind-browser-action"]),
  requiredGates: Object.freeze(["dry-run", "evidence-capture", "manual-review-before-write"]),
});

export function buildLane1SkillsBaseline(upstreamBaseline = undefined, env = process.env) {
  const pool = getHiveSkillPoolConfig(env);
  const skills = getLane1SkillReferences(env);
  const batchCounts = { "Central R2 AIMS manifest": skills.length };

  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: "hive.manifest.aims.v1",
    lane: "Lane 1 - Autonomous",
    repoSideSetup: false,
    centralSkillPool: true,
    externalInstallRequired: false,
    localAgentsRequired: false,
    upstreamBaselinePresent: Boolean(upstreamBaseline && typeof upstreamBaseline === "object"),
    upstreamSkillCount: Number(upstreamBaseline?.skillCount || 0),
    r2Bucket: pool.r2Bucket,
    manifestUrl: pool.manifestUrl,
    skillsIndexUrl: pool.skillsIndexUrl,
    skillCount: skills.length,
    skills: skills.map((skill) => ({
      skill: skill.name,
      slug: skill.slug,
      referencePrefix: skill.referencePrefix,
      descriptorUrl: skill.descriptorUrl,
      batch: "Central R2 AIMS manifest",
      priority: skill.referencePrefix ? "manifest-allowed" : "manifest-lookup-required",
      repository: "HIVE shared skill pool",
      ecosystemFit: "AIMS consumes the shared descriptor; HIVE owns execution and orchestration.",
      manualCheckpoint: "Review required before any write, deploy, browser or token-bearing action.",
    })),
    batchCounts,
    governance: LANE_1_GOVERNANCE,
  };
}

export default { buildLane1SkillsBaseline };
