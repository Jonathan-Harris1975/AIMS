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

function firstPlainObject(...values) {
  return values.find((value) => isPlainObject(value)) || {};
}

function normalisedSourceSummary(data) {
  if (isPlainObject(data?.executiveSummary)) {
    return data.executiveSummary;
  }

  return {
    overallVerdict: data?.overallVerdict || data?.executiveSummary,
    scores: data?.scoreTable,
    topFivePriorities: data?.topFivePriorities,
    quickWins: data?.quickWins,
    estateLabels: data?.estateLabels,
  };
}

function sourceIssueRows(data) {
  return [...asArray(data?.issues), ...asArray(data?.rankedIssueLedger)];
}

function sourceFindings(data) {
  return firstPlainObject(data?.findingsByLens, data?.findingsByAuditLens);
}

function sourceImplementationOrder(data) {
  return firstPlainObject(data?.implementationOrder, data?.finalVerdictAndImplementationOrder);
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
  const rows = [...asArray(data.templateAnnex), ...asArray(data.templateComponentGeneratorAnnex)].filter(
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

function hasGenericRemediation(value) {
  const normalised = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "");

  return new Set([
    "improve metadata",
    "enhance metadata",
    "optimise metadata",
    "optimize metadata",
    "improve content",
    "optimise content",
    "optimize content",
    "enhance structured data",
    "improve seo",
    "fix seo",
  ]).has(normalised);
}

function assertSpecificRemediation(issue, issueId) {
  if (issue?.exactRemediation === undefined) return;
  if (!hasGenericRemediation(issue.exactRemediation)) return;

  throw new Error(
    `${issueId} exactRemediation is too generic; name the exact page, file, element, corrected value, snippet, or governance rule.`
  );
}

function normaliseIssues(data, payload) {
  const sourceIssues = [...sourceIssueRows(data), ...asArray(payload?.heuristicIssues)];
  const seen = new Set();
  const issues = [];

  for (const issue of sourceIssues) {
    if (!isPlainObject(issue)) continue;

    const affected = text(
      issue.affected || issue.affectedPagesTemplatesFilesOrRoutes,
      "Affected route family from supplied evidence"
    );
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

    assertSpecificRemediation(issue, id);

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
        )}; analysed ${Number(row.analysed || 0)}, excluded ${Number(
          row.excluded || 0
        )}, failed ${Number(row.failed || 0)}.`,
        whyItMatters:
          "Weak or thin template evidence reduces direct-answer extraction and generative retrieval quality.",
        exactRemediation:
          "Add answer-first summaries, extractable subheadings, entity cues, and internal links appropriate to this page family.",
        expectedGain:
          "Better passage extraction, stronger citation-readiness, and clearer topical routing.",
        estimatedEffort: "Medium",
        recommendedOwner: "Content",
        verificationMethod:
          "Rerun the audit and confirm the page-family score and evidence rows improve in the generated report.",
      });
    }
  }

  return issues.slice(0, Math.max(5, issues.length));
}

function normaliseCodeRemediation(data, issues) {
  const rows = [...asArray(data.codeRemediationAppendix), ...asArray(data.codeMarkupContentRemediationAppendix)].filter((row) =>
    isPlainObject(row)
  );

  if (rows.length) {
    return rows.map((row) => ({
      target: text(row.target || row.filePath || row.sourceFile, "Affected source path or route family"),
      issueId: text(row.issueId, "Unmapped issue"),
      currentPattern: text(row.currentPattern || row.currentFaultyPattern, "See issue evidence."),
      correctedPattern: text(row.correctedPattern || row.replacementPattern, "Apply the issue remediation exactly."),
      rationale: text(row.rationale || row.whyItMatters, "This change resolves the affected audit issue."),
    }));
  }

  return issues
    .filter((issue) => ["Critical", "High"].includes(issue.severity))
    .map((issue) => ({
      target: issue.affected,
      issueId: issue.issueId,
      currentPattern: issue.evidenceObserved,
      correctedPattern: issue.exactRemediation,
      rationale: issue.whyItMatters,
    }))
    .slice(0, 10);
}

function normaliseFindings(findings) {
  const source = isPlainObject(findings) ? findings : {};

  const fallbacks = {
    technicalSeo:
      "Technical SEO was assessed from status codes, canonicals, metadata, redirects, indexability, and route coverage evidence.",
    onPageSeo:
      "On-page SEO was assessed from titles, headings, opening copy, content depth, and route intent alignment.",
    aeo:
      "AEO readiness was assessed from answer-first summaries, question-led headings, lists, tables, FAQs, and extractable passages.",
    geo:
      "GEO readiness was assessed from entity clarity, citation-ready passages, schema support, and machine-readable discovery evidence.",
    entityAuthority:
      "Entity authority was assessed from author, book, podcast, topic, and organisation signals in the supplied crawl ledger.",
    structuredData:
      "Structured data was assessed from JSON-LD presence, schema count, and visible-content alignment where supplied.",
    internalLinking:
      "Internal linking was assessed from crawlable internal links, hub relationships, and commercial/topic bridging.",
    contentArchitecture:
      "Content architecture was assessed from route-family coverage, dynamic governance, manifests, feeds, and sitemap reconciliation.",
    conversionSupport:
      "Conversion support was assessed from newsletter, contact, book, buy-now, and commercial CTA evidence.",
    blogPodcastTranscriptSystems:
      "Blog, podcast, transcript, archive, and programmatic families were treated as mandatory estate families and reconciled against coverage evidence.",
  };

  return Object.fromEntries(
    Object.entries(fallbacks).map(([key, fallback]) => [key, text(source[key], fallback)])
  );
}

function validateAndNormaliseAnalysisShape(data, payload) {
  if (!isPlainObject(data)) {
    throw new Error("Analysis response is not a JSON object");
  }

  const sourceSummary = normalisedSourceSummary(data);
  const findings = sourceFindings(data);

  const hasUsableAiContent = Boolean(
    sourceSummary?.overallVerdict ||
      sourceIssueRows(data).length ||
      Object.values(findings).some((value) => String(value || "").trim())
  );

  if (!hasUsableAiContent) {
    throw new Error("Analysis response contained no usable forensic narrative, findings, or issue data");
  }

  const fallback = fallbackScores(payload);
  const sourceScores = isPlainObject(sourceSummary.scores) ? sourceSummary.scores : {};
  const issues = normaliseIssues(data, payload);

  const topFive = asArray(sourceSummary.topFivePriorities)
    .map((item) => String(item).trim())
    .filter(Boolean);

  const quickWins = asArray(sourceSummary.quickWins)
    .map((item) => String(item).trim())
    .filter(Boolean);

  const implementationOrderSource = sourceImplementationOrder(data);

  const normalised = {
    executiveSummary: {
      overallVerdict: text(
        sourceSummary.overallVerdict,
        "The audit completed AI-assisted synthesis using the supplied crawl, coverage, repo, workbook, sitemap, and feed evidence."
      ),
      scores: {
        seo: normaliseScoreBlock(sourceScores.seo, "seo", fallback.seo),
        aeo: normaliseScoreBlock(sourceScores.aeo, "aeo", fallback.aeo),
        geo: normaliseScoreBlock(sourceScores.geo, "geo", fallback.geo),
        entityAuthority: normaliseScoreBlock(
          sourceScores.entityAuthority,
          "entityAuthority",
          fallback.entityAuthority
        ),
        conversionSupport: normaliseScoreBlock(
          sourceScores.conversionSupport,
          "conversionSupport",
          fallback.conversionSupport
        ),
      },
      topFivePriorities: (
        topFive.length
          ? topFive
          : issues.slice(0, 5).map((issue) => `${issue.issueId}: ${issue.exactRemediation}`)
      ).slice(0, 5),
      quickWins: (
        quickWins.length
          ? quickWins
          : issues.slice(0, 3).map((issue) => issue.exactRemediation)
      ).slice(0, 3),
      estateLabels: asArray(sourceSummary.estateLabels)
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 8),
    },
    findingsByLens: normaliseFindings(findings),
    issues,
    pageTypeFindings: normalisePageTypeFindings(data, payload),
    priorityPageAnnex: normalisePriorityPageAnnex(data, payload),
    templateAnnex: normaliseTemplateAnnex(data, payload),
    codeRemediationAppendix: [],
    bestPracticeGapMatrix: normaliseGapMatrix(data, payload),
    implementationOrder: {
      narrative: text(
        implementationOrderSource.narrative,
        sourceSummary.overallVerdict || "Implementation order derived from the ranked issue ledger."
      ),
      steps: asArray(implementationOrderSource.steps).length
        ? asArray(implementationOrderSource.steps).map(String).filter(Boolean)
        : issues.slice(0, 5).map((issue) => issue.exactRemediation),
      expectedGains: asArray(implementationOrderSource.expectedGains).length
        ? asArray(implementationOrderSource.expectedGains).map(String).filter(Boolean)
        : issues.slice(0, 3).map((issue) => issue.expectedGain),
    },
  };

  if (!normalised.executiveSummary.estateLabels.length) {
    normalised.executiveSummary.estateLabels = [
      "AI-assisted",
      "full-estate coverage",
      "evidence-led",
    ];
  }

  normalised.codeRemediationAppendix = normaliseCodeRemediation(
    data,
    normalised.issues
  );

  normalised.auditCompletionState = text(data.auditCompletionState, "Complete");
  normalised.aiAnalysisStatus = text(data.aiAnalysisStatus, "valid");
  normalised.overallVerdict = normalised.executiveSummary.overallVerdict;
  normalised.scoreTable = normalised.executiveSummary.scores;
  normalised.topFivePriorities = normalised.executiveSummary.topFivePriorities;
  normalised.quickWins = normalised.executiveSummary.quickWins;
  normalised.estateLabels = normalised.executiveSummary.estateLabels;
  normalised.findingsByAuditLens = normalised.findingsByLens;
  normalised.rankedIssueLedger = normalised.issues.map((issue) => ({
    ...issue,
    auditLens: issue.lens,
    affectedPagesTemplatesFilesOrRoutes: issue.affected,
  }));
  normalised.templateComponentGeneratorAnnex = normalised.templateAnnex;
  normalised.codeMarkupContentRemediationAppendix = normalised.codeRemediationAppendix;
  normalised.finalVerdictAndImplementationOrder = normalised.implementationOrder;

  return normalised;
}

export async function runSeoAeoGeoAnalysis(payload) {
  const userPrompt = buildUserPrompt(payload);

  const raw = await resilientRequest("auditForensic", {
    sessionId: payload.sessionId,
    section: "seo-aeo-geo-forensic",
    max_tokens: Number(process.env.AUDIT_AI_MAX_TOKENS || 12000),
    temperature: Number(process.env.AUDIT_AI_TEMPERATURE || 0.2),
    timeoutMs: Number(process.env.AUDIT_AI_TIMEOUT_MS || 240000),
    maxRetries: Number(process.env.AUDIT_AI_MAX_RETRIES ?? 0),
    top_p: Number(process.env.AUDIT_AI_TOP_P || 0.95),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  const parsed = extractJson(raw);
  return validateAndNormaliseAnalysisShape(parsed, payload);
}

export const __seoAeoGeoAnalysisTestHooks = {
  buildUserPrompt,
  extractJson,
  validateAndNormaliseAnalysisShape,
};

export default { runSeoAeoGeoAnalysis };