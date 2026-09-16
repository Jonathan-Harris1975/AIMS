// Repository-local AIMS skill metadata.
//
// These records describe AIMS-native behaviour and governance lenses. They are
// deliberately file-backed and network-free: no runtime discovery, R2 lookup or
// external installer is required to resolve them.

const LOCAL_SKILL_GROUPS = Object.freeze({
  lane1: Object.freeze({
    id: "AIMS-sk002",
    name: "lane-1-audit-lenses",
    descriptorPath: "config/skills/AIMS-sk002-lane1-audit-lenses.local.json",
  }),
  phase4: Object.freeze({
    id: "AIMS-sk003",
    name: "phase-4-autonomous-gates",
    descriptorPath: "config/skills/AIMS-sk003-phase4-autonomous-gates.local.json",
  }),
  phase5: Object.freeze({
    id: "AIMS-sk004",
    name: "phase-5-organic-growth-gates",
    descriptorPath: "config/skills/AIMS-sk004-phase5-organic-growth.local.json",
  }),
});

const LANE_1_SKILL_NAMES = Object.freeze([
  "seo-audit",
  "ai-seo",
  "pdf",
  "docx",
  "pptx",
  "xlsx",
  "schema-markup",
  "social-content",
  "systematic-debugging",
  "copywriting",
  "copy-editing",
  "marketing-psychology",
  "accessibility-audit",
  "podcast-seo",
]);

function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getLocalSkillRegistryConfig() {
  return Object.freeze({
    source: "AIMS repository-local skills",
    accessMode: "repo-local-read-only",
    descriptorRoot: "config/skills",
    externalStoreRequired: false,
    runtimeDiscoveryRequired: false,
  });
}

export function getLocalSkillReference(name, group = "lane1") {
  const descriptor = LOCAL_SKILL_GROUPS[group];
  if (!descriptor) {
    throw new Error(`Unknown AIMS local skill group: ${group}`);
  }
  const slug = slugify(name);
  return Object.freeze({
    name: String(name ?? ""),
    slug,
    skillId: descriptor.id,
    localSkill: descriptor.name,
    source: "AIMS repository-local skill",
    referencePrefix: slug ? `aims-skill://${descriptor.id}/${slug}` : `aims-skill://${descriptor.id}`,
    descriptorPath: descriptor.descriptorPath,
    descriptorUrl: `repo://${descriptor.descriptorPath}`,
    descriptorUri: `repo://${descriptor.descriptorPath}`,
  });
}

export function getLocalSkillReferences(names, group = "lane1") {
  return Array.from(names || [], (name) => getLocalSkillReference(name, group));
}

export function getLane1SkillReferences() {
  return getLocalSkillReferences(LANE_1_SKILL_NAMES, "lane1");
}

export default {
  getLocalSkillRegistryConfig,
  getLocalSkillReference,
  getLocalSkillReferences,
  getLane1SkillReferences,
};
