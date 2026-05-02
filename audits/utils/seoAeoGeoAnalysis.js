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
8. Score using these exact weights internally, then return every executiveSummary.scores.*.score as a whole-number 0-100 percentage. Do not return raw weighted points such as 17/20. Grade must match the returned percentage: A=90-100, B=80-89, C=70-79, D=60-69, F<60.
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

function expectedGrade(score) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function requireNonEmptyArray(value, key) {
  requireArray(value, key);
  if (value.length < 1) {
    throw new Error(`Analysis response returned empty array: ${key}`);
  }
}

function requirePercentageScore(scoreBlock, key) {
  requireObject(scoreBlock, `executiveSummary.scores.${key}`);
  const score = scoreBlock.score;
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error(`Analysis response score for ${key} must be a 0-100 percentage; received ${score}`);
  }
  const grade = String(scoreBlock.grade || "").trim().toUpperCase().slice(0, 1);
  const expected = expectedGrade(score);
  if (grade && grade !== expected) {
    throw new Error(`Analysis response grade for ${key} is ${scoreBlock.grade}; score ${score} requires grade ${expected}`);
  }
}

function requirePopulatedRows(rows, key, requiredFields) {
  requireNonEmptyArray(rows, key);
  rows.forEach((row, index) => {
    requireObject(row, `${key}[${index}]`);
    for (const field of requiredFields) {
      const value = row[field];
      if (value === undefined || value === null || String(value).trim() === "") {
        throw new Error(`Analysis response ${key}[${index}] is missing populated field: ${field}`);
      }
    }
  });
}

function requireIssueFields(rows) {
  requireNonEmptyArray(rows, "issues");
  const required = [
    "issueId",
    "severity",
    "confidence",
    "lens",
    "rootCauseLevel",
    "affected",
    "evidenceObserved",
    "whyItMatters",
    "exactRemediation",
    "expectedGain",
    "estimatedEffort",
    "recommendedOwner",
    "verificationMethod",
  ];
  rows.forEach((row, index) => {
    requireObject(row, `issues[${index}]`);
    for (const field of required) {
      const value = row[field];
      if (value === undefined || value === null || String(value).trim() === "") {
        throw new Error(`Analysis response issues[${index}] is missing populated field: ${field}`);
      }
    }
  });
}

function validateAnalysisShape(data) {
  requireObject(data, "root");
  requireObject(data.executiveSummary, "executiveSummary");
  requireObject(data.findingsByLens, "findingsByLens");
  requireIssueFields(data.issues);
  requirePopulatedRows(data.pageTypeFindings, "pageTypeFindings", ["pageType", "count", "coverageState", "score", "grade", "judgement", "keyNote"]);
  requirePopulatedRows(data.priorityPageAnnex, "priorityPageAnnex", ["url", "pageType", "titleStatus", "metaStatus", "canonicalStatus", "schemaStatus", "aeoStatus", "geoStatus", "score", "grade", "keyNote"]);
  requirePopulatedRows(data.templateAnnex, "templateAnnex", ["sourceFile", "area", "observedLogic", "repeatedEffect", "fixPriority"]);
  requireArray(data.codeRemediationAppendix, "codeRemediationAppendix");
  requirePopulatedRows(data.bestPracticeGapMatrix, "bestPracticeGapMatrix", ["pageType", "seo", "aeo", "geo", "confidence", "topMissingElement", "businessImpact"]);
  requireObject(data.implementationOrder, "implementationOrder");

  const scoreBlock = data.executiveSummary.scores || {};
  for (const key of ["seo", "aeo", "geo", "entityAuthority", "conversionSupport"]) {
    requirePercentageScore(scoreBlock[key], key);
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
  const hasCriticalOrHigh = data.issues.some((issue) => ["Critical", "High"].includes(String(issue.severity || "")));
  if (hasCriticalOrHigh && data.codeRemediationAppendix.length < 1) {
    throw new Error("Analysis response has Critical/High issues but no codeRemediationAppendix entries");
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
