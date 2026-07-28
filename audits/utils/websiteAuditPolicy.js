import fs from "node:fs";

const POLICY_URL = new URL("../../config/website-audit-policy.json", import.meta.url);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function loadPolicy() {
  const raw = fs.readFileSync(POLICY_URL, "utf8");
  const parsed = JSON.parse(raw);
  if (parsed?.schemaVersion !== "website-audit-policy/v2") {
    throw new Error(`Unsupported website audit policy schema: ${parsed?.schemaVersion || "missing"}`);
  }
  return deepFreeze(parsed);
}

export const WEBSITE_AUDIT_POLICY = loadPolicy();

export function getWebsiteAuditPolicy() {
  return WEBSITE_AUDIT_POLICY;
}

export function delegatedAuditPrefixes() {
  return WEBSITE_AUDIT_POLICY.delegatedAuditFamilies.map((family) => family.prefix);
}

export function websiteAuditDefaultExclusions(auditType) {
  if (!["digital-growth", "seo-aeo-geo", "mobile-ux"].includes(String(auditType || ""))) return [];
  return delegatedAuditPrefixes();
}

export function isDelegatedWebsiteRoute(value) {
  const text = String(value || "");
  return WEBSITE_AUDIT_POLICY.delegatedAuditFamilies.some(({ prefix }) =>
    text === prefix || text.startsWith(`${prefix}/`) || text.includes(`jonathan-harris.online${prefix}`)
  );
}

export function compactWebsiteAuditPolicy() {
  const p = WEBSITE_AUDIT_POLICY;
  return {
    schemaVersion: p.schemaVersion,
    minimumTargetScore: p.minimumTargetScore,
    delegatedAuditFamilies: p.delegatedAuditFamilies,
    websiteAuditIncludedRoutes: p.websiteAuditIncludedRoutes,
    forms: p.forms,
    podcast: p.podcast,
    accessibility: p.accessibility,
    visualDesign: p.visualDesign,
    performance: p.performance,
    searchAndAiDiscovery: p.searchAndAiDiscovery,
    securityPlatform: p.securityPlatform,
    evidenceGates: p.evidenceGates,
    deployment: p.deployment,
    scoring: p.scoring,
  };
}

export default WEBSITE_AUDIT_POLICY;
