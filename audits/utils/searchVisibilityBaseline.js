export const searchVisibilityBaseline = Object.freeze({
  batch: "Batch 1 - Search visibility baseline",
  lane: "Lane 1 - Autonomous",
  mode: "reports-only",
  skills: Object.freeze([
    Object.freeze({
      name: "seo-audit",
      source: "coreyhaines31/marketingskills",
      sourceUrl: "https://skills.sh/coreyhaines31/marketingskills/seo-audit",
      installCommand: "npx --yes skills@latest add coreyhaines31/marketingskills --skill seo-audit ai-seo -y",
      purpose: "Traditional SEO baseline for crawlability, indexation, technical foundations, on-page signals, content quality and authority evidence.",
    }),
    Object.freeze({
      name: "ai-seo",
      source: "coreyhaines31/marketingskills",
      sourceUrl: "https://skills.sh/coreyhaines31/marketingskills/ai-seo",
      installCommand: "npx --yes skills@latest add coreyhaines31/marketingskills --skill seo-audit ai-seo -y",
      purpose: "AEO/GEO/LLMO baseline for extractable answers, entity clarity, AI citation readiness, llms.txt coverage and structured context.",
    }),
  ]),
  guardrails: Object.freeze([
    "Generate reports only; do not edit public pages or templates.",
    "Do not auto-merge, auto-deploy, alter DNS or Cloudflare settings, or send outreach.",
    "Move every remediation from this baseline into a separate Lane 2 approval-gated patch before changing production code or content.",
  ]),
  expectedEvidence: Object.freeze([
    "audited scope and timestamp",
    "source URLs and files inspected",
    "SEO findings grouped by severity",
    "AEO/GEO findings grouped by page family",
    "exact affected URL, file, route family or artefact where available",
    "confidence level and verification method",
    "clear report-only Batch 1 marker",
  ]),
});

export function getSearchVisibilityBaseline() {
  return searchVisibilityBaseline;
}

export default searchVisibilityBaseline;
