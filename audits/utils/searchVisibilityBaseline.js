import { getCentralSkillReference, getHiveSkillPoolConfig } from "../../services/shared/hiveSkillPool.js";

const seoAudit = getCentralSkillReference("seo-audit");
const aiSeo = getCentralSkillReference("ai-seo");
const pool = getHiveSkillPoolConfig();

export const searchVisibilityBaseline = Object.freeze({
  batch: "Batch 1 - Search visibility baseline",
  lane: "Lane 1 - Autonomous",
  mode: "reports-only",
  skillSource: "central HIVE R2 shared skill pool",
  manifestUrl: pool.manifestUrl,
  skills: Object.freeze([
    Object.freeze({
      name: "seo-audit",
      referencePrefix: seoAudit.referencePrefix,
      source: seoAudit.source,
      sourceUrl: seoAudit.descriptorUrl,
      installCommand: null,
      purpose: "Traditional SEO baseline for crawlability, indexation, technical foundations, on-page signals, content quality and authority evidence.",
    }),
    Object.freeze({
      name: "ai-seo",
      referencePrefix: aiSeo.referencePrefix,
      source: aiSeo.source,
      sourceUrl: aiSeo.descriptorUrl,
      installCommand: null,
      purpose: "AEO/GEO/LLMO baseline for extractable answers, entity clarity, crawl/index eligibility, AI citation readiness, visible-content/schema alignment, OAI-SearchBot accessibility, and optional llms.txt support.",
    }),
  ]),
  guardrails: Object.freeze([
    "Generate reports only; do not edit public pages or templates.",
    "Do not auto-merge, auto-deploy, alter DNS or Cloudflare settings, or send outreach.",
    "Move every remediation from this baseline into a separate Lane 2 approval-gated patch before changing production code or content.",
    "Read skills from the central HIVE/R2 manifest; do not install local .agents copies in AIMS.",
  ]),
  expectedEvidence: Object.freeze([
    "audited scope and timestamp",
    "source URLs and files inspected",
    "SEO findings grouped by severity",
    "AEO/GEO findings grouped by page family",
    "exact affected URL, file, route family or artefact where available",
    "confidence level and verification method",
    "clear report-only Batch 1 marker",
    "central HIVE skill descriptor references",
  ]),
});

export function getSearchVisibilityBaseline() {
  return searchVisibilityBaseline;
}

export default searchVisibilityBaseline;
