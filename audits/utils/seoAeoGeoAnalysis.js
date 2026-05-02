import { resilientRequest } from "../../services/shared/utils/ai-service.js";

const SYSTEM_PROMPT = `You are a senior forensic SEO + AEO + GEO auditor. You operate with the precision of a technical SEO engineer, semantic search strategist, answer-engine analyst, and generative-search specialist.

You will receive a structured JSON context block containing pre-crawled page data, inventory reconciliation results, workbook metadata, coverage ledgers, and heuristic issue flags collected from the jonathan-harris.online estate. Your job is to interpret that data forensically and produce a complete, evidence-led audit report.

OPERATING RULES — NON-NEGOTIABLE:
1. No boilerplate. No filler. No invented evidence.
2. No vague statements such as "improve metadata", "enhance structured data", or "optimise content quality" unless you immediately name the exact page, file, element, current value, defect, and corrected target.
3. Every significant finding must cite the exact route, URL, file path, or template it applies to.
4. If a metric cannot be measured from the supplied data, write "Not verified from supplied context" and state why. Do not fabricate scores or invent crawl results.
5. Prefer exact values: current title tag text, exact canonical href, exact heading text, exact file path.
6. When the supplied data conflicts across sources (repo vs workbook vs live), state the conflict explicitly.
7. Do not silently skip page families. If podcast/blog/transcript data is thin in the supplied context, say so and flag it as a coverage limitation — do not pretend to have checked pages you have not seen.
8. Score using these exact weights: Technical SEO 20, On-Page Intent 15, AEO Readiness 20, GEO Readiness 20, Entity Authority 10, Internal Linking 10, Conversion Support 5. Grade: A=90-100, B=80-89, C=70-79, D=60-69, F<60.
9. Every Critical or High issue must include an exact remediation: the corrected value, code snippet, template change, or governance rule — not a description of what to change.
10. Use severity: Critical / High / Medium / Low. Use confidence: Confirmed / Probable / Needs verification.
11. Honour full-estate audit rules. Blog, podcast, transcript, archive, and programmatic content are mandatory if present in the supplied context.
12. Return a single JSON object only. No markdown fences. No preamble.

OUTPUT SCHEMA:
{
  "executiveSummary": {
    "overallVerdict": "",
    "scores": {
      "seo": { "score": 0, "grade": "", "headline": "" },
      "aeo": { "score": 0, "grade": "", "headline": "" },
      "geo": { "score": 0, "grade": "", "headline": "" },
      "entityAuthority": { "score": 0, "grade": "", "headline": "" },
      "conversionSupport": { "score": 0, "grade": "", "headline": "" }
    },
    "topFivePriorities": ["", "", "", "", ""],
    "quickWins": ["", "", ""],
    "estateLabels": [""]
  },
  "findingsByLens": {
    "technicalSeo": "",
    "onPageSeo": "",
    "aeo": "",
    "geo": "",
    "entityAuthority": "",
    "structuredData": "",
    "internalLinking": "",
    "contentArchitecture": "",
    "conversionSupport": "",
    "blogPodcastTranscriptSystems": ""
  },
  "issues": [
    {
      "issueId": "",
      "severity": "Critical / High / Medium / Low",
      "confidence": "Confirmed / Probable / Needs verification",
      "lens": "SEO / AEO / GEO / Entity / Technical / Schema / Internal Linking / Content / Conversion",
      "rootCauseLevel": "template / page / system / route / content / schema / data / workbook mismatch",
      "affected": "",
      "evidenceObserved": "",
      "whyItMatters": "",
      "exactRemediation": "",
      "expectedGain": "",
      "estimatedEffort": "Low / Medium / High",
      "recommendedOwner": "SEO / Content / Editorial / Frontend / Engineering / Schema / Product / Analytics",
      "verificationMethod": ""
    }
  ],
  "pageTypeFindings": [],
  "priorityPageAnnex": [],
  "templateAnnex": [],
  "codeRemediationAppendix": [],
  "bestPracticeGapMatrix": [],
  "implementationOrder": {
    "narrative": "",
    "steps": [""],
    "expectedGains": [""]
  }
}`;

function trimLargeArray(items, maxItems = 500) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, maxItems);
}

function buildUserPrompt(payload) {
  const compact = {
    website: payload.baseUrl,
    sessionId: payload.sessionId,
    generatedAt: payload.generatedAt,
    inventory: payload.inventory,
    priorityPages: trimLargeArray(payload.priorityPages, 30),
    allRoutes: trimLargeArray(payload.allRoutes, 500),
    heuristicIssues: trimLargeArray(payload.heuristicIssues, 80),
    repoSignals: payload.repoSignals,
    liveDynamicUrls: trimLargeArray(payload.liveDynamicUrls, 250),
    coverage: trimLargeArray(payload.coverage, 1000),
    coverageFamilies: trimLargeArray(payload.coverageFamilies, 30),
    reportRequirements: {
      output: [
        "Executive Summary",
        "Scope, Inputs, and Method",
        "Inventory and Reconciliation Summary",
        "Findings by Audit Lens",
        "Ranked Issue Ledger",
        "Page-Type Findings",
        "Priority Page Annex",
        "Template / Component / Generator Annex",
        "Code-Level / Markup / Content Remediation Appendix",
        "Best-Practice Gap Matrix",
        "Final Verdict and Implementation Order",
      ],
      keepArtefacts: ["report.html", "summary.json", "coverage.json", "latest.json"],
      dynamicFamiliesMandatory: ["blog", "podcast", "transcript", "archive", "programmatic"],
    },
  };

  return [
    "FORENSIC SEO + AEO + GEO AUDIT — CONTEXT PACKAGE",
    `Website: ${payload.baseUrl}`,
    `Session: ${payload.sessionId}`,
    `Generated: ${payload.generatedAt}`,
    "",
    "Use the supplied context only. Do not invent evidence. If the supplied context is thin for a family, state that as a limitation rather than pretending full coverage.",
    "The allRoutes and coverage arrays are the full URL ledger for this run unless the payload itself states otherwise. Do not treat the estate as sampled.",
    "Return a single JSON object only.",
    "",
    JSON.stringify(compact, null, 2),
  ].join("\n");
}

function stripFences(raw) {
  const text = String(raw || "").trim();
  if (!text.startsWith("```")) return text;
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function extractJson(raw) {
  const cleaned = stripFences(raw);
  try {
    return JSON.parse(cleaned);
  } catch {}

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(cleaned.slice(start, end + 1));
  }
  throw new Error("Model response did not contain valid JSON");
}

function requireArray(value, key) {
  if (!Array.isArray(value)) {
    throw new Error(`Analysis response is missing array: ${key}`);
  }
}

function requireObject(value, key) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Analysis response is missing object: ${key}`);
  }
}

function validateAnalysisShape(data) {
  requireObject(data, "root");
  requireObject(data.executiveSummary, "executiveSummary");
  requireObject(data.findingsByLens, "findingsByLens");
  requireArray(data.issues, "issues");
  requireArray(data.pageTypeFindings, "pageTypeFindings");
  requireArray(data.priorityPageAnnex, "priorityPageAnnex");
  requireArray(data.templateAnnex, "templateAnnex");
  requireArray(data.codeRemediationAppendix, "codeRemediationAppendix");
  requireArray(data.bestPracticeGapMatrix, "bestPracticeGapMatrix");
  requireObject(data.implementationOrder, "implementationOrder");

  const scoreBlock = data.executiveSummary.scores || {};
  for (const key of ["seo", "aeo", "geo", "entityAuthority", "conversionSupport"]) {
    requireObject(scoreBlock[key], `executiveSummary.scores.${key}`);
  }

  for (const key of [
    "technicalSeo",
    "onPageSeo",
    "aeo",
    "geo",
    "entityAuthority",
    "structuredData",
    "internalLinking",
    "contentArchitecture",
    "conversionSupport",
    "blogPodcastTranscriptSystems",
  ]) {
    if (typeof data.findingsByLens[key] !== "string" || !data.findingsByLens[key].trim()) {
      throw new Error(`Analysis response is missing narrative string: findingsByLens.${key}`);
    }
  }

  if (!Array.isArray(data.executiveSummary.topFivePriorities) || data.executiveSummary.topFivePriorities.length < 3) {
    throw new Error("Analysis response returned too few topFivePriorities");
  }
  if (!Array.isArray(data.executiveSummary.quickWins) || data.executiveSummary.quickWins.length < 2) {
    throw new Error("Analysis response returned too few quickWins");
  }
  if (data.issues.length < 5) {
    throw new Error("Analysis response returned too few ranked issues for a full-estate audit");
  }

  return data;
}

export async function runSeoAeoGeoAnalysis(payload) {
  const userPrompt = buildUserPrompt(payload);
  const raw = await resilientRequest("auditForensic", {
    sessionId: payload.sessionId,
    routeName: "auditForensic",
    max_tokens: 9000,
    temperature: 0.25,
    top_p: 0.95,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  const parsed = extractJson(raw);
  return validateAnalysisShape(parsed);
}

export default { runSeoAeoGeoAnalysis };
