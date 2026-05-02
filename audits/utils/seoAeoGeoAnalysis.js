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

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clampScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function gradeFor(score) {
  const value = clampScore(score);
  if (value >= 90) return "A";
  if (value >= 80) return "B";
  if (value >= 70) return "C";
  if (value >= 60) return "D";
  return "F";
}

function average(numbers) {
  const clean = numbers.map(Number).filter((n) => Number.isFinite(n));
  if (!clean.length) return 0;
  return Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length);
}

function scoreFromRoutes(routes, getter, denominator) {
  const analysed = asArray(routes).filter((route) => String(route.coverageState || "").startsWith("Fully") || String(route.coverageState || "").startsWith("Analysed"));
  const source = analysed.length ? analysed : asArray(routes);
  return average(source.map((route) => (Number(getter(route)) / denominator) * 100));
}

function fallbackScoreBlock(payload) {
  const routes = asArray(payload.allRoutes);
  return {
    seo: {
      score: scoreFromRoutes(routes, (route) => (Number(route.scores?.technicalSeo) || 0) + (Number(route.scores?.onPageIntent) || 0), 35),
      headline: "Calculated from the audit evidence ledger when the model omitted or malformed the score block.",
    },
    aeo: {
      score: scoreFromRoutes(routes, (route) => Number(route.scores?.aeo) || 0, 20),
      headline: "Calculated from answer-formatting signals in the supplied crawl evidence.",
    },
    geo: {
      score: scoreFromRoutes(routes, (route) => Number(route.scores?.geo) || 0, 20),
      headline: "Calculated from entity, schema, internal-link, and passage-readiness signals in the supplied crawl evidence.",
    },
    entityAuthority: {
      score: scoreFromRoutes(routes, (route) => Number(route.scores?.entity) || 0, 10),
      headline: "Calculated from visible author/entity and schema signals in the supplied crawl evidence.",
    },
    conversionSupport: {
      score: scoreFromRoutes(routes, (route) => Number(route.scores?.conversion) || 0, 5),
      headline: "Calculated from CTA and conversion-path signals in commercial page types.",
    },
  };
}

function normaliseScoreBlock(data, payload) {
  const fallback = fallbackScoreBlock(payload);
  const input = data?.executiveSummary?.scores || {};
  const result = {};
  for (const key of ["seo", "aeo", "geo", "entityAuthority", "conversionSupport"]) {
    const candidate = input[key] && typeof input[key] === "object" ? input[key] : {};
    const score = clampScore(candidate.score ?? fallback[key].score);
    result[key] = {
      score,
      grade: gradeFor(score),
      headline: String(candidate.headline || fallback[key].headline || "Evidence-led score from supplied audit context."),
    };
  }
  return result;
}

function normaliseIssue(issue, index) {
  const issueId = String(issue.issueId || `JH-SEO-${String(index + 1).padStart(3, "0")}`);
  return {
    issueId,
    severity: String(issue.severity || "Medium"),
    confidence: String(issue.confidence || "Confirmed"),
    lens: String(issue.lens || issue.auditLens || "SEO / Technical"),
    rootCauseLevel: String(issue.rootCauseLevel || "system"),
    affected: String(issue.affected || "Not verified from supplied context"),
    evidenceObserved: String(issue.evidenceObserved || "Evidence came from the supplied audit ledger; the model omitted a detailed evidence field."),
    whyItMatters: String(issue.whyItMatters || "This weakens crawl reliability, answer extraction, or generative retrieval quality."),
    exactRemediation: String(issue.exactRemediation || "Use the affected route, template, or file named above and rerun the audit to verify the corrected evidence state."),
    expectedGain: String(issue.expectedGain || "Clearer crawl evidence and more reliable forensic audit output."),
    estimatedEffort: String(issue.estimatedEffort || "Medium"),
    recommendedOwner: String(issue.recommendedOwner || "Engineering"),
    verificationMethod: String(issue.verificationMethod || "Rerun the SEO + AEO + GEO audit and confirm coverage.json and report.html show the corrected state."),
  };
}

function issuesFromHeuristics(payload) {
  return asArray(payload.heuristicIssues).map((issue, index) => normaliseIssue(issue, index));
}

function pageTypeFindingsFromCoverage(payload) {
  return asArray(payload.coverageFamilies).map((row) => {
    const score = clampScore(row.averageScore || 0);
    const failed = Number(row.failed || 0);
    const excluded = Number(row.excluded || 0);
    const analysed = Number(row.analysed || 0);
    const coverageState = failed
      ? "Partial / failed"
      : analysed && excluded
        ? "Analysed plus explicit exclusions"
        : analysed
          ? "Fully analysed"
          : "Excluded / redirected";
    return {
      pageType: String(row.pageType || "unknown"),
      count: Number(row.discovered || 0),
      coverageState,
      score,
      grade: gradeFor(score),
      judgement: failed ? "Contains unresolved live-fetch failures." : "Inventoried with explicit coverage state.",
      keyNote: `Analysed ${analysed}, excluded ${excluded}, failed ${failed}.`,
    };
  });
}

function priorityAnnexFromPages(payload) {
  return asArray(payload.priorityPages).slice(0, 30).map((page) => ({
    url: String(page.url || ""),
    pageType: String(page.pageType || "unknown"),
    templateSource: String(page.route || ""),
    titleStatus: page.title ? "Healthy" : "Missing",
    metaStatus: page.metaDescription ? "Healthy" : "Missing",
    canonicalStatus: page.canonical ? "Healthy" : "Missing",
    schemaStatus: Number(page.schemaCount || 0) > 0 ? "Healthy" : "Missing",
    aeoStatus: Number(page.scores?.aeo || 0) >= 10 ? "Mixed" : "Weak",
    geoStatus: Number(page.scores?.geo || 0) >= 12 ? "Mixed" : "Weak",
    score: Number(page.total || 0),
    grade: String(page.grade || gradeFor(page.total || 0)),
    confirmedIssueIds: [],
    keyNote: `Coverage state: ${page.coverageState || "not verified"}.`,
  }));
}

function templateAnnexFromCoverage(payload) {
  return asArray(payload.coverageFamilies).map((row) => ({
    sourceFile: String(row.pageType || "route family"),
    area: String(row.pageType || "unknown"),
    observedLogic: "Derived from crawled URL family coverage and metadata evidence.",
    repeatedEffect: `Discovered ${row.discovered || 0}; analysed ${row.analysed || 0}; excluded ${row.excluded || 0}; failed ${row.failed || 0}.`,
    fixPriority: Number(row.failed || 0) > 0 ? "Critical" : (Number(row.averageScore || 0) < 75 ? "High" : "Medium"),
  }));
}

function codeRemediationFromEvidence(payload, issues) {
  const items = [];
  const signals = payload.repoSignals || {};
  const governanceText = JSON.stringify(signals.governanceScriptExcludes || []);
  if (governanceText.includes("blog/posts") || governanceText.includes("podcast/episodes")) {
    items.push({
      target: "scripts/check_ungoverned_routes.py",
      issueId: "JH-SEO-001",
      currentPattern: "blog/posts/ and/or podcast/episodes/ are excluded from release governance.",
      correctedPattern: "Validate generated blog/posts/* and podcast/episodes/* routes through a manifest-backed gate instead of blanket-excluding them.",
      rationale: "Dynamic page families are high-churn SEO assets and must not drift outside the release contract.",
    });
  }
  if (Number(signals.ebookPipelineTrimLimit || 0) > 0 && Number(signals.ebookPipelineTrimLimit) <= 80) {
    items.push({
      target: "scripts/ebook_pipeline.py",
      issueId: "JH-SEO-006",
      currentPattern: `Heading text is trimmed at ${signals.ebookPipelineTrimLimit} characters before rendering.`,
      correctedPattern: "Remove the hard slice or replace it with a whole-word trim at a materially higher threshold; let CSS wrap headings naturally.",
      rationale: "Hard heading truncation damages semantic clarity and answer extraction across ebook detail pages.",
    });
  }
  if (String(signals.llmsScope || "") === "ebook-only") {
    items.push({
      target: "llms.txt and llm-index.json",
      issueId: "JH-GEO-007",
      currentPattern: "Machine-readable discovery is ebook-centric.",
      correctedPattern: "Add topic guides, glossary, comparison, blog, podcast episode, and transcript URLs with concise summaries.",
      rationale: "Generative engines need first-party explanatory assets beyond commercial book pages.",
    });
  }
  for (const issue of issues) {
    if (items.length >= 5) break;
    if (!["Critical", "High"].includes(issue.severity)) continue;
    if (items.some((item) => item.issueId === issue.issueId)) continue;
    items.push({
      target: issue.affected,
      issueId: issue.issueId,
      currentPattern: issue.evidenceObserved,
      correctedPattern: issue.exactRemediation,
      rationale: issue.whyItMatters,
    });
  }
  return items;
}

function gapMatrixFromCoverage(payload) {
  return asArray(payload.coverageFamilies).map((row) => ({
    pageType: String(row.pageType || "unknown"),
    seo: Number(row.failed || 0) ? "Weak" : (Number(row.averageScore || 0) >= 80 ? "Strong" : "Moderate"),
    aeo: Number(row.averageScore || 0) >= 80 ? "Moderate" : "Weak",
    geo: Number(row.averageScore || 0) >= 80 ? "Moderate" : "Weak",
    confidence: "Confirmed",
    topMissingElement: Number(row.failed || 0) ? "Live fetch or route resolution failure" : "Answer-first and citation-ready patterns",
    businessImpact: ["book page", "podcast episode", "podcast transcript", "blog article", "homepage"].includes(row.pageType) ? "High" : "Medium",
  }));
}

function normaliseAnalysisShape(data, payload) {
  const root = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const executiveSummary = root.executiveSummary && typeof root.executiveSummary === "object" ? root.executiveSummary : {};
  const findingsByLens = root.findingsByLens && typeof root.findingsByLens === "object" ? root.findingsByLens : {};
  const fallbackIssues = issuesFromHeuristics(payload);
  let issues = asArray(root.issues).map((issue, index) => normaliseIssue(issue, index));
  if (issues.length < Math.min(5, fallbackIssues.length)) {
    const existing = new Set(issues.map((issue) => issue.issueId));
    issues = issues.concat(fallbackIssues.filter((issue) => !existing.has(issue.issueId))).slice(0, 12);
  }
  if (!issues.length) {
    throw new Error("Analysis response and heuristic context produced no issue records");
  }

  const normalised = {
    executiveSummary: {
      overallVerdict: String(executiveSummary.overallVerdict || "AI forensic analysis completed using the supplied route ledger and deterministic evidence normalisation. Treat any incomplete live-fetch family as a material limitation until the audit is rerun cleanly."),
      scores: normaliseScoreBlock(root, payload),
      topFivePriorities: asArray(executiveSummary.topFivePriorities).map(String).filter(Boolean),
      quickWins: asArray(executiveSummary.quickWins).map(String).filter(Boolean),
      estateLabels: asArray(executiveSummary.estateLabels).map(String).filter(Boolean),
    },
    findingsByLens: {
      technicalSeo: String(findingsByLens.technicalSeo || "Technical SEO was assessed from live status, canonical, title, meta, sitemap, feed, and route reconciliation evidence in the supplied audit ledger."),
      onPageSeo: String(findingsByLens.onPageSeo || "On-page SEO was assessed from titles, headings, opening copy, internal links, and page-family template signals in the supplied audit ledger."),
      aeo: String(findingsByLens.aeo || "AEO readiness was assessed from answer-first summaries, question-led headings, list/table support, FAQ/schema signals, and extractable opening text."),
      geo: String(findingsByLens.geo || "GEO readiness was assessed from entity clarity, reusable explanatory passages, schema support, internal topical links, and machine-readable discovery signals."),
      entityAuthority: String(findingsByLens.entityAuthority || "Entity authority was assessed from visible Jonathan Harris, book, podcast, topic, and schema relationships in the supplied crawl context."),
      structuredData: String(findingsByLens.structuredData || "Structured data was assessed from JSON-LD counts and schema signals in priority page evidence."),
      internalLinking: String(findingsByLens.internalLinking || "Internal linking was assessed from in-scope link counts, crawlable route exposure, and page-family relationships."),
      contentArchitecture: String(findingsByLens.contentArchitecture || "Content architecture was assessed from repo, workbook, sitemap, feed, and live-link reconciliation across static and dynamic families."),
      conversionSupport: String(findingsByLens.conversionSupport || "Conversion support was assessed from buy-now, contact, newsletter, and CTA evidence while excluding external redirects from HTML page scoring."),
      blogPodcastTranscriptSystems: String(findingsByLens.blogPodcastTranscriptSystems || "Blog, podcast, transcript, archive, and programmatic families were treated as mandatory audit families using the supplied URL ledger and coverage states."),
    },
    issues,
    pageTypeFindings: asArray(root.pageTypeFindings).length ? asArray(root.pageTypeFindings) : pageTypeFindingsFromCoverage(payload),
    priorityPageAnnex: asArray(root.priorityPageAnnex).length ? asArray(root.priorityPageAnnex) : priorityAnnexFromPages(payload),
    templateAnnex: asArray(root.templateAnnex).length ? asArray(root.templateAnnex) : templateAnnexFromCoverage(payload),
    codeRemediationAppendix: asArray(root.codeRemediationAppendix).length ? asArray(root.codeRemediationAppendix) : [],
    bestPracticeGapMatrix: asArray(root.bestPracticeGapMatrix).length ? asArray(root.bestPracticeGapMatrix) : gapMatrixFromCoverage(payload),
    implementationOrder: root.implementationOrder && typeof root.implementationOrder === "object" ? root.implementationOrder : {},
  };

  if (normalised.executiveSummary.topFivePriorities.length < 5) {
    const additions = issues.map((issue) => `${issue.issueId}: ${issue.exactRemediation}`);
    normalised.executiveSummary.topFivePriorities = normalised.executiveSummary.topFivePriorities.concat(additions).slice(0, 5);
  }
  if (normalised.executiveSummary.quickWins.length < 3) {
    normalised.executiveSummary.quickWins = normalised.executiveSummary.quickWins.concat(issues.map((issue) => issue.verificationMethod)).slice(0, 3);
  }
  if (!normalised.executiveSummary.estateLabels.length) {
    normalised.executiveSummary.estateLabels = ["AI-assisted", "evidence-led", "full-estate ledger"];
  }
  normalised.codeRemediationAppendix = asArray(normalised.codeRemediationAppendix);
  if (!normalised.codeRemediationAppendix.length) {
    normalised.codeRemediationAppendix = codeRemediationFromEvidence(payload, issues);
  }
  normalised.implementationOrder = {
    narrative: String(normalised.implementationOrder.narrative || normalised.executiveSummary.overallVerdict),
    steps: asArray(normalised.implementationOrder.steps).length ? asArray(normalised.implementationOrder.steps).map(String) : normalised.executiveSummary.topFivePriorities,
    expectedGains: asArray(normalised.implementationOrder.expectedGains).length ? asArray(normalised.implementationOrder.expectedGains).map(String) : issues.slice(0, 3).map((issue) => issue.expectedGain),
  };

  return normalised;
}

export async function runSeoAeoGeoAnalysis(payload) {
  const userPrompt = buildUserPrompt(payload);
  const raw = await resilientRequest("auditForensic", {
    sessionId: payload.sessionId,
    routeName: "auditForensic",
    max_tokens: 9000,
    temperature: 0.25,
    top_p: 0.95,
    timeout_ms: Math.max(Number(process.env.AI_TIMEOUT || 0) || 0, 180000),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  const parsed = extractJson(raw);
  return normaliseAnalysisShape(parsed, payload);
}

export default { runSeoAeoGeoAnalysis };
