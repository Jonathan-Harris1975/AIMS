import { getLocalSkillReference, getLocalSkillRegistryConfig } from "../../services/shared/localSkills.js";

const seoAudit = getLocalSkillReference("seo-audit", "lane1");
const aiSeo = getLocalSkillReference("ai-seo", "lane1");
const registry = getLocalSkillRegistryConfig();

export const searchVisibilityBaseline = Object.freeze({
  batch: "Batch 1 - Search visibility baseline",
  lane: "Lane 1 - Autonomous",
  mode: "reports-only",
  skillSource: "AIMS repository-local skills",
  skillRegistry: registry,
  skills: Object.freeze([
    Object.freeze({
      name: "seo-audit",
      skillId: seoAudit.skillId,
      referencePrefix: seoAudit.referencePrefix,
      source: seoAudit.source,
      sourceUrl: seoAudit.descriptorUrl,
      installCommand: null,
      purpose: "Traditional SEO baseline for crawlability, indexation, technical foundations, on-page signals, content quality and authority evidence.",
    }),
    Object.freeze({
      name: "ai-seo",
      skillId: aiSeo.skillId,
      referencePrefix: aiSeo.referencePrefix,
      source: aiSeo.source,
      sourceUrl: aiSeo.descriptorUrl,
      installCommand: null,
      purpose: "AEO/GEO/LLMO baseline for extractable answers, entity clarity, crawl/index eligibility, "
        + "AI citation readiness, visible-content/schema alignment, OAI-SearchBot accessibility, and optional llms.txt support.",
    }),
  ]),
  guardrails: Object.freeze([
    "Generate reports only; do not edit public pages or templates.",
    "Do not auto-merge, auto-deploy, alter DNS or Cloudflare settings, or send outreach.",
    "Move every remediation from this baseline into a separate Lane 2 approval-gated patch before changing production code or content.",
    "Use the repository-local AIMS skill metadata only; do not install external skill bundles or depend on runtime skill discovery.",
  ]),
  expectedEvidence: Object.freeze([
    "audited scope and timestamp",
    "source URLs and files inspected",
    "SEO findings grouped by severity",
    "AEO/GEO findings grouped by page family",
    "exact affected URL, file, route family or artefact where available",
    "confidence level and verification method",
    "clear report-only Batch 1 marker",
    "AIMS local skill descriptor references",
  ]),
});

export function getSearchVisibilityBaseline() {
  return searchVisibilityBaseline;
}

export default searchVisibilityBaseline;
