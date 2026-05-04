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
  "sourceLedger",
  "sourceMismatchesThatMatter",
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
  "Source Ledger",
  "Source Mismatches That Matter",
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
14. Keep the response compact: rankedIssueLedger <= 8 aggregated issues, pageTypeFindings <= 16 rows, priorityPageAnnex <= 12 rows, templateComponentGeneratorAnnex <= 12 rows, codeMarkupContentRemediationAppendix <= 12 rows, bestPracticeGapMatrix <= 16 rows.
15. Do not echo the complete URL ledger. Set fullUrlCoverageAppendix to [] unless a row adds unique judgement beyond the supplied allRoutes evidence; the local report builder will derive the full URL appendix deterministically.
16. Keep narrative strings under 90 words. Prefer exact files, routes, selectors, and affected families over long prose.
17. Do not repeat weak template advice across families. If several pages share the same shallow AEO/GEO symptom, turn it into one root-cause issue naming the exact template or generator.
18. Never use generic remediations such as "Add answer-first summaries, extractable subheadings, and direct response blocks". Replace them with page-family-specific fixes that name the observed current pattern and the exact missing blocks, schema types, link targets, files, or generator logic.
19. When evidence is present, prioritise system defects before copy polish: route governance exclusions, sitemap/workbook/repo/feed mismatches, duplicate canonicals or slugs, transcript discovery gaps, and llms.txt / llm-index coverage gaps.
20. Podcast episode findings must distinguish title/date/summary/audio/transcript-link wrappers from retrieval-ready episode pages. Transcript findings must distinguish raw transcript walls from chunked, summary-led transcript pages.

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
    sourceLedger: trimLargeArray(payload?.sourceLedger, 80),
    sourceMismatchesThatMatter: trimLargeArray(payload?.sourceMismatchesThatMatter || payload?.sourceConflicts, 120),
    familyDiagnostics: trimLargeArray(payload?.familyDiagnostics, 80),
    templateDiagnostics: trimLargeArray(payload?.templateDiagnostics, 80),
    dynamicRouteLedger: trimLargeArray(payload?.dynamicRouteLedger || payload?.liveDynamicUrls, 600),
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
    "Return one compact JSON object only, following the mandatory contract.",
    "Do not echo the complete route ledger; use [] for fullUrlCoverageAppendix unless a row adds unique judgement beyond allRoutes.",
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
      sourceMismatchCount: Array.isArray(payload?.sourceMismatchesThatMatter || payload?.sourceConflicts) ? (payload.sourceMismatchesThatMatter || payload.sourceConflicts).length : 0,
      familyDiagnosticCount: Array.isArray(payload?.familyDiagnostics) ? payload.familyDiagnostics.length : 0,
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

function normaliseJsonishText(raw) {
  return stripFences(raw)
    .replace(/^\uFEFF/, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim();
}

function withJsonParseDiagnostics(err, raw, stage) {
  const parsedErr = err instanceof Error ? err : new Error(String(err));
  parsedErr.stage = stage;
  parsedErr.rawLength = String(raw || "").length;
  parsedErr.rawSnippet = String(raw || "").slice(0, 700);
  return parsedErr;
}

function parseJsonCandidate(candidate, raw, stage) {
  const trimmed = String(candidate || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    const withoutTrailingCommas = trimmed.replace(/,\s*([}\]])/g, "$1");
    if (withoutTrailingCommas !== trimmed) {
      try {
        return JSON.parse(withoutTrailingCommas);
      } catch {}
    }
    throw withJsonParseDiagnostics(err, raw, stage);
  }
}

function firstCompleteJsonObjectCandidate(textValue) {
  const source = String(textValue || "");
  for (let start = source.indexOf("{"); start >= 0; start = source.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < source.length; index += 1) {
      const char = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
      }
    }
  }
  return "";
}

function extractJson(raw) {
  const cleaned = normaliseJsonishText(raw);

  if (!cleaned) throw withJsonParseDiagnostics(new Error("Model response was empty"), raw, "empty");

  try {
    return parseJsonCandidate(cleaned, raw, "full-response");
  } catch {}

  const fenced = String(raw || "").match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return parseJsonCandidate(normaliseJsonishText(fenced[1]), raw, "fenced-json");
    } catch {}
  }

  const candidate = firstCompleteJsonObjectCandidate(cleaned);
  if (candidate) return parseJsonCandidate(candidate, raw, "balanced-object");

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) return parseJsonCandidate(cleaned.slice(start, end + 1), raw, "outermost-braces");

  throw withJsonParseDiagnostics(new Error("Model response did not contain a complete JSON object"), raw, "no-json-object");
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

function issueIdForFallback(index, lens = "SEO") {
  const key = String(lens || "SEO").toUpperCase();
  const prefix = key.includes("GEO") ? "JH-GEO" : key.includes("AEO") ? "JH-AEO" : "JH-SEO";
  return `${prefix}-${String(index + 1).padStart(3, "0")}`;
}

function representativeSourceFromFamily(pageType) {
  const key = String(pageType || "").toLowerCase();
  if (key.includes("podcast episode")) return "scripts/generate_podcast_episodes.py";
  if (key.includes("podcast transcript")) return "scripts/sync_podcast_transcripts.py and transcripts/index.html";
  if (key.includes("blog")) return "blog templates and blog/*.html";
  if (key.includes("topic")) return "topics/index.html and topic templates";
  if (key.includes("book")) return "ebooks/index.html and ebook templates";
  return "shared route/template family";
}

function baselineIssueFromHeuristic(issue, index) {
  const lens = text(issue?.auditLens || issue?.lens, "SEO");
  const affected = text(issue?.affectedPagesTemplatesFilesOrRoutes || issue?.affected, "Affected route family from supplied evidence");
  const remediation = text(issue?.exactRemediation, "Apply an evidence-specific route, template, or content correction for the affected family.");
  return {
    issueId: text(issue?.issueId, issueIdForFallback(index, lens)),
    severity: text(issue?.severity, "Medium"),
    confidence: text(issue?.confidence, "Confirmed"),
    auditLens: lens,
    rootCauseLevel: text(issue?.rootCauseLevel, "template"),
    affectedPagesTemplatesFilesOrRoutes: affected,
    evidenceObserved: text(issue?.evidenceObserved, `Supplied heuristic issue for ${affected}.`),
    whyItMatters: text(issue?.whyItMatters, "This affects crawl reliability, answer extraction, generative retrieval quality, or conversion support."),
    exactRemediation: `${remediation} Target: ${affected}.`,
    expectedGain: text(issue?.expectedGain, "Stronger crawl, answer extraction, and generative retrieval quality."),
    estimatedEffort: text(issue?.estimatedEffort, "Medium"),
    recommendedOwner: text(issue?.recommendedOwner, "Engineering"),
    verificationMethod: text(issue?.verificationMethod || issue?.verification, "Rerun the SEO + AEO + GEO audit and confirm corrected evidence in coverage.json and report.html."),
  };
}

function baselineIssueFromCoverage(row, index) {
  const pageType = text(row?.pageType || row?.family, "route family");
  const sourceFile = text(row?.sourceFile || representativeSourceFromFamily(pageType), pageType);
  const failed = Number(row?.failed || 0);
  const averageScore = Number(row?.averageScore || 0);
  const lens = failed > 0 ? "SEO / Technical" : averageScore < 70 ? "AEO / GEO" : "Content architecture";
  return {
    issueId: issueIdForFallback(index, lens),
    severity: failed > 0 ? "High" : averageScore < 70 ? "Medium" : "Low",
    confidence: "Confirmed",
    auditLens: lens,
    rootCauseLevel: failed > 0 ? "route" : "template",
    affectedPagesTemplatesFilesOrRoutes: `${pageType} via ${sourceFile}`,
    evidenceObserved: failed > 0 ? `${failed} ${pageType} URL(s) failed or remained incomplete in the supplied coverage family.` : `${pageType} average score is ${Number.isFinite(averageScore) ? averageScore : 0}; answer-first and generative retrieval patterns need template-level reinforcement.`,
    whyItMatters: failed > 0 ? "Incomplete or failed routes prevent a release-ready full-estate audit verdict." : "Thin answer-first structure reduces answer-engine extraction and generative-search citation quality.",
    exactRemediation: failed > 0 ? `Resolve the failed ${pageType} route(s), then rerun the audit until the ${pageType} coverage row reports 0 failed URLs.` : `Update ${sourceFile} for ${pageType} pages with a direct-answer summary, question-led H2, extractable bullet list, and clear Jonathan Harris entity context.`,
    expectedGain: failed > 0 ? "Full coverage can be established without failed-gate route evidence." : "Improved AEO/GEO scores and stronger machine-readable page-family summaries.",
    estimatedEffort: failed > 0 ? "Medium" : "Low",
    recommendedOwner: failed > 0 ? "Engineering" : "Content",
    verificationMethod: `Rerun the SEO + AEO + GEO audit and confirm the ${pageType} family score and coverage state improve in coverage.json.`,
  };
}

function listSample(items, field = "url", maxItems = 5) {
  return asArray(items)
    .map((item) => (isPlainObject(item) ? item[field] || item.path || item.route || item.url : item))
    .map(compactString)
    .filter(Boolean)
    .slice(0, maxItems)
    .join(", ");
}

function findFamilyDiagnostic(payload, pattern) {
  return asArray(payload?.familyDiagnostics).find((row) => {
    const pageType = compactString(row?.pageType || row?.family).toLowerCase();
    return pattern.test(pageType);
  }) || {};
}

function forensicIssue({
  issueId,
  severity = "High",
  confidence = "Confirmed",
  auditLens = "SEO / Technical",
  rootCauseLevel = "system",
  affectedPagesTemplatesFilesOrRoutes,
  evidenceObserved,
  whyItMatters,
  exactRemediation,
  expectedGain,
  estimatedEffort = "Medium",
  recommendedOwner = "Engineering",
  verificationMethod,
}) {
  return {
    issueId,
    severity,
    confidence,
    auditLens,
    rootCauseLevel,
    affectedPagesTemplatesFilesOrRoutes: text(affectedPagesTemplatesFilesOrRoutes, "Affected route, template, or source file from supplied evidence"),
    evidenceObserved: text(evidenceObserved, "Evidence observed in supplied source, coverage, or route reconciliation data."),
    whyItMatters: text(whyItMatters, "This weakens crawl reliability, answer extraction, generative retrieval, or conversion support."),
    exactRemediation: text(exactRemediation, "Apply the exact correction named in the issue evidence."),
    expectedGain: text(expectedGain, "More reliable crawl, answer extraction, and generative retrieval quality."),
    estimatedEffort,
    recommendedOwner,
    verificationMethod: text(verificationMethod, "Rerun the SEO + AEO + GEO audit and confirm the corrected evidence in coverage.json and report.html."),
  };
}

function signalIssuesFromPayload(payload) {
  const issues = [];
  const signals = isPlainObject(payload?.repoSignals) ? payload.repoSignals : {};
  const governanceExcludes = asArray(signals.governanceScriptExcludes).filter((item) => /blog\/posts|podcast\/episodes/i.test(String(item)));
  if (governanceExcludes.length) {
    issues.push(forensicIssue({
      issueId: "JH-TECH-001",
      severity: "Critical",
      auditLens: "Technical / Governance / SEO",
      rootCauseLevel: "system / release gate",
      affectedPagesTemplatesFilesOrRoutes: "scripts/check_ungoverned_routes.py; blog/posts/; podcast/episodes/; workbook Pages sheet",
      evidenceObserved: `EXCLUDED_ROUTE_PREFIXES contains ${governanceExcludes.join(", ")}.`,
      whyItMatters: "High-value dynamic blog and podcast routes can exist live without repo, workbook, sitemap, feed, and coverage parity.",
      exactRemediation: "Remove canonical blog/posts/ and podcast/episodes/ exclusions from the release gate. Govern generated blog and podcast leaves through a deterministic route manifest compared against workbook Pages, sitemap.xml, podcast/blog feeds, and coverage.json; keep only podcast/TT-* compatibility redirect pages exempted.",
      expectedGain: "Stops silent dynamic route drift and makes blog, podcast, and transcript assets auditable at release time.",
      estimatedEffort: "Medium",
      recommendedOwner: "Engineering / SEO",
      verificationMethod: "Run scripts/check_ungoverned_routes.py and the SEO audit; confirm dynamic leaves are either manifest-governed or flagged as mismatches.",
    }));
  }

  const duplicatePodcastUrls = asArray(signals.duplicatePodcastPageUrls);
  if (duplicatePodcastUrls.length) {
    const first = duplicatePodcastUrls[0] || {};
    issues.push(forensicIssue({
      issueId: "JH-TECH-002",
      severity: "Critical",
      auditLens: "Technical / Canonical / SEO",
      rootCauseLevel: "data / generator",
      affectedPagesTemplatesFilesOrRoutes: "data/podcast-episodes.json; scripts/generate_podcast_episodes.py; sitemap.xml; podcast episode canonicals",
      evidenceObserved: `Duplicate podcast page_url values detected: ${listSample(duplicatePodcastUrls, "url", 3) || compactString(first.url)}.`,
      whyItMatters: "Multiple episodes collapsing into one canonical URL destroys episode identity and makes sitemap coverage misleading.",
      exactRemediation: "Make podcast slugs unique inside scripts/generate_podcast_episodes.py by appending session_id or ISO date whenever a title slug repeats or equals the generic artificial-intelligence-weekly slug. Regenerate data/podcast-episodes.json, episode pages, sitemap entries, workbook/dynamic inventory, and only then add intentional 301 redirects from any shared legacy URL.",
      expectedGain: "Restores one episode per URL, one canonical per episode, and clean podcast topical authority.",
      estimatedEffort: "Medium",
      recommendedOwner: "Engineering",
      verificationMethod: "Run the podcast generator and assert every data/podcast-episodes.json page_url is unique before rerunning the audit.",
    }));
  }

  const missingTranscriptCount = Number(signals.transcriptSitemapMissingCount || signals.transcriptSitemap?.missingCount || 0);
  if (missingTranscriptCount > 0) {
    issues.push(forensicIssue({
      issueId: "JH-SEO-001",
      severity: "High",
      auditLens: "SEO / AEO / GEO",
      rootCauseLevel: "sitemap / inventory",
      affectedPagesTemplatesFilesOrRoutes: "sitemap.xml; transcript archive; transcript leaf pages under /transcripts/TT-*.html",
      evidenceObserved: `${missingTranscriptCount} transcript URL(s) from data/podcast-episodes.json are absent from repo sitemap coverage. Sample: ${listSample(signals.transcriptSitemapMissingSample, "url", 5) || listSample(signals.transcriptSitemapMissingSample, "", 5)}.`,
      whyItMatters: "Transcript pages contain citation-ready podcast text, but crawlers and LLM retrieval systems are not being handed a complete URL ledger.",
      exactRemediation: "Generate transcript sitemap entries from data/podcast-episodes.json and podcast RSS transcript links, using episode date as lastmod. Feed the same transcript ledger into workbook/dynamic inventory checks and coverage.json.",
      expectedGain: "Improves transcript discovery, long-tail retrieval, and podcast-to-text authority.",
      estimatedEffort: "Low / Medium",
      recommendedOwner: "SEO / Engineering",
      verificationMethod: "Confirm sitemap.xml contains every /transcripts/TT-*.html URL from data/podcast-episodes.json, then rerun the audit.",
    }));
  }

  if (String(signals.llmsScope || "").toLowerCase() === "ebook-only") {
    issues.push(forensicIssue({
      issueId: "JH-GEO-001",
      severity: "High",
      auditLens: "GEO / Entity / Retrieval",
      rootCauseLevel: "llms discovery asset",
      affectedPagesTemplatesFilesOrRoutes: "llms.txt; llm-index.json",
      evidenceObserved: "repoSignals.llmsScope is ebook-only; blog, podcast, transcript, topic, and glossary retrieval surfaces are not exposed in the LLM discovery layer.",
      whyItMatters: "The estate hides high-signal editorial and transcript assets from LLM-friendly discovery files, limiting generative-search visibility outside ebooks.",
      exactRemediation: "Expand llms.txt and llm-index.json to include homepage, bio, topic guides, glossary, comparison, blog hub, latest weekly posts, podcast hub, recent episode pages, transcript archive, and transcript leaves with short descriptions and entity relationships.",
      expectedGain: "Makes the full estate machine-readable and improves retrieval and citation pathways.",
      estimatedEffort: "Low / Medium",
      recommendedOwner: "GEO / Engineering",
      verificationMethod: "Fetch llms.txt and llm-index.json; confirm non-ebook families and transcript leaves are present before rerunning the audit.",
    }));
  }

  const podcastEpisode = findFamilyDiagnostic(payload, /podcast episode/);
  if (isPlainObject(podcastEpisode) && Number(podcastEpisode.averageScore || podcastEpisode.score || 100) < 70) {
    issues.push(forensicIssue({
      issueId: "JH-AEO-001",
      severity: "High",
      auditLens: "AEO / Content / Podcast",
      rootCauseLevel: "template / content",
      affectedPagesTemplatesFilesOrRoutes: podcastEpisode.sourceFile || "podcast episode routes; scripts/generate_podcast_episodes.py; functions/podcast episode renderer",
      evidenceObserved: podcastEpisode.observedTemplateEvidence || `Podcast episode family average score is ${podcastEpisode.averageScore || "below target"}; sample URLs: ${listSample(podcastEpisode.sampleUrls, "url", 3)}.`,
      whyItMatters: "Episode pages that are mainly audio wrappers cannot win answer surfaces or generative citations for the topics discussed in the show.",
      exactRemediation: "Update the podcast episode template so every episode renders a 60-word answer-first summary, 3-5 key takeaways, discussed entities/topics, transcript preview anchors, related topic guides/books, PodcastEpisode JSON-LD, FAQPage JSON-LD, and a canonical transcript link.",
      expectedGain: "Turns each episode from a thin doorway into a retrieval-ready landing page.",
      estimatedEffort: "Medium",
      recommendedOwner: "Content / Engineering",
      verificationMethod: "Rerun the audit and confirm podcast episode priority pages show takeaways, topic/book links, FAQPage schema, and improved AEO/GEO evidence.",
    }));
  }

  const transcript = findFamilyDiagnostic(payload, /transcript/);
  if (isPlainObject(transcript) && Number(transcript.averageScore || transcript.score || 100) < 75) {
    issues.push(forensicIssue({
      issueId: "JH-AEO-002",
      severity: "High",
      auditLens: "AEO / GEO / Transcript",
      rootCauseLevel: "template / content structure",
      affectedPagesTemplatesFilesOrRoutes: transcript.sourceFile || "transcript detail routes; functions/transcripts/[[slug]].js; transcripts/index.html",
      evidenceObserved: transcript.observedTemplateEvidence || `Transcript family average score is ${transcript.averageScore || "below target"}; sample URLs: ${listSample(transcript.sampleUrls, "url", 3)}.`,
      whyItMatters: "Long transcript pages without summary-led chunking are harder for answer engines and LLM retrievers to cite accurately.",
      exactRemediation: "Before the transcript body, render episode summary, what changed this week, key named entities, five bullet takeaways, topic index, timestamped or sectioned anchors, related books/topics, and Transcript/PodcastEpisode schema alignment.",
      expectedGain: "Improves extractability, snippet potential, and LLM citation quality for transcript pages.",
      estimatedEffort: "Medium",
      recommendedOwner: "Editorial / Engineering",
      verificationMethod: "Inspect /transcripts/TT-*.html after rebuild and confirm summary, takeaways, entity index, anchors, and schema are visible before the raw transcript.",
    }));
  }

  const blog = findFamilyDiagnostic(payload, /blog article/);
  if (isPlainObject(blog) && Number(blog.repeatedOpeningParagraphPages || 0) > 0) {
    issues.push(forensicIssue({
      issueId: "JH-AEO-003",
      severity: "High",
      auditLens: "AEO / Blog / Content",
      rootCauseLevel: "template / R2 HTML",
      affectedPagesTemplatesFilesOrRoutes: blog.sourceFile || "blog post template; functions/blog/posts/[[slug]].js; blog R2 HTML renderer",
      evidenceObserved: `${blog.repeatedOpeningParagraphPages} blog article page(s) show repeated opening/standfirst paragraphs. Sample: ${listSample(blog.sampleUrls, "url", 3)}.`,
      whyItMatters: "Repeated standfirst text wastes prime extraction space and makes the page look mechanically assembled.",
      exactRemediation: "Render the standfirst once after the H1, remove duplicate summary echoes from hero/article hydration, and use a distinct TL;DR bullet block only when it adds different wording.",
      expectedGain: "Cleaner first screen, stronger snippet extraction, and less automation footprint.",
      estimatedEffort: "Low",
      recommendedOwner: "Frontend / Editorial",
      verificationMethod: "Fetch the latest blog post HTML and confirm the standfirst appears once before the first H2.",
    }));
  }

  const trimLimit = Number(signals.ebookPipelineTrimLimit || 0);
  if (trimLimit > 0 && trimLimit <= 80) {
    issues.push(forensicIssue({
      issueId: "JH-SEO-004",
      severity: "Medium",
      auditLens: "SEO / AEO / Template",
      rootCauseLevel: "template / copy generation",
      affectedPagesTemplatesFilesOrRoutes: "scripts/ebook_pipeline.py; ebook detail H3 headings",
      evidenceObserved: `ebook pipeline heading trim limit detected at ${trimLimit} characters.`,
      whyItMatters: "Hard-trimmed headings can cut meaning mid-phrase and weaken answer-style headings on otherwise strong book pages.",
      exactRemediation: "Remove the hard character slice and replace it with a whole-word shorten helper that only shortens above 96-110 characters; let CSS handle normal wrapping.",
      expectedGain: "Sharper headings for snippet extraction and better ebook page polish.",
      estimatedEffort: "Low",
      recommendedOwner: "Engineering / Content",
      verificationMethod: "Regenerate one ebook page and confirm H3 headings are whole phrases without mid-word or mid-phrase truncation.",
    }));
  }

  return issues;
}

function deterministicIssuesFromPayload(payload) {
  const signalIssues = signalIssuesFromPayload(payload);
  const heuristics = asArray(payload?.heuristicIssues)
    .filter(isPlainObject)
    .map((issue, index) => baselineIssueFromHeuristic(issue, index))
    .filter((issue) => !isGenericAdvice(issue.exactRemediation));
  const rows = coverageRows(payload)
    .filter(isPlainObject)
    .slice()
    .sort((a, b) => (Number(b.failed || 0) - Number(a.failed || 0)) || (Number(a.averageScore || 0) - Number(b.averageScore || 0)))
    .map((row, index) => baselineIssueFromCoverage(row, index))
    .filter((issue) => !isGenericAdvice(issue.exactRemediation));

  const merged = [];
  const seen = new Set();
  for (const issue of [...signalIssues, ...heuristics, ...rows]) {
    const key = compactString(issue.issueId || issue.exactRemediation).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(issue);
    if (merged.length >= 8) break;
  }
  return merged.length ? merged : [baselineIssueFromCoverage({ pageType: "SEO + AEO + GEO audit evidence payload", averageScore: 0 }, 0)];
}

function scoreBlock(score, headline) {
  const finalScore = clampScore(score, 0);
  return { score: finalScore, grade: expectedGrade(finalScore), headline };
}

function buildDeterministicAnalysisDraft(payload, diagnostics = {}) {
  const scores = fallbackScores(payload);
  const issues = deterministicIssuesFromPayload(payload);
  return {
    auditCompletionState: "Complete",
    aiAnalysisStatus: diagnostics.usedFallback ? "valid-deterministic-fallback" : "valid",
    executiveSummary: "The forensic analysis was completed from supplied crawl, route, coverage, and heuristic evidence without trusting malformed model JSON.",
    overallVerdict: "The audit evidence is valid for release-gate reporting, with priority work concentrated in the affected route families and template-level AEO/GEO improvements identified by the supplied coverage ledger.",
    scoreTable: {
      seo: scoreBlock(scores.seo, "Technical SEO and on-page intent were scored from supplied page evidence."),
      aeo: scoreBlock(scores.aeo, "Answer-engine readiness was scored from summaries, headings, lists, tables, and FAQ evidence."),
      geo: scoreBlock(scores.geo, "Generative-search readiness was scored from entity cues, schema, links, and reusable context."),
      entityAuthority: scoreBlock(scores.entityAuthority, "Entity authority was scored from author, schema, and family evidence."),
      conversionSupport: scoreBlock(scores.conversionSupport, "Conversion support was scored from commercial route and CTA evidence."),
    },
    rankedIssueLedger: issues,
    pageTypeFindings: [],
    priorityPageAnnex: [],
    templateComponentGeneratorAnnex: [],
    codeMarkupContentRemediationAppendix: [],
    bestPracticeGapMatrix: [],
    fullUrlCoverageAppendix: [],
    limitations: [diagnostics.message || "AI forensic JSON required deterministic fallback after malformed model output."],
    verificationItems: issues.slice(0, 5).map((issue) => `${issue.issueId}: ${issue.verificationMethod}`),
    aiDiagnostics: diagnostics,
  };
}

function parseErrorSummary(err) {
  return {
    message: err instanceof Error ? err.message : String(err),
    stage: err?.stage,
    rawLength: err?.rawLength,
    rawSnippet: err?.rawSnippet,
  };
}

function buildDeterministicFallback(payload, firstError, repairError) {
  return validateAndNormaliseAnalysisShape(buildDeterministicAnalysisDraft(payload, {
    usedFallback: true,
    jsonStrategy: "deterministic-fallback-after-malformed-model-json",
    message: "Model JSON could not be parsed or repaired; deterministic evidence-led fallback was used.",
    firstError: parseErrorSummary(firstError),
    repairError: parseErrorSummary(repairError),
  }), payload);
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

function normaliseSourceLedger(data, payload) {
  const source = asArray(data?.sourceLedger).length ? asArray(data.sourceLedger) : asArray(payload?.sourceLedger);
  if (source.length) {
    return source.filter(isPlainObject).map((row) => ({
      source: text(row.source || row.name, "Unknown source"),
      count: Number(row.count ?? row.urlCount ?? row.routes ?? 0),
      role: text(row.role || row.sourceRole, "Discovery and reconciliation input"),
      confidence: text(row.confidence, "Confirmed"),
      notes: text(row.notes || row.limitation || row.detail, "Used in route reconciliation."),
    }));
  }

  const counts = payload?.inventory?.sourceCounts || payload?.sourceCounts || {};
  if (isPlainObject(counts)) {
    return Object.entries(counts).map(([sourceName, count]) => ({
      source: sourceName,
      count: Number(count || 0),
      role: "URL discovery and reconciliation evidence",
      confidence: "Confirmed",
      notes: "Derived from the audit context package sourceCounts field.",
    }));
  }

  return [];
}

function normaliseSourceMismatches(data, payload) {
  const source = asArray(data?.sourceMismatchesThatMatter || data?.sourceMismatches || data?.sourceConflicts).length
    ? asArray(data.sourceMismatchesThatMatter || data.sourceMismatches || data.sourceConflicts)
    : asArray(payload?.sourceMismatchesThatMatter || payload?.sourceConflicts);

  if (source.length) {
    return source.filter(isPlainObject).map((row) => ({
      mismatch: text(row.mismatch || row.type || row.name, "Source mismatch"),
      affected: text(row.affected || row.affectedRoutes || row.sample || row.routeFamily, "Affected source or route family"),
      evidence: text(row.evidence || row.evidenceObserved || row.detail, "Mismatch observed in supplied reconciliation context."),
      whyItMatters: text(row.whyItMatters || row.impact, "This weakens source-of-truth integrity."),
      requiredAction: text(row.requiredAction || row.exactRemediation || row.action, "Reconcile the affected source ledgers and rerun the audit."),
      confidence: text(row.confidence, "Confirmed"),
    }));
  }

  const signals = isPlainObject(payload?.repoSignals) ? payload.repoSignals : {};
  const rows = [];
  if (asArray(signals.duplicatePodcastPageUrls).length) {
    rows.push({
      mismatch: "Duplicate podcast canonical URLs",
      affected: listSample(signals.duplicatePodcastPageUrls, "url", 3),
      evidence: "data/podcast-episodes.json contains repeated page_url values.",
      whyItMatters: "Episode-level sitemap and canonical signals become ambiguous.",
      requiredAction: "Regenerate unique podcast slugs and update sitemap/workbook/dynamic inventory.",
      confidence: "Confirmed",
    });
  }
  if (Number(signals.transcriptSitemapMissingCount || 0) > 0) {
    rows.push({
      mismatch: "Transcript URLs absent from sitemap",
      affected: `${Number(signals.transcriptSitemapMissingCount)} transcript leaves`,
      evidence: "Transcript URLs are present in the podcast manifest but absent from sitemap.xml.",
      whyItMatters: "Transcript discovery and generative retrieval coverage are weaker than the available content warrants.",
      requiredAction: "Generate transcript sitemap entries from the podcast manifest and feed.",
      confidence: "Confirmed",
    });
  }
  return rows;
}

function normaliseFullCoverageAppendix(data, payload) {
  const source = asArray(data?.fullUrlCoverageAppendix).filter((row) => isPlainObject(row));
  if (source.length) return source;

  return asArray(payload?.allRoutes).map((route) => ({
    url: text(route.url || route.route, ""),
    pageType: text(route.pageType, "Unknown page type"),
    source: text(route.source || route.discoverySource || (Array.isArray(route.sources) ? route.sources.join(", ") : ""), "Supplied audit route ledger"),
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
    sourceLedger: normaliseSourceLedger(data, payload),
    sourceMismatchesThatMatter: normaliseSourceMismatches(data, payload),
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
    "add answer-first summaries",
    "extractable subheadings",
    "direct response blocks",
    "strengthen opening context",
    "entity cues",
    "reusable explanatory passages",
  ];
  return generic.some((phrase) => textValue === phrase || textValue.startsWith(`${phrase}.`) || textValue.includes(phrase));
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
    sourceMismatches: normalised.sourceMismatchesThatMatter,
    sourceConflicts: normalised.sourceMismatchesThatMatter,
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

function auditNumberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function auditIntegerEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

async function callAuditForensic({ resilientRequest, payload, messages, section }) {
  return resilientRequest("auditForensic", {
    sessionId: payload?.sessionId,
    section,
    max_tokens: auditNumberEnv("AUDIT_AI_MAX_TOKENS", 12000),
    temperature: auditNumberEnv("AUDIT_AI_TEMPERATURE", 0.15),
    timeoutMs: auditNumberEnv("AUDIT_AI_TIMEOUT_MS", 240000),
    top_p: auditNumberEnv("AUDIT_AI_TOP_P", 0.95),
    maxRetries: auditIntegerEnv("AUDIT_AI_MAX_RETRIES", 0),
    retryBaseMs: auditNumberEnv("AUDIT_AI_RETRY_BASE_MS", Number(process.env.AI_RETRY_BASE_MS || 500)),
    response_format: { type: "json_object" },
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
    const firstError = err;
    const validationErrors = err?.validationErrors || [err instanceof Error ? err.message : String(err)];
    const repairPrompt = buildRepairPrompt({ payload, validationErrors, draft: draft || raw });
    try {
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
    } catch (repairError) {
      return buildDeterministicFallback(payload, firstError, repairError);
    }
  }
}

export const __seoAeoGeoAnalysisTestHooks = {
  buildUserPrompt,
  buildRepairPrompt,
  extractJson,
  buildNormalisedPayload,
  validateNormalisedAnalysis,
  validateAndNormaliseAnalysisShape,
  buildDeterministicAnalysisDraft,
  buildDeterministicFallback,
};

export default { runSeoAeoGeoAnalysis };
