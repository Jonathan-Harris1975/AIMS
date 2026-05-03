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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = "Not verified from supplied context") {
  const normalised = value === undefined || value === null ? "" : String(value).trim();
  return normalised || fallback;
}

function clampScore(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(0, Math.min(100, Math.round(fallback)));
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function expectedGrade(score) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function gradeRepresentativeScore(grade) {
  const key = String(grade || "").trim().toUpperCase().slice(0, 1);
  return { A: 92, B: 84, C: 74, D: 64, F: 49 }[key];
}

function scoreFromRows(payload, selector, denominator) {
  const routes = asArray(payload?.allRoutes).filter((route) => {
    const state = String(route.coverageState || "");
    return (
      state === "Fully analysed" ||
      state === "Analysed through shared template plus page-specific checks"
    );
  });

  const scoped = routes.length ? routes : asArray(payload?.allRoutes);
  if (!scoped.length) return 0;

  const values = scoped.map(selector).filter((value) => Number.isFinite(value));
  if (!values.length) return 0;

  return Math.round(
    (values.reduce((sum, value) => sum + value, 0) / values.length / denominator) * 100
  );
}

function fallbackScores(payload) {
  const conversionTypes = new Set([
    "lead generation",
    "comparison",
    "book hub",
    "book page",
    "service / product",
  ]);

  const routes = asArray(payload?.allRoutes).filter((route) => {
    const state = String(route.coverageState || "");
    return (
      state === "Fully analysed" ||
      state === "Analysed through shared template plus page-specific checks"
    );
  });

  const conversionRoutes = routes.filter((route) =>
    conversionTypes.has(String(route.pageType || ""))
  );

  const conversionScore = conversionRoutes.length
    ? Math.round(
        (conversionRoutes.reduce(
          (sum, route) => sum + Number(route.scores?.conversion || 0),
          0
        ) /
          conversionRoutes.length /
          5) *
          100
      )
    : 0;

  return {
    seo: scoreFromRows(
      payload,
      (route) =>
        Number(route.scores?.technicalSeo || 0) +
        Number(route.scores?.onPageIntent || 0),
      35
    ),
    aeo: scoreFromRows(payload, (route) => Number(route.scores?.aeo || 0), 20),
    geo: scoreFromRows(payload, (route) => Number(route.scores?.geo || 0), 20),
    entityAuthority: scoreFromRows(
      payload,
      (route) => Number(route.scores?.entity || 0),
      10
    ),
    conversionSupport: conversionScore,
  };
}

function normaliseScoreBlock(block, key, fallback) {
  const source = isPlainObject(block) ? block : {};
  let score = Number(source.score);
  const suppliedGrade = String(source.grade || "").trim().toUpperCase().slice(0, 1);

  if (!Number.isFinite(score)) {
    score = fallback;
  }

  if (score <= 20 && suppliedGrade && suppliedGrade !== expectedGrade(score)) {
    score = gradeRepresentativeScore(suppliedGrade) ?? score * 5;
  } else if (score <= 20 && score > 0 && ["seo", "aeo", "geo"].includes(key)) {
    score *= 5;
  }

  const finalScore = clampScore(score, fallback);

  return {
    score: finalScore,
    grade: expectedGrade(finalScore),
    headline: text(
      source.headline,
      `${key} score normalised from the supplied forensic analysis and crawl ledger.`
    ),
  };
}

function coverageRows(payload) {
  return asArray(payload?.coverageFamilies).length
    ? asArray(payload.coverageFamilies)
    : asArray(payload?.coverage);
}

function coverageStateFromRow(row) {
  if (Number(row.failed || 0) > 0) return "Partial / failed";
  if (Number(row.excluded || 0) > 0 && Number(row.analysed || 0) === 0) {
    return "Excluded / redirected";
  }
  if (Number(row.excluded || 0) > 0) return "Analysed plus explicit exclusions";
  return Number(row.coveragePercent || 0) >= 100 ? "Fully analysed" : "Partial / failed";
}

function normalisePageTypeFindings(data, payload) {
  const rows = asArray(data.pageTypeFindings).filter(
    (row) => isPlainObject(row) && row.pageType && row.count !== undefined
  );

  if (rows.length) {
    return rows.map((row) => {
      const score = clampScore(row.score ?? row.averageScore, 0);
      return {
        pageType: text(row.pageType, "Unknown page type"),
        count: Number(row.count || row.discovered || 0),
        coverageState: text(row.coverageState, "Not verified from supplied context"),
        score,
        grade: expectedGrade(score),
        judgement: text(
          row.judgement,
          "Judgement derived from supplied AI analysis and coverage ledger."
        ),
        keyNote: text(row.keyNote, "See coverage ledger for URL-level evidence."),
      };
    });
  }

  return coverageRows(payload).map((row) => {
    const score = clampScore(row.averageScore, 0);
    return {
      pageType: text(row.pageType, "Unknown page type"),
      count: Number(row.discovered || 0),
      coverageState: coverageStateFromRow(row),
      score,
      grade: expectedGrade(score),
      judgement:
        Number(row.failed || 0) > 0
          ? "Coverage defects remain in this family."
          : "Family inventoried with explicit URL-level coverage states.",
      keyNote: `Analysed ${Number(row.analysed || 0)}, excluded ${Number(
        row.excluded || 0
      )}, failed ${Number(row.failed || 0)}.`,
    };
  });
}

function statusLabelFromScore(score, good = 80, mixed = 60) {
  if (score >= good) return "Healthy";
  if (score >= mixed) return "Mixed";
  return "Weak";
}

function normalisePriorityPageAnnex(data, payload) {
  const rows = asArray(data.priorityPageAnnex).filter(
    (row) => isPlainObject(row) && row.url
  );

  if (rows.length) {
    return rows.map((row) => {
      const score = clampScore(row.score, 0);
      return {
        url: text(row.url, ""),
        pageType: text(row.pageType, "Unknown page type"),
        templateSource: text(row.templateSource, "Derived from supplied route family."),
        titleStatus: text(row.titleStatus, "Not verified"),
        metaStatus: text(row.metaStatus, "Not verified"),
        canonicalStatus: text(row.canonicalStatus, "Not verified"),
        schemaStatus: text(row.schemaStatus, "Not verified"),
        aeoStatus: text(row.aeoStatus, "Not verified"),
        geoStatus: text(row.geoStatus, "Not verified"),
        score,
        grade: expectedGrade(score),
        confirmedIssueIds: asArray(row.confirmedIssueIds),
        keyNote: text(row.keyNote, "See URL coverage appendix for evidence."),
      };
    });
  }

  return asArray(payload?.priorityPages).slice(0, 30).map((page) => {
    const score = clampScore(page.total, 0);
    const aeoScore = Number(page.scores?.aeo || 0);
    const geoScore = Number(page.scores?.geo || 0);

    return {
      url: text(page.url, ""),
      pageType: text(page.pageType, "Unknown page type"),
      templateSource: text(page.route, "Supplied priority route"),
      titleStatus: page.title ? "Healthy" : "Missing",
      metaStatus: page.metaDescription ? "Healthy" : "Missing",
      canonicalStatus: page.canonical ? "Healthy" : "Missing",
      schemaStatus: Number(page.schemaCount || 0) > 0 ? "Healthy" : "Missing",
      aeoStatus: statusLabelFromScore((aeoScore / 20) * 100),
      geoStatus: statusLabelFromScore((geoScore / 20) * 100),
      score,
      grade: expectedGrade(score),
      confirmedIssueIds: [],
      keyNote: text(page.coverageState, "Priority route included from crawl ledger."),
    };
  });
}

function normaliseTemplateAnnex(data, payload) {
  const rows = asArray(data.templateAnnex).filter(
    (row) => isPlainObject(row) && (row.sourceFile || row.area)
  );

  if (rows.length) {
    return rows.map((row) => ({
      sourceFile: text(row.sourceFile || row.target || row.area, "Unknown source file"),
      area: text(row.area || row.pageFamily, "Route family"),
      observedLogic: text(
        row.observedLogic || row.metadataLogic,
        "Observed from supplied route/template evidence."
      ),
      repeatedEffect: text(
        row.repeatedEffect || row.repeatedDefects,
        "Repeated family effect recorded in coverage ledger."
      ),
      fixPriority: text(row.fixPriority, "Medium"),
    }));
  }

  return coverageRows(payload).map((row) => ({
    sourceFile: text(row.sourceFile || row.pageType, "Route family"),
    area: text(row.pageType, "Route family"),
    observedLogic: `Family coverage: discovered ${Number(
      row.discovered || 0
    )}, analysed ${Number(row.analysed || 0)}, excluded ${Number(
      row.excluded || 0
    )}, failed ${Number(row.failed || 0)}.`,
    repeatedEffect:
      Number(row.failed || 0) > 0
        ? "Unresolved fetch failures affect audit completeness."
        : "No missing coverage state detected in this family.",
    fixPriority:
      Number(row.failed || 0) > 0 || Number(row.averageScore || 0) < 70
        ? "High"
        : "Medium",
  }));
}

function complianceFromAverage(score) {
  const numeric = Number(score || 0);
  if (numeric >= 85) return "Strong";
  if (numeric >= 70) return "Partial";
  return "Weak";
}

function normaliseGapMatrix(data, payload) {
  const rows = asArray(data.bestPracticeGapMatrix).filter(
    (row) => isPlainObject(row) && row.pageType
  );

  if (rows.length) {
    return rows.map((row) => ({
      pageType: text(row.pageType, "Unknown page type"),
      seo: text(row.seo, "Not verified"),
      aeo: text(row.aeo, "Not verified"),
      geo: text(row.geo, "Not verified"),
      confidence: text(row.confidence, "Needs verification"),
      topMissingElement: text(row.topMissingElement || row.topMissing, "See issue ledger"),
      businessImpact: text(row.businessImpact, "Medium"),
    }));
  }

  return coverageRows(payload).map((row) => ({
    pageType: text(row.pageType, "Unknown page type"),
    seo: complianceFromAverage(row.averageScore),
    aeo: Number(row.averageScore || 0) >= 80 ? "Partial" : "Weak",
    geo: complianceFromAverage(row.averageScore),
    confidence: "Confirmed",
    topMissingElement:
      Number(row.failed || 0) > 0
        ? "Fetch or redirect reliability"
        : "Answer-first evidence blocks",
    businessImpact: [
      "book page",
      "podcast episode",
      "podcast transcript",
      "blog article",
      "lead generation",
    ].includes(String(row.pageType || ""))
      ? "High"
      : "Medium",
  }));
}

function normaliseIssues(data, payload) {
  const sourceIssues = [...asArray(data.issues), ...asArray(payload?.heuristicIssues)];
  const seen = new Set();
  const issues = [];

  for (const issue of sourceIssues) {
    if (!isPlainObject(issue)) continue;

    const affected = text(issue.affected, "Affected route family from supplied evidence");
    const why = text(
      issue.whyItMatters,
      "This affects crawlability, answer extraction, retrieval, or conversion support."
    );
    const remediation = text(
      issue.exactRemediation,
      "Apply the exact template, route, or content fix described in the issue evidence."
    );
    const id = text(
      issue.issueId,
      `JH-SEO-${String(issues.length + 1).padStart(3, "0")}`
    );

    const key = `${id}|${affected}|${why}`;
    if (seen.has(key)) continue;
    seen.add(key);

    issues.push({
      issueId: id,
      severity: text(issue.severity, "Medium"),
      confidence: text(issue.confidence, "Confirmed"),
      lens: text(issue.lens || issue.auditLens, "SEO"),
      rootCauseLevel: text(issue.rootCauseLevel, "system"),
      affected,
      evidenceObserved: text(
        issue.evidenceObserved,
        "Evidence observed in supplied crawl, repo, workbook, or coverage ledger."
      ),
      whyItMatters: why,
      exactRemediation: remediation,
      expectedGain: text(
        issue.expectedGain,
        "Improved crawl reliability, answer extraction, and generative retrieval quality."
      ),
      estimatedEffort: text(issue.estimatedEffort, "Medium"),
      recommendedOwner: text(issue.recommendedOwner, "Engineering"),
      verificationMethod: text(
        issue.verificationMethod || issue.verification,
        "Rerun the SEO + AEO + GEO audit and confirm the corrected evidence state in coverage.json and report.html."
      ),
    });
  }

  if (issues.length < 5) {
    for (const row of coverageRows(payload)) {
      if (issues.length >= 5) break;

      const pageType = text(row.pageType, "Unknown page type");
      const id = `JH-AEO-${String(issues.length + 1).padStart(3, "0")}`;

      issues.push({
        issueId: id,
        severity: Number(row.averageScore || 0) < 70 ? "High" : "Medium",
        confidence: "Confirmed",
        lens: "AEO / GEO",
        rootCauseLevel: "template",
        affected: `${pageType} (${Number(row.discovered || 0)} URLs)`,
        evidenceObserved: `Family average score ${Number(
          row.averageScore || 0
        )}; anal
