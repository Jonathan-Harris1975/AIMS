import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REGISTRY_PATH = path.join(REPO_ROOT, ".agents", "lane-1-skills.json");

function readRegistry() {
  try {
    const parsed = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : { schemaVersion: "invalid", governance: {}, skills: [] };
  } catch {
    return { schemaVersion: "missing", governance: {}, skills: [] };
  }
}

export function buildLane1SkillsBaseline(upstreamBaseline = undefined) {
  const registry = readRegistry();
  const skills = Array.isArray(registry.skills) ? registry.skills.filter((item) => item && typeof item === "object") : [];
  const batchCounts = skills.reduce((acc, skill) => {
    const batch = String(skill.batch || "Unbatched");
    acc[batch] = (acc[batch] || 0) + 1;
    return acc;
  }, {});

  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: registry.schemaVersion || "unknown",
    lane: "Lane 1 - Autonomous",
    repoSideSetup: true,
    externalInstallRequired: true,
    upstreamBaselinePresent: Boolean(upstreamBaseline && typeof upstreamBaseline === "object"),
    upstreamSkillCount: Number(upstreamBaseline?.skillCount || 0),
    skillCount: skills.length,
    skills: skills.map((skill) => ({
      skill: skill.displayName || skill.skill,
      slug: skill.skill,
      batch: skill.batch,
      priority: skill.priority,
      repository: skill.repository,
      ecosystemFit: skill.ecosystemFit,
      manualCheckpoint: skill.manualCheckpoint,
    })),
    batchCounts,
    governance: registry.governance || {},
  };
}

export default { buildLane1SkillsBaseline };
