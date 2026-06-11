const DEFAULT_HIVE_SKILLS_BASE_URL = "https://pub-da50a6512f164566955a3076a1c795ef.r2.dev";
const DEFAULT_HIVE_SKILLS_BUCKET = "hive-skills";
const DEFAULT_AIMS_MANIFEST_PATH = "manifests/aims-skills-manifest.json";
const DEFAULT_SKILLS_INDEX_PATH = "index/skills-index.json";
const DEFAULT_SEARCH_DOCUMENTS_PATH = "index/search-documents.json";

const AUDIT_SKILL_DOCUMENTS = Object.freeze({
  "brand-social-council": Object.freeze({
    name: "brand-social-council",
    title: "Brand & Social Media Performance Council",
    objectKey: "skills/S202_brand-social-council.json",
    mimeType: "application/json",
  }),
  "mobile-ux-council": Object.freeze({
    name: "mobile-ux-council",
    title: "Mobile UX Council",
    objectKey: "skills/S203_mobile-ux-council.json",
    mimeType: "application/json",
  }),
  "seo-aeo-geo-council": Object.freeze({
    name: "seo-aeo-geo-council",
    title: "SEO/AEO/GEO Council",
    objectKey: "skills/S204_seo-aeo-geo-council.json",
    mimeType: "application/json",
  }),
});

const SKILL_REFERENCE_MAP = Object.freeze({
  "accessibility-audit": "S159_accessibility-audit",
  "agent-browser": "S160_agent-browser",
  "ai-at-work": "S161_ai-at-work",
  "ai-image-generation": "S162_ai-image-generation",
  "ai-playbook": "S163_ai-playbook",
  "ai-seo": "S164_ai-seo",
  "ai-social-media-content": "S097_ai-social-media-content",
  "analytics-tracking": "S165_analytics-tracking",
  "blotato-weekly-social-video": "S166_blotato-weekly-social-video",
  "brand-guidelines": "S167_brand-guidelines",
  "browser-use": "S168_browser-use",
  "cold-email": "S169_cold-email",
  "content-repurposing": "S170_content-repurposing",
  "content-strategy": "S171_content-strategy",
  "copy-editing": "S172_copy-editing",
  "copywriting": "S110_copywriting",
  "firecrawl-crawl": "S173_firecrawl-crawl",
  "firecrawl-scrape": "S174_firecrawl-scrape",
  "firecrawl-search": "S175_firecrawl-search",
  "image-upscaling": "S176_image-upscaling",
  "lane-1-crawl-source-extraction": "S177_lane-1-crawl-source-extraction",
  "lane-1-performance-observability": "S178_lane-1-performance-observability",
  "lane-1-rendered-evidence": "S179_lane-1-rendered-evidence",
  "lane-1-report-packaging": "S180_lane-1-report-packaging",
  "lane-1-search-visibility": "S181_lane-1-search-visibility",
  "lead-magnets": "S182_lead-magnets",
  "marketing-psychology": "S183_marketing-psychology",
  "model-verdict": "S184_model-verdict",
  "news-insight": "S185_news-insight",
  "og-image-design": "S186_og-image-design",
  "paid-ads": "S187_paid-ads",
  "phase-3-autonomous-content": "S188_phase-3-autonomous-content",
  "phase-4-autonomous-gates": "S189_phase-4-autonomous-gates",
  "phase-4-engineering-auto-pr": "S190_phase-4-engineering-auto-pr",
  "phase-4-schema-gate": "S191_phase-4-schema-gate",
  "schema-markup": "S191_phase-4-schema-gate",
  "phase-5-accessibility-mobile-ux": "S192_phase-5-accessibility-mobile-ux",
  "playwright-best-practices": "S193_playwright-best-practices",
  "podcast-seo": "S194_podcast-seo",
  "product-marketing-context": "S195_product-marketing-context",
  "programmatic-seo": "S196_programmatic-seo",
  "reality-check": "S197_reality-check",
  "sentry-cli": "S198_sentry-cli",
  "seo-audit": "S088_seo-audit",
  "social-content": "S199_social-content",
  "social-media-carousel": "S098_social-media-carousel",
  "systematic-debugging": "S029_systematic-debugging",
  "verification-before-completion": "S200_verification-before-completion",
  "web-perf": "S201_web-perf",
  "brand-social-council": "S202_brand-social-council",
  "mobile-ux-council": "S203_mobile-ux-council",
  "seo-aeo-geo-council": "S204_seo-aeo-geo-council",
  "webapp-testing": "S052_webapp-testing",
  "pdf": "S114_pdf",
  "xlsx": "S116_xlsx"
});

export const HIVE_SKILL_POOL_DEFAULTS = Object.freeze({
  repo: "AIMS",
  accessMode: "central-r2-read-only-manifest",
  executionOwner: "HIVE",
  allowDirectExecution: false,
  allowLocalSkillLibrary: false,
  llmDirectAccessRequired: false,
  r2Bucket: DEFAULT_HIVE_SKILLS_BUCKET,
  r2PublicBaseUrl: DEFAULT_HIVE_SKILLS_BASE_URL,
  manifestPath: DEFAULT_AIMS_MANIFEST_PATH,
  skillsIndexPath: DEFAULT_SKILLS_INDEX_PATH,
  searchDocumentsPath: DEFAULT_SEARCH_DOCUMENTS_PATH,
  auditSkillDocumentCount: Object.keys(AUDIT_SKILL_DOCUMENTS).length
});

export const LANE_1_SKILL_NAMES = Object.freeze([
  "seo-audit",
  "ai-seo",
  "agent-browser",
  "playwright-best-practices",
  "webapp-testing",
  "firecrawl-crawl",
  "firecrawl-scrape",
  "firecrawl-search",
  "verification-before-completion",
  "xlsx",
  "pdf",
  "web-perf",
  "sentry-cli",
  "browser-use"
]);

function clean(value) {
  return String(value ?? "").trim();
}

function trimSlashes(value) {
  return clean(value).replace(/^\/+|\/+$/g, "");
}

export function normaliseHiveSkillsBaseUrl(value = process.env.R2_PUBLIC_BASE_URL_HIVE_SKILLS) {
  return trimSlashes(value || DEFAULT_HIVE_SKILLS_BASE_URL);
}

export function getHiveSkillPoolConfig(env = process.env) {
  const r2PublicBaseUrl = normaliseHiveSkillsBaseUrl(env.R2_PUBLIC_BASE_URL_HIVE_SKILLS);
  const manifestPath = trimSlashes(env.HIVE_SKILLS_AIMS_MANIFEST_PATH || env.HIVE_SKILLS_MANIFEST_PATH || DEFAULT_AIMS_MANIFEST_PATH);
  const skillsIndexPath = trimSlashes(env.HIVE_SKILLS_INDEX_PATH || DEFAULT_SKILLS_INDEX_PATH);
  const searchDocumentsPath = trimSlashes(env.HIVE_SKILLS_SEARCH_DOCUMENTS_PATH || DEFAULT_SEARCH_DOCUMENTS_PATH);
  return Object.freeze({
    ...HIVE_SKILL_POOL_DEFAULTS,
    r2PublicBaseUrl,
    r2Bucket: clean(env.R2_BUCKET_HIVE_SKILLS || DEFAULT_HIVE_SKILLS_BUCKET),
    manifestPath,
    skillsIndexPath,
    searchDocumentsPath,
    manifestUrl: `${r2PublicBaseUrl}/${manifestPath}`,
    skillsIndexUrl: `${r2PublicBaseUrl}/${skillsIndexPath}`,
    searchDocumentsUrl: `${r2PublicBaseUrl}/${searchDocumentsPath}`
  });
}

export function getSkillObjectKey(skillNameOrReference) {
  const key = clean(skillNameOrReference).toLowerCase();
  if (!key) return null;
  if (/^skills\/s\d{3}_.+\.json$/i.test(key)) return clean(skillNameOrReference);
  const mapped = SKILL_REFERENCE_MAP[key];
  if (mapped) return `skills/${mapped}.json`;
  if (/^s\d{3}_.+/i.test(clean(skillNameOrReference))) return `skills/${clean(skillNameOrReference)}.json`;
  if (/^s\d{3}$/i.test(key)) return null;
  return null;
}

export function buildHiveSkillUrl(objectKey, env = process.env) {
  const key = trimSlashes(objectKey);
  if (!key) return null;
  return `${getHiveSkillPoolConfig(env).r2PublicBaseUrl}/${key}`;
}

export function getCentralSkillReference(skillName, env = process.env) {
  const objectKey = getSkillObjectKey(skillName);
  const descriptorUrl = objectKey ? buildHiveSkillUrl(objectKey, env) : null;
  const referencePrefix = objectKey?.match(/skills\/(S\d{3})_/i)?.[1]?.toUpperCase() || null;
  const pool = getHiveSkillPoolConfig(env);
  return Object.freeze({
    name: clean(skillName),
    slug: clean(skillName),
    referencePrefix,
    objectKey,
    descriptorUrl,
    manifestUrl: pool.manifestUrl,
    source: "HIVE R2 shared skill pool",
    accessMode: pool.accessMode,
    executionOwner: pool.executionOwner,
    localSkillLibraryRequired: false,
    directExecutionAllowed: false
  });
}

export function getLane1SkillReferences(env = process.env) {
  return LANE_1_SKILL_NAMES.map((name) => getCentralSkillReference(name, env));
}

export function getAuditSkillDocumentReference(name, env = process.env) {
  const key = clean(name).toLowerCase();
  const doc = AUDIT_SKILL_DOCUMENTS[key];
  if (!doc) return null;
  const pool = getHiveSkillPoolConfig(env);
  return Object.freeze({
    ...doc,
    objectUrl: `${pool.r2PublicBaseUrl}/${doc.objectKey}`,
    source: "HIVE R2 shared skill pool",
    accessMode: pool.accessMode,
    executionOwner: pool.executionOwner,
    localSkillFileRequired: false,
    directExecutionAllowed: false,
  });
}

export function getAuditSkillDocumentReferences(env = process.env) {
  return Object.keys(AUDIT_SKILL_DOCUMENTS).map((name) => getAuditSkillDocumentReference(name, env));
}

export async function fetchHiveSkillText(objectKeyOrUrl, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available in this runtime");
  const value = clean(objectKeyOrUrl);
  const url = /^https?:\/\//i.test(value) ? value : buildHiveSkillUrl(value, env);
  if (!url) throw new Error("Missing HIVE skill object key or URL");
  const response = await fetchImpl(url, { headers: { accept: "text/plain, text/markdown, */*" } });
  if (!response.ok) throw new Error(`HIVE skill text fetch failed: ${response.status} ${response.statusText}`);
  return response.text();
}

export async function fetchHiveSkillJson(objectKeyOrUrl, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available in this runtime");
  const value = clean(objectKeyOrUrl);
  const url = /^https?:\/\//i.test(value) ? value : buildHiveSkillUrl(value, env);
  if (!url) throw new Error("Missing HIVE skill object key or URL");
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`HIVE skill fetch failed: ${response.status} ${response.statusText}`);
  return response.json();
}

export async function fetchAimsSkillManifest(options = {}) {
  const pool = getHiveSkillPoolConfig(options.env || process.env);
  return fetchHiveSkillJson(pool.manifestUrl, options);
}

export default {
  HIVE_SKILL_POOL_DEFAULTS,
  LANE_1_SKILL_NAMES,
  getHiveSkillPoolConfig,
  getSkillObjectKey,
  buildHiveSkillUrl,
  getCentralSkillReference,
  getLane1SkillReferences,
  fetchHiveSkillJson,
  fetchHiveSkillText,
  fetchAimsSkillManifest,
  getAuditSkillDocumentReference,
  getAuditSkillDocumentReferences
};
