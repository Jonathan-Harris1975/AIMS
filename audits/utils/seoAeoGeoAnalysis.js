const REQUIRED_TOP_LEVEL_KEYS = [
  "auditCompletionState",
  "aiAnalysisStatus",
  "executiveSummary",
  "overallVerdict",
  "scoreTable",
  "topFivePriorities",
  "quickWins",
  "majorRisks",
  "estateLabels",
  "scopeInputsMethod",
  "inventoryReconciliationSummary",
  "findingsByAuditLens",
  "rankedIssueLedger",
  "pageTypeFindings",
  "priorityPageAnnex",
  "templateComponentGeneratorAnnex",
  "codeMarkupContentRemediationAppendix",
  "bestPracticeGapMatrix",
  "finalVerdictAndImplementationOrder",
  "fullUrlCoverageAppendix",
  "limitations",
  "verificationItems",
];

const REQUIRED_ISSUE_KEYS = [
  "issueId",
  "severity",
  "confidence",
  "auditLens",
  "rootCauseLevel",
  "affectedPagesTemplatesFilesOrRoutes",
  "evidenceObserved",
  "whyItMatters",
  "exactRemediation",
  "expectedGain",
  "estimatedEffort",
  "recommendedOwner",
  "verificationMethod",
];

const REPORT_STRUCTURE = [
  "Cover Page",
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
  "Full URL Coverage Appendix",
];

const SYSTEM_PROMPT = `You are a senior forensic SEO + AEO + GEO audit engineer operating under the Full-Estate Forensic SEO + AEO + GEO Audit System, version v2026.04-FULL-COVERAGE.

You will receive a structured evidence payload collected from repository routes, workbook data, sitemap snapshots, feed manifests, live route checks, URL coverage ledgers, page-family reconciliation, and heuristic baseline checks for the jonathan-harris.online estate.

Your task is to return one strict forensic JSON object, not a written report, not markdown, and not a generic SEO audit. The HTML/PDF report builder will render your JSON.

NON-NEGOTIABLE OPERATING RULES:
1. Use supplied evidence only. Do not invent URLs, file paths, metrics, scores, crawl results, schemas, selectors, or live behaviour.
2. No boilerplate, no filler, no vague "improve metadata" style advice.
3. Every significant issue must name the exact URL, file path, route family, template, generator, canonical target, schema type, selector, or content block supported by the evidence payload.
4. Blog, podcast, transcript, archive, utility, and programmatic families are mandatory estate families when present in the payload. Do not silently sample or skim them.
5. If coverage is partial, failed, or not available, state the limitation explicitly and include it in limitations and fullUrlCoverageAppendix.
6. If repo, workbook, sitemap, feed, and live evidence disagree, state the conflict and mark confidence as Confirmed, Probable, or Needs verification.
7. Treat broken URLs, redirects, and failed fetches as audit findings. Do not call the audit incomplete merely because the estate has broken routes.
8. Return final scores only when the forensic JSON is evidence-led. If data is unavailable, write "Not verified from supplied context" rather than fabricating measurements.
9. Scores must be whole-number 0-100 values with grades A=90-100, B=80-89, C=70-79, D=60-69, F<60.
10. Every Critical and High issue must include exact remediation and a verification method.
11. Reject duplicated generic ledgers. Aggregate repeated template-level defects intelligently while preserving URL-level evidence in appendices.
12. The final JSON must support this report structure: ${REPORT_STRUCTURE.join("; ")}.
13. Return one JSON object only. No code fences. No commentary.

MANDATORY TOP-LEVEL JSON KEYS:
${REQUIRED_TOP_LEVEL_KEYS.join(", ")}

MANDATORY ISSUE KEYS FOR EVERY rankedIssueLedger ITEM:
${REQUIRED_ISSUE_KEYS.join(", ")}`;

function trimLargeArray(items, maxItems = 500) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, maxItems);
}

function safeJson(value, fallback = {}) {
  try {
    return JSON.parse(JSON.stringify(value ?? fallback));
  } catch {
    return fallback;
  }
}

function buildUserPrompt(payload) {
  const compact = {
    website: payload?.baseUrl,
    sessionId: payload?.sessionId,
    generatedAt: payload?.generatedAt,
    inventory: payload?.inventory,
    priorityPages: trimLargeArray(payload?.priorityPages, 60),
    allRoutes: trimLargeArray(payload?.allRoutes, 1200),
    heuristicIssues: trimLargeArray(payload?.heuristicIssues, 160),
    repoSignals: payload?.repoSignals,
    liveDynamicUrls: trimLargeArray(payload?.liveDynamicUrls, 600),
    coverage: trimLargeArray(payload?.coverage, 1500),
    coverageFamilies: trimLargeArray(payload?.coverageFamilies, 80),
    workflowRequirements: {
      dynamicFamiliesMandatory: ["blog", "podcast", "transcript", "archive", "utility", "programmatic"],
      reportStructure: REPORT_STRUCTURE,
      rejectGenericAdvice: true,
      rejectSilentSampling: true,
      issueFormat: REQUIRED_ISSUE_KEYS,
      requiredTopLevelKeys: REQUIRED_TOP_LEVEL_KEYS,
    },
  };

  return [
    "FORENSIC SEO + AEO + GEO AUDIT - FULL ESTATE EVIDENCE PACKAGE",
    `Website: ${payload?.baseUrl || "Not supplied"}`,
    `Session: ${payload?.sessionId || "Not supplied"}`,
    `Generated: ${payload?.generatedAt || new Date().toISOString()}`,
    "",
    "Use the evidence payload only. Do not invent evidence. If the payload is thin for a family, record that limitation.",
    "The allRoutes and coverage arrays are the URL ledger for this run unless a payload field explicitly says otherwise.",
    "Return one JSON object only, following the mandatory contract.",
    "",
    JSON.stringify(compact, null, 2),
  ].join("\n");
}

function buildRepairPrompt({ payload, validationErrors, draft }) {
  return [
    "Your previous forensic audit response failed strict JSON validation.",
    "Repair the JSON only. Do not add markdown, commentary, or new evidence.",
    "Preserve evidence-grounded findings, but fix the contract defects listed below.",
    "",
    "VALIDATION ERRORS:",
    JSON.stringify(validationErrors, null, 2),
    "",
    "MANDATORY TOP-LEVEL KEYS:",
    JSON.stringify(REQUIRED_TOP_LEVEL_KEYS, null, 2),
    "",
    "MANDATORY ISSUE KEYS:",
    JSON.stringify(REQUIRED_ISSUE_KEYS, null, 2),
    "",
    "EVIDENCE PAYLOAD SUMMARY:",
    JSON.stringify({
      baseUrl: payload?.baseUrl,
      sessionId: payload?.sessionId,
      inventory: payload?.inventory,
      routeCount: Array.isArray(payload?.allRoutes) ? payload.allRoutes.length : 0,
      coverageFamilyCount: Array.isArray(payload?.coverageFamilies) ? payload.coverageFamilies.length : 0,
      heuristicIssueCount: Array.isArray(payload?.heuristicIssues) ? payload.heuristicIssues.length : 0,
    }, null, 2),
    "",
    "DRAFT TO REPAIR:",
    JSON.stringify(safeJson(draft), null, 2).slice(0, 60000),
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

function compactString(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function text(value, fallback = "Not verified from supplied context") {
  return compactString(value) || fallback;
}

function clampScore(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.max(0, Math.min(100, Math.round(fallback)));
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
    return state === "Fully analysed" || state === "Analysed through shared template plus page-specific checks";
  });

  const scoped = routes.length ? routes : asArray(payload?.allRoutes);
  if (!scoped.length) return 0;

  const values = scoped.map(selector).filter((value) => Number.isFinite(value));
  if (!values.length) return 0;

  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length / denominator) * 100);
}

function fallbackScores(payload) {
  const routes = asArray(payload?.allRoutes).filter((route) => {
    const state = String(route.coverageState || "");
    return state === "Fully analysed" || state === "Analysed through shared template plus page-specific checks";
  });

  const conversionRoutes = routes.filter((route) => /book|ebook|contact|newsletter|conversion|lead|compare/i.test(String(route.pageType || route.url || "")));
  const conversionScore = conversionRoutes.length
    ? Math.round((conversionRoutes.reduce((sum, route) => sum + Number(route.scores?.conversion || 0), 0) / conversionRoutes.length / 5) * 100)
    : 0;

  return {
    seo: scoreFromRows(payload, (route) => Number(route.scores?.technicalSeo || 0) + Number(route.scores?.onPageIntent || 0), 35),
    aeo: scoreFromRows(payload, (route) => Number(route.scores?.aeo || 0), 20),
    geo: scoreFromRows(payload, (route) => Number(route.scores?.geo || 0), 20),
    entityAuthority: scoreFromRows(payload, (route) => Number(route.scores?.entity || 0), 10),
    conversionSupport: conversionScore,
  };
}

function normaliseScoreBlock(block, key, fallback) {
  const source = isPlainObject(block) ? block : {};
  let score = Number(source.score ?? source.value ?? source.total);
  const suppliedGrade = String(source.grade || "").trim().toUpperCase().slice(0, 1);

  if (!Number.isFinite(score)) score = fallback;
  if (score <= 20 && score > 0 && ["seo", "aeo", "geo"].includes(key)) score *= 5;
  if (score <= 20 && suppliedGrade && suppliedGrade !== expectedGrade(score)) {
    score = gradeRepresentativeScore(suppliedGrade) ?? score;
  }

  const finalScore = clampScore(score, fallback);

  return {
    score: finalScore,
    grade: expectedGrade(finalScore),
    headline: text(source.headline || source.headlineJudgement, `${key} score normalised from the supplied forensic JSON.`),
  };
}

function normaliseScoreTable(data, payload) {
  const fallback = fallbackScores(payload);
  const sourceSummary = isPlainObject(data?.executiveSummary) ? data.executiveSummary : {};
  const sourceScores = isPlainObject(sourceSummary.scores) ? sourceSummary.scores : {};
  const table = isPlainObject(data?.scoreTable) ? data.scoreTable : {};

  const get = (key, aliases = []) => {
    for (const candidate of [key, ...aliases]) {
      if (isPlainObject(table[candidate])) return table[candidate];
      if (isPlainObject(sourceScores[candidate])) return sourceScores[candidate];
    }
    return {};
  };

  return {
    seo: normaliseScoreBlock(get("seo", ["SEO"]), "seo", fallback.seo),
    aeo: normaliseScoreBlock(get("aeo", ["AEO"]), "aeo", fallback.aeo),
    geo: normaliseScoreBlock(get("geo", ["GEO"]), "geo", fallback.geo),
    entityAuthority: normaliseScoreBlock(get("entityAuthority", ["entity", "Entity authority"]), "entityAuthority", fallback.entityAuthority),
    conversionSupport: normaliseScoreBlock(get("conversionSupport", ["conversion", "Conversion support"]), "conversionSupport", fallback.conversionSupport),
  };
}

function coverageRows(payload) {
  return asArray(payload?.coverageFamilies).length ? asArray(payload.coverageFamilies) : asArray(payload?.coverage);
}

function coverageStateFromRow(row) {
  if (Number(row.failed || 0) > 0) return "Partial / failed";
  if (Number(row.excluded || 0) > 0 && Number(row.analysed || 0) === 0) return "Excluded / redirected";
  if (Number(row.excluded || 0) > 0) return "Analysed plus explicit exclusions";
  return Number(row.coveragePercent || 0) >= 100 ? "Fully analysed" : "Partial / failed";
}

function statusLabelFromScore(score, good = 80, mixed = 60) {
  if (score >= good) return "Healthy";
  if (score >= mixed) return "Mixed";
  return "Weak";
}

function normaliseFindings(findings) {
  const source = isPlainObject(findings) ? findings : {};
  const fallbacks = {
    technicalSeo: "Technical SEO was assessed from status codes, canonicals, metadata, redirects, indexability, and route coverage evidence.",
    onPageSeo: "On-page SEO and intent match were assessed from titles, headings, opening copy, content depth, and route intent alignment.",
    aeo: "AEO readiness was assessed from answer-first summaries, question-led headings, lists, tables, FAQs, and extractable passages.",
    geo: "GEO readiness was assessed from entity clarity, citation-ready passages, schema support, and machine-readable discovery evidence.",
    entityAuthority: "Entity authority was assessed from author, book, podcast, topic, and organisation signals in the supplied ledger.",
    structuredData: "Structured data was assessed from JSON-LD presence, schema count, and visible-content alignment where supplied.",
    internalLinking: "Internal linking was assessed from crawlable internal links, hub relationships, and commercial/topic bridging.",
    contentArchitecture: "Content architecture was assessed from route-family coverage, dynamic governance, manifests, feeds, and sitemap reconciliation.",
    conversionSupport: "Conversion support was assessed from newsletter, contact, book, buy-now, and commercial CTA evidence.",
    blogPodcastTranscriptSystems: "Blog, podcast, transcript, archive, and programmatic families were treated as mandatory estate families and reconciled against coverage evidence.",
  };

  return Object.fromEntries(Object.entries(fallbacks).map(([key, fallback]) => [key, text(source[key] || source[key.replace(/[A-Z]/g, (match) => ` ${match.toLowerCase()}`)], fallback)]));
}

function normalisePageTypeFindings(data, payload) {
  const rows = asArray(data?.pageTypeFindings).filter((row) => isPlainObject(row) && (row.pageType || row.family));
  if (rows.length) {
    return rows.map((row) => {
      const score = clampScore(row.score ?? row.averageScore, 0);
      return {
        pageType: text(row.pageType || row.family, "Unknown page type"),
        count: Number(row.count ?? row.discovered ?? 0),
        coverageState: text(row.coverageState, "Not verified from supplied context"),
        score,
        grade: expectedGrade(score),
        judgement: text(row.judgement || row.verdict, "Judgement derived from supplied AI analysis and coverage ledger."),
        keyNote: text(row.keyNote || row.keyFinding, "See coverage ledger for URL-level evidence."),
      };
    });
  }

  return coverageRows(payload).map((row) => {
    const score = clampScore(row.averageScore, 0);
    return {
      pageType: text(row.pageType || row.family, "Unknown page type"),
      count: Number(row.discovered || 0),
      coverageState: coverageStateFromRow(row),
      score,
      grade: expectedGrade(score),
      judgement: Number(row.failed || 0) > 0 ? "Coverage defects remain in this family." : "Family inventoried with explicit URL-level coverage states.",
      keyNote: `Analysed ${Number(row.analysed || 0)}, excluded ${Number(row.excluded || 0)}, failed ${Number(row.failed || 0)}.`,
    };
  });
}

function normalisePriorityPageAnnex(data, payload) {
  const rows = asArray(data?.priorityPageAnnex).filter((row) => isPlainObject(row) && (row.url || row.filePath));
  if (rows.length) {
    return rows.map((row) => {
      const score = clampScore(row.score ?? row.total, 0);
      return {
        url: text(row.url || row.filePath, ""),
        pageType: text(row.pageType, "Unknown page type"),
        templateSource: text(row.templateSource || row.templateOrigin, "Derived from supplied route family."),
        titleStatus: text(row.titleStatus, "Not verified"),
        metaStatus: text(row.metaStatus, "Not verified"),
        canonicalStatus: text(row.canonicalStatus, "Not verified"),
        headingsStatus: text(row.headingsStatus, "Not verified"),
        schemaStatus: text(row.schemaStatus, "Not verified"),
        entityStatus: text(row.entityStatus, "Not verified"),
        aeoStatus: text(row.aeoStatus, "Not verified"),
        geoStatus: text(row.geoStatus, "Not verified"),
        internalLinkStatus: text(row.internalLinkStatus, "Not verified"),
        conversionStatus: text(row.conversionStatus, "Not verified"),
        score,
        grade: expectedGrade(score),
        confirmedIssueIds: asArray(row.confirmedIssueIds || row.issues).map(String),
        exactFixes: asArray(row.exactFixes).map(String),
        keyNote: text(row.keyNote || row.verdict, "See URL coverage appendix for evidence."),
      };
    });
  }

  return asArray(payload?.priorityPages).slice(0, 60).map((page) => {
    const score = clampScore(page.total, 0);
    const aeoScore = Number(page.scores?.aeo || 0);
    const geoScore = Number(page.scores?.geo || 0);
    return {
      url: text(page.url, ""),
      pageType: text(page.pageType, "Unknown page type"),
      templateSource: text(page.route || page.filePath, "Supplied priority route"),
      titleStatus: page.title ? "Healthy" : "Missing",
      metaStatus: page.metaDescription ? "Healthy" : "Missing",
      canonicalStatus: page.canonical ? "Healthy" : "Missing",
      headingsStatus: page.h1 ? "Healthy" : "Missing",
      schemaStatus: Number(page.schemaCount || 0) > 0 ? "Healthy" : "Missing",
      entityStatus: statusLabelFromScore((Number(page.scores?.entity || 0) / 10) * 100),
      aeoStatus: statusLabelFromScore((aeoScore / 20) * 100),
      geoStatus: statusLabelFromScore((geoScore / 20) * 100),
      internalLinkStatus: statusLabelFromScore((Number(page.scores?.internalLinking || 0) / 10) * 100),
      conversionStatus: statusLabelFromScore((Number(page.scores?.conversion || 0) / 5) * 100),
      score,
      grade: expectedGrade(score),
      confirmedIssueIds: [],
      exactFixes: [],
      keyNote: text(page.coverageState, "Priority route included from crawl ledger."),
    };
  });
}

function normaliseTemplateAnnex(data, payload) {
  const rows = asArray(data?.templateComponentGeneratorAnnex || data?.templateAnnex).filter((row) => isPlainObject(row) && (row.sourceFile || row.area || row.pageFamily));
  if (rows.length) {
    return rows.map((row) => ({
      sourceFile: text(row.sourceFile || row.target || row.area, "Unknown source file"),
      area: text(row.area || row.pageFamily, "Route family"),
      observedLogic: text(row.observedLogic || row.metadataLogic || row.schemaLogic, "Observed from supplied route/template evidence."),
      repeatedEffect: text(row.repeatedEffect || row.repeatedDefects || row.generativeSearchGaps, "Repeated family effect recorded in coverage ledger."),
      fixPriority: text(row.fixPriority, "Medium"),
      pagesAffected: asArray(row.pagesAffected).map(String),
      sampleCorrectedBlock: text(row.sampleCorrectedBlock, "Not supplied by AI forensic analysis"),
    }));
  }

  return coverageRows(payload).map((row) => ({
    sourceFile: text(row.sourceFile || row.pageType, "Route family"),
    area: text(row.pageType || row.family, "Route family"),
    observedLogic: `Family coverage: discovered ${Number(row.discovered || 0)}, analysed ${Number(row.analysed || 0)}, excluded ${Number(row.excluded || 0)}, failed ${Number(row.failed || 0)}.`,
    repeatedEffect: Number(row.failed || 0) > 0 ? "Unresolved fetch failures affect audit completeness." : "No missing coverage state detected in this family.",
    fixPriority: Number(row.failed || 0) > 0 || Number(row.averageScore || 0) < 70 ? "High" : "Medium",
    pagesAffected: [],
    sampleCorrectedBlock: "Not generated from baseline coverage rows.",
  }));
}

function normaliseGapMatrix(data, payload) {
  const rows = asArray(data?.bestPracticeGapMatrix).filter((row) => isPlainObject(row) && (row.pageType || row.family));
  if (rows.length) {
    return rows.map((row) => ({
      pageType: text(row.pageType || row.family, "Unknown page type"),
      seo: text(row.seo || row.seoCompliance, "Not verified"),
      aeo: text(row.aeo || row.aeoCompliance, "Not verified"),
      geo: text(row.geo || row.geoCompliance, "Not verified"),
      confidence: text(row.confidence, "Needs verification"),
      topMissingElement: text(row.topMissingElement || row.topMissing, "See issue ledger"),
      businessImpact: text(row.businessImpact, "Medium"),
    }));
  }

  return coverageRows(payload).map((row) => ({
    pageType: text(row.pageType || row.family, "Unknown page type"),
    seo: Number(row.averageScore || 0) >= 80 ? "Strong" : Number(row.averageScore || 0) >= 70 ? "Partial" : "Weak",
    aeo: Number(row.averageScore || 0) >= 80 ? "Partial" : "Weak",
    geo: Number(row.averageScore || 0) >= 80 ? "Partial" : "Weak",
    confidence: "Confirmed",
    topMissingElement: Number(row.failed || 0) > 0 ? "Fetch or redirect reliability" : "Answer-first evidence blocks",
    businessImpact: /book|podcast|transcript|blog|lead|conversion/i.test(String(row.pageType || "")) ? "High" : "Medium",
  }));
}

function normaliseFullCoverageAppendix(data, payload) {
  const source = asArray(data?.fullUrlCoverageAppendix).filter((row) => isPlainObject(row));
  if (source.length) return source;

  return asArray(payload?.allRoutes).map((route) => ({
    url: text(route.url || route.route, ""),
    pageType: text(route.pageType, "Unknown page type"),
    source: text(route.source || route.discoverySource, "Supplied audit route ledger"),
    status: route.statusCode ?? route.status ?? "Not tested",
    canonical: text(route.canonical, "Not verified"),
    indexability: text(route.indexability, "Not verified"),
    coverageState: text(route.coverageState, "Not verified"),
    score: clampScore(route.total, 0),
    risk: text(route.risk || route.riskFlag, "Not verified"),
    issueIds: asArray(route.issueIds).map(String),
  }));
}

function sourceIssuesFrom(data) {
  const direct = asArray(data?.rankedIssueLedger).length ? asArray(data.rankedIssueLedger) : asArray(data?.issues);
  return direct.filter(isPlainObject);
}

function normaliseIssues(data) {
  return sourceIssuesFrom(data).map((issue, index) => {
    const issueId = text(issue.issueId, `JH-SEO-${String(index + 1).padStart(3, "0")}`);
    return {
      issueId,
      severity: text(issue.severity, "Medium"),
      confidence: text(issue.confidence, "Confirmed"),
      auditLens: text(issue.auditLens || issue.lens, "SEO"),
      rootCauseLevel: text(issue.rootCauseLevel, "system"),
      affectedPagesTemplatesFilesOrRoutes: text(issue.affectedPagesTemplatesFilesOrRoutes || issue.affected, "Affected route family from supplied evidence"),
      evidenceObserved: text(issue.evidenceObserved, "Evidence observed in supplied crawl, repo, workbook, or coverage ledger."),
      whyItMatters: text(issue.whyItMatters, "This affects crawlability, answer extraction, retrieval, or conversion support."),
      exactRemediation: text(issue.exactRemediation, "Apply the exact template, route, or content fix described in the issue evidence."),
      expectedGain: text(issue.expectedGain, "Improved crawl reliability, answer extraction, and generative retrieval quality."),
      estimatedEffort: text(issue.estimatedEffort, "Medium"),
      recommendedOwner: text(issue.recommendedOwner, "Engineering"),
      verificationMethod: text(issue.verificationMethod || issue.verification, "Rerun the SEO + AEO + GEO audit and confirm corrected evidence in coverage.json and report.html."),
    };
  });
}

function normaliseRemediationAppendix(data, issues) {
  const rows = asArray(data?.codeMarkupContentRemediationAppendix || data?.codeRemediationAppendix).filter(isPlainObject);
  if (rows.length) {
    return rows.map((row) => ({
      target: text(row.target || row.filePath || row.sourceFile || row.route, "Affected source path or route family"),
      issueId: text(row.issueId, "Unmapped issue"),
      currentPattern: text(row.currentPattern || row.currentFaultyPattern || row.evidenceObserved, "See issue evidence."),
      correctedPattern: text(row.correctedPattern || row.replacementPattern || row.exactRemediation, "Apply the issue remediation exactly."),
      rationale: text(row.rationale || row.whyItMatters, "This change resolves the affected audit issue."),
    }));
  }

  return issues
    .filter((issue) => ["Critical", "High"].includes(issue.severity))
    .map((issue) => ({
      target: issue.affectedPagesTemplatesFilesOrRoutes,
      issueId: issue.issueId,
      currentPattern: issue.evidenceObserved,
      correctedPattern: issue.exactRemediation,
      rationale: issue.whyItMatters,
    }))
    .slice(0, 15);
}

function normaliseImplementation(data, issues) {
  const source = isPlainObject(data?.finalVerdictAndImplementationOrder) ? data.finalVerdictAndImplementationOrder : isPlainObject(data?.implementationOrder) ? data.implementationOrder : {};
  const steps = asArray(source.steps || source.implementationSequence).map(String).filter(Boolean);
  const gains = asArray(source.expectedGains).map(String).filter(Boolean);

  return {
    narrative: text(source.narrative || source.finalVerdict || data?.overallVerdict, "Implementation order derived from the ranked issue ledger."),
    steps: (steps.length ? steps : issues.slice(0, 8).map((issue) => `${issue.issueId}: ${issue.exactRemediation}`)).slice(0, 12),
    expectedGains: (gains.length ? gains : issues.slice(0, 5).map((issue) => issue.expectedGain)).slice(0, 8),
  };
}

function buildNormalisedPayload(data, payload) {
  const scoreTable = normaliseScoreTable(data, payload);
  const issues = normaliseIssues(data);
  const implementation = normaliseImplementation(data, issues);
  const executiveSummary = isPlainObject(data?.executiveSummary) ? data.executiveSummary : {};

  return {
    auditCompletionState: text(data?.auditCompletionState, "Complete"),
    aiAnalysisStatus: text(data?.aiAnalysisStatus, "valid"),
    executiveSummary: text(executiveSummary.summary || executiveSummary.overview || data?.executiveSummary, "Forensic audit synthesis completed from supplied evidence."),
    overallVerdict: text(data?.overallVerdict || executiveSummary.overallVerdict || implementation.narrative, "Forensic verdict supplied from the evidence-led analysis."),
    scoreTable,
    topFivePriorities: asArray(data?.topFivePriorities || executiveSummary.topFivePriorities).map(String).filter(Boolean).slice(0, 5),
    quickWins: asArray(data?.quickWins || executiveSummary.quickWins).map(String).filter(Boolean).slice(0, 6),
    majorRisks: asArray(data?.majorRisks || executiveSummary.majorRisks).map(String).filter(Boolean).slice(0, 8),
    estateLabels: asArray(data?.estateLabels || executiveSummary.estateLabels).map(String).filter(Boolean).slice(0, 10),
    scopeInputsMethod: isPlainObject(data?.scopeInputsMethod) ? data.scopeInputsMethod : { method: text(data?.scopeInputsMethod, "Evidence-led repo, workbook, sitemap, feed, route, and coverage reconciliation.") },
    inventoryReconciliationSummary: isPlainObject(data?.inventoryReconciliationSummary) ? data.inventoryReconciliationSummary : { summary: text(data?.inventoryReconciliationSummary, "Inventory reconciliation derived from supplied route and coverage ledgers.") },
    findingsByAuditLens: normaliseFindings(data?.findingsByAuditLens || data?.findingsByLens),
    rankedIssueLedger: issues,
    pageTypeFindings: normalisePageTypeFindings(data, payload),
    priorityPageAnnex: normalisePriorityPageAnnex(data, payload),
    templateComponentGeneratorAnnex: normaliseTemplateAnnex(data, payload),
    codeMarkupContentRemediationAppendix: [],
    bestPracticeGapMatrix: normaliseGapMatrix(data, payload),
    finalVerdictAndImplementationOrder: implementation,
    fullUrlCoverageAppendix: normaliseFullCoverageAppendix(data, payload),
    limitations: asArray(data?.limitations).map(String).filter(Boolean),
    verificationItems: asArray(data?.verificationItems).map(String).filter(Boolean),
  };
}

function isGenericAdvice(value) {
  const textValue = compactString(value).toLowerCase();
  if (!textValue) return true;
  const generic = [
    "improve metadata",
    "enhance structured data",
    "optimise content quality",
    "optimize content quality",
    "improve internal linking",
    "strengthen authority",
    "add schema",
    "improve seo",
  ];
  return generic.some((phrase) => textValue === phrase || textValue.startsWith(`${phrase}.`));
}

function validateNormalisedAnalysis(normalised, payload) {
  const errors = [];

  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!(key in normalised)) errors.push(`Missing top-level key: ${key}`);
  }

  if (!text(normalised.overallVerdict, "")) errors.push("Missing overallVerdict");
  if (!isPlainObject(normalised.scoreTable)) errors.push("Missing scoreTable object");

  for (const key of ["seo", "aeo", "geo", "entityAuthority", "conversionSupport"]) {
    const block = normalised.scoreTable?.[key];
    if (!isPlainObject(block)) errors.push(`Missing scoreTable.${key}`);
    if (!Number.isFinite(Number(block?.score))) errors.push(`Missing numeric scoreTable.${key}.score`);
    if (!compactString(block?.grade)) errors.push(`Missing scoreTable.${key}.grade`);
  }

  if (!asArray(normalised.rankedIssueLedger).length) errors.push("rankedIssueLedger must not be empty");
  if (!asArray(normalised.finalVerdictAndImplementationOrder?.steps).length) errors.push("Missing implementation sequence");

  const seenRemediation = new Set();
  normalised.rankedIssueLedger.forEach((issue, index) => {
    for (const key of REQUIRED_ISSUE_KEYS) {
      if (!compactString(issue?.[key])) errors.push(`Issue ${index + 1} missing ${key}`);
    }
    if (isGenericAdvice(issue?.exactRemediation)) {
      errors.push(`Issue ${issue?.issueId || index + 1} remediation is too generic`);
    }
    const remediationKey = compactString(issue?.exactRemediation).toLowerCase();
    if (remediationKey && seenRemediation.has(remediationKey)) {
      errors.push(`Repeated exact remediation detected: ${issue?.issueId || index + 1}`);
    }
    seenRemediation.add(remediationKey);
  });

  if (asArray(payload?.allRoutes).length && !asArray(normalised.fullUrlCoverageAppendix).length) {
    errors.push("fullUrlCoverageAppendix is required when route coverage evidence exists");
  }

  if (!asArray(normalised.pageTypeFindings).length) errors.push("Missing page-family/page-type coverage findings");
  if (!asArray(normalised.priorityPageAnnex).length && asArray(payload?.priorityPages).length) errors.push("Missing priorityPageAnnex");
  if (!asArray(normalised.templateComponentGeneratorAnnex).length) errors.push("Missing templateComponentGeneratorAnnex");

  return errors;
}

function addCompatibilityAliases(normalised) {
  const aliased = {
    ...normalised,
    executiveSummary: {
      overallVerdict: normalised.overallVerdict,
      scores: normalised.scoreTable,
      topFivePriorities: normalised.topFivePriorities,
      quickWins: normalised.quickWins,
      majorRisks: normalised.majorRisks,
      estateLabels: normalised.estateLabels,
      summary: normalised.executiveSummary,
    },
    findingsByLens: normalised.findingsByAuditLens,
    issues: normalised.rankedIssueLedger.map((issue) => ({
      ...issue,
      lens: issue.auditLens,
      affected: issue.affectedPagesTemplatesFilesOrRoutes,
    })),
    templateAnnex: normalised.templateComponentGeneratorAnnex,
    codeRemediationAppendix: normalised.codeMarkupContentRemediationAppendix,
    implementationOrder: normalised.finalVerdictAndImplementationOrder,
  };

  return aliased;
}

function validateAndNormaliseAnalysisShape(data, payload = {}) {
  if (!isPlainObject(data)) throw new Error("Analysis response is not a JSON object");

  const normalised = buildNormalisedPayload(data, payload);

  if (!normalised.topFivePriorities.length) {
    normalised.topFivePriorities = normalised.rankedIssueLedger.slice(0, 5).map((issue) => `${issue.issueId}: ${issue.exactRemediation}`);
  }
  if (!normalised.quickWins.length) {
    normalised.quickWins = normalised.rankedIssueLedger.filter((issue) => issue.estimatedEffort === "Low").slice(0, 3).map((issue) => `${issue.issueId}: ${issue.exactRemediation}`);
  }
  if (!normalised.quickWins.length) {
    normalised.quickWins = normalised.rankedIssueLedger.slice(0, 3).map((issue) => `${issue.issueId}: ${issue.verificationMethod}`);
  }
  if (!normalised.majorRisks.length) {
    normalised.majorRisks = normalised.rankedIssueLedger.filter((issue) => ["Critical", "High"].includes(issue.severity)).slice(0, 5).map((issue) => `${issue.issueId}: ${issue.whyItMatters}`);
  }
  if (!normalised.estateLabels.length) {
    normalised.estateLabels = ["AI-assisted", "full-estate coverage", "evidence-led"];
  }
  if (!normalised.limitations.length) {
    normalised.limitations = ["No limitation was separately supplied by the AI analysis beyond the coverage ledger."];
  }
  if (!normalised.verificationItems.length) {
    normalised.verificationItems = normalised.rankedIssueLedger.slice(0, 5).map((issue) => `${issue.issueId}: ${issue.verificationMethod}`);
  }

  normalised.codeMarkupContentRemediationAppendix = normaliseRemediationAppendix(data, normalised.rankedIssueLedger);

  const errors = validateNormalisedAnalysis(normalised, payload);
  if (errors.length) {
    const err = new Error(`Forensic JSON validation failed: ${errors.join("; ")}`);
    err.validationErrors = errors;
    throw err;
  }

  return addCompatibilityAliases(normalised);
}

const AUDIT_FORENSIC_MAX_TOKENS = Math.max(12000, Number(process.env.AI_MAX_TOKENS || 0));
const AUDIT_FORENSIC_TIMEOUT_MS = 120000;

async function callAuditForensic({ resilientRequest, payload, messages, section }) {
  return resilientRequest("auditForensic", {
    sessionId: payload?.sessionId,
    section,
    max_tokens: AUDIT_FORENSIC_MAX_TOKENS,
    temperature: 0.15,
    timeoutMs: AUDIT_FORENSIC_TIMEOUT_MS,
    maxRetries: 0,
    top_p: 0.95,
    messages,
  });
}

export async function runSeoAeoGeoAnalysis(payload) {
  const { resilientRequest, getProviderDiagnosticsForRoute } = await import("../../services/shared/utils/ai-service.js");
  const diagnostics = getProviderDiagnosticsForRoute("auditForensic");
  const configuredProviders = asArray(diagnostics.configuredProviders).filter((provider) => provider.configured);

  if (!configuredProviders.length) {
    const expected = asArray(diagnostics.configuredProviders)
      .map((provider) => `${provider.providerId}(${provider.modelEnv}+${provider.apiKeyEnv})`)
      .join(", ");
    throw new Error(`AI forensic analysis unavailable: no configured auditForensic providers. Expected one configured model/key pair from shared ai-config route: ${expected}`);
  }

  const userPrompt = buildUserPrompt(payload);
  const raw = await callAuditForensic({
    resilientRequest,
    payload,
    section: "seo-aeo-geo-forensic",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  let draft;
  try {
    draft = extractJson(raw);
    return validateAndNormaliseAnalysisShape(draft, payload);
  } catch (err) {
    const validationErrors = err?.validationErrors || [err instanceof Error ? err.message : String(err)];
    const repairPrompt = buildRepairPrompt({ payload, validationErrors, draft: draft || raw });
    const repairedRaw = await callAuditForensic({
      resilientRequest,
      payload,
      section: "seo-aeo-geo-forensic-repair",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: repairPrompt },
      ],
    });

    const repaired = extractJson(repairedRaw);
    return validateAndNormaliseAnalysisShape(repaired, payload);
  }
}

export const __seoAeoGeoAnalysisTestHooks = {
  buildUserPrompt,
  buildRepairPrompt,
  extractJson,
  buildNormalisedPayload,
  validateNormalisedAnalysis,
  validateAndNormaliseAnalysisShape,
};

export default { runSeoAeoGeoAnalysis };
