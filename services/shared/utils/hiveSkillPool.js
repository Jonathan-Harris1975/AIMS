// Central HIVE/R2 shared skill-pool contract.
//
// AIMS does not own or execute a local skill library. This module only
// derives read-only reference metadata (bucket, manifest/index URLs and
// per-skill descriptor references) so AIMS gate/report code can point at
// the skills HIVE owns and executes, without installing local .agents
// copies or Skills.sh bundles.
//
// Config precedence: explicit env argument -> process.env -> the defaults
// published in config/hive-skills.json / docs/hive-shared-skills.md.

const DEFAULT_PUBLIC_BASE_URL = "https://pub-da50a6512f164566955a3076a1c795ef.r2.dev";
const DEFAULT_BUCKET = "hive-skills";
const MANIFEST_PATH = "manifests/aims-skills-manifest.json";
const SKILLS_INDEX_PATH = "index/skills-index.json";

// The Lane 1 (autonomous, reports-only) skill set AIMS references from the
// central pool. HIVE owns execution for every entry here; AIMS only reads
// descriptor metadata for discovery/reporting.
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

function stripTrailingSlash(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

/**
 * Resolve the central HIVE/R2 skill-pool location.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function getHiveSkillPoolConfig(env = process.env) {
  const publicBaseUrl = stripTrailingSlash(
    env?.R2_PUBLIC_BASE_URL_HIVE_SKILLS || DEFAULT_PUBLIC_BASE_URL
  );
  const r2Bucket = env?.R2_BUCKET_HIVE_SKILLS || DEFAULT_BUCKET;

  return Object.freeze({
    r2Bucket,
    publicBaseUrl,
    manifestPath: MANIFEST_PATH,
    skillsIndexPath: SKILLS_INDEX_PATH,
    manifestUrl: `${publicBaseUrl}/${MANIFEST_PATH}`,
    skillsIndexUrl: `${publicBaseUrl}/${SKILLS_INDEX_PATH}`,
  });
}

/**
 * Build a read-only reference to a named skill in the central pool.
 * This does not fetch or validate against the live manifest; it derives a
 * stable descriptor reference so gate/report code can cite where a skill
 * lives without executing it locally.
 * @param {string} name
 * @param {NodeJS.ProcessEnv} [env]
 */
export function getCentralSkillReference(name, env = process.env) {
  const slug = slugify(name);
  const pool = getHiveSkillPoolConfig(env);

  return Object.freeze({
    name: String(name ?? ""),
    slug,
    source: "central HIVE R2 shared skill pool",
    referencePrefix: slug ? `hive-skill://${slug}` : null,
    descriptorUrl: slug ? `${pool.publicBaseUrl}/skills/${slug}.json` : null,
  });
}

/**
 * All skills referenced by Lane 1 (autonomous, reports-only) baselines.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function getLane1SkillReferences(env = process.env) {
  return LANE_1_SKILL_NAMES.map((name) => getCentralSkillReference(name, env));
}

export default {
  getHiveSkillPoolConfig,
  getCentralSkillReference,
  getLane1SkillReferences,
};
