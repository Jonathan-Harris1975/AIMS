import { buildLane1SkillsBaseline } from "./lane1Skills.js";

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
  "fullIssueRecords",
  "coverageAssurance",
  "sourceReconciliation",
  "pageTypeFindings",
  "priorityPageAnnex",
  "templateComponentGeneratorAnnex",
  "codeMarkupContentRemediationAppendix",
  "deterministicRemediationLedger",
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
  "Coverage Assurance",
  "Findings by Audit Lens",
  "Ranked Issue Ledger",
  "Full Issue Records",
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
21. Treat source ledger and source mismatch rows as evidence, not decoration. Each mismatch must carry id, severity, sources, evidence, impact, and fix fields where the payload supports them.
22. Provide both a compact rankedIssueLedger and fullIssueRecords. The ranked ledger is for prioritisation; fullIssueRecords must preserve the full issue format in readable flowing fields.
23. The codeMarkupContentRemediationAppendix must provide implementation-grade patterns, exact source targets, and verification steps for every Critical or High issue.
24. Never use fallback phrases such as "Implementation order derived from the ranked issue ledger" as an executive summary or verdict. The executive summary must state the strongest estate area, weakest estate area, main root cause, and implementation theme.
25. Transcript evidence must be numerically coherent. Do not write "0 transcript pages behave..." as evidence for a High issue; say exactly how many transcript pages lack summary-led, sectioned, entity-rich, above-the-fold transcript structure.
26. The bestPracticeGapMatrix must use page-family-specific gaps. Do not repeat "Answer-first evidence blocks" across unrelated families when podcast, transcript, blog, book, archive, author, comparison, site-page, or lead-generation evidence supports a more exact missing element.
27. Do not rank /podcast/TT-YYYY-MM-DD compatibility redirect wrappers as priority content pages. Put those in redirect/compatibility evidence only.
28. Intentionally excluded redirect or canonical-only route families must be marked N/A, not F, in page-type findings and gap matrices.
29. Return deterministicRemediationLedger as { "findings": [] }. Only use classification "code_fix" when affectedPaths are exact repo-owned files, evidence is deterministic, requiredOutcome is exact, and allowedFixClass is one of meta_fix, schema_fix, sitemap_fix, internal_link_fix, robots_fix, canonical_fix. Aggregate scores, page-family trends, and R2-hosted podcast/episodes pages must remain classification "manual_review".

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
  const skillsBaseline = buildLane1SkillsBaseline(payload?.skillsBaseline);
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
    skillsBaseline,
    liveDynamicUrls: trimLargeArray(payload?.liveDynamicUrls, 600),
    coverage: trimLargeArray(payload?.coverage, 1500),
    coverageFamilies: trimLargeArray(payload?.coverageFamilies, 80),
    workflowRequirements: {
      dynamicFamiliesMandatory: ["blog", "podcast", "transcript", "archive", "utility", "programmatic"],
      reportStructure: REPORT_STRUCTURE,
      requireReadableFullIssueRecords: true,
      requireCoverageAssurance: true,
      requireSourceReconciliation: true,
      rejectGenericAdvice: true,
      rejectSilentSampling: true,
      issueFormat: REQUIRED_ISSUE_KEYS,
      requiredTopLevelKeys: REQUIRED_TOP_LEVEL_KEYS,
      deterministicRemediationLedgerShape: {
        findings: [
          {
            id: "SEO-001",
            classification: "code_fix | manual_review",
            severity: "critical | high | medium | low",
            confidence: 0.9,
            affectedPaths: ["index.html"],
            allowedFixClass: "meta_fix | schema_fix | sitemap_fix | internal_link_fix | robots_fix | canonical_fix",
            evidence: ["Exact deterministic evidence"],
            requiredOutcome: "Specific repo-level change required",
          },
        ],
      },
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
    "The skillsBaseline block is governance and evidence-readiness metadata only; do not treat installed skills as proof that a crawl, screenshot or monitoring run succeeded unless matching artefacts are present.",
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
  if (key.includes("podcast episode")) return "services/rss-feed-podcast/generateFeed.js; services/tts/utils/podcastProcessor.js; R2 podcast episode route manifest";
  if (key.includes("podcast transcript")) return "services/script/utils/generateTranscriptHtml.js; transcript R2 bucket";
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

function evidenceText(value) {
  if (Array.isArray(value)) return value.map(compactString).filter(Boolean).join("; ");
  return compactString(value);
}

function issueById(issues, issueId) {
  return asArray(issues).some((issue) => compactString(issue?.issueId) === issueId);
}

function extractIsoDatesFromText(value) {
  return [...String(value || "").matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g)].map((match) => match[0]);
}

function maxIsoDate(values) {
  return asArray(values).map(compactString).filter((value) => /^20\d{2}-\d{2}-\d{2}$/.test(value)).sort().pop() || "";
}

function routeDates(payload, pattern = /podcast|transcript/i) {
  const dates = [];
  for (const row of asArray(payload?.allRoutes)) {
    const haystack = `${row?.url || ""} ${row?.path || ""} ${row?.pageType || ""}`;
    if (!pattern.test(haystack)) continue;
    dates.push(...extractIsoDatesFromText(haystack));
  }
  for (const row of asArray(payload?.liveDynamicUrls)) {
    const haystack = `${row?.url || ""} ${row?.path || ""} ${row?.pageType || ""}`;
    if (!pattern.test(haystack)) continue;
    dates.push(...extractIsoDatesFromText(haystack));
  }
  return dates;
}

function sourceMismatchText(payload) {
  return asArray(payload?.sourceMismatchesThatMatter || payload?.sourceConflicts)
    .map((row) => JSON.stringify(row || {}))
    .join("\n");
}

function freshnessDriftEvidence(payload) {
  const signals = isPlainObject(payload?.repoSignals) ? payload.repoSignals : {};
  const repoLatest = compactString(
    signals.podcastLatestDate ||
    signals.podcastManifestLatestDate ||
    signals.repoLatestPodcastDate ||
    signals.repoPodcastLatestDate
  );
  const liveLatest = compactString(
    signals.liveLatestPodcastDate ||
    signals.latestLivePodcastDate ||
    signals.livePodcastLatestDate ||
    maxIsoDate(routeDates(payload, /podcast|transcript/i))
  );
  const mismatch = sourceMismatchText(payload);
  const mismatchDates = extractIsoDatesFromText(mismatch);
  const mismatchMentionsFreshness = /live|fresh|stale|ahead|stops|newer|latest/i.test(mismatch) && /podcast|transcript/i.test(mismatch);

  if (repoLatest && liveLatest && liveLatest > repoLatest) {
    return {
      confirmed: true,
      repoLatest,
      liveLatest,
      evidence: `Live podcast/transcript routes include ${liveLatest}, while the repository podcast manifest latest date is ${repoLatest}.`,
    };
  }
  if (mismatchMentionsFreshness && mismatchDates.length >= 2) {
    return {
      confirmed: true,
      repoLatest: maxIsoDate(mismatchDates.slice(0, -1)),
      liveLatest: maxIsoDate(mismatchDates),
      evidence: compactString(mismatch).slice(0, 360),
    };
  }
  if (signals.podcastFreshnessDrift || signals.livePodcastAheadOfRepo) {
    return {
      confirmed: true,
      repoLatest,
      liveLatest,
      evidence: text(signals.podcastFreshnessDriftEvidence || signals.freshnessDriftEvidence, "Podcast/transcript freshness drift is flagged by repoSignals."),
    };
  }
  return { confirmed: false, repoLatest, liveLatest, evidence: "" };
}

function transcriptDiagnosticEvidence(payload, transcript) {
  const direct = evidenceText(transcript?.observedTemplateEvidence);
  const total = Number(transcript?.analysedUrls || transcript?.analysed || transcript?.totalUrls || transcript?.count || 0);
  const rawWalls = Number(transcript?.rawTranscriptWallCount ?? transcript?.rawTranscriptWalls ?? transcript?.rawWallCount);
  const noSummary = Number(transcript?.missingSummaryLedCount ?? transcript?.noSummaryCount ?? transcript?.missingAboveFoldSummaryCount);
  const weak = Number.isFinite(noSummary) && noSummary > 0 ? noSummary : Number.isFinite(rawWalls) && rawWalls > 0 ? rawWalls : total;
  const sample = listSample(transcript?.sampleWeakUrls || transcript?.sampleUrls, "url", 3);

  if (/^0\s+transcript pages behave/i.test(direct) || /0\s+transcript pages.*without enough/i.test(direct)) {
    return `${weak || "Analysed"}/${total || weak || "analysed"} transcript page(s) lack verified above-the-fold summary, key-takeaway, topic-index, timestamp/section-anchor, or entity-index evidence before the transcript body${sample ? `; sample: ${sample}` : ""}.`;
  }
  if (direct) return direct;
  return `${total || "Analysed"} transcript route(s) require transcript-specific checks for summary-led structure, entity index, anchors, related links, and Transcript/PodcastEpisode schema alignment${sample ? `; sample: ${sample}` : ""}.`;
}

function dynamicInternalLinkEvidence(payload) {
  const families = [
    findFamilyDiagnostic(payload, /podcast episode/),
    findFamilyDiagnostic(payload, /podcast transcript/),
    findFamilyDiagnostic(payload, /blog article/),
  ].filter(isPlainObject);
  const weak = families.filter((family) => {
    const total = Number(family.analysedUrls || family.totalUrls || 0);
    const links = Number(family.topicOrBookLinkCount || 0);
    return total > 0 && links < total;
  });
  if (!weak.length) return { confirmed: false, evidence: "" };
  return {
    confirmed: true,
    evidence: weak.map((family) => `${family.pageType || family.family}: ${Number(family.topicOrBookLinkCount || 0)}/${Number(family.analysedUrls || family.totalUrls || 0)} analysed pages link into topic/book/glossary assets`).join("; "),
  };
}

function isWeakNarrative(value) {
  const candidate = compactString(value).toLowerCase();
  return !candidate ||
    candidate === "implementation order derived from the ranked issue ledger." ||
    candidate === "implementation order derived from the ranked issue ledger" ||
    candidate.includes("forensic audit synthesis completed from supplied evidence") ||
    candidate.includes("forensic verdict supplied from the evidence-led analysis");
}

function looksLikeAuditEvidenceRequestPayload(value) {
  if (!isPlainObject(value)) return false;
  const hasEvidenceShape = Boolean(
    value.workflowRequirements ||
      (value.baseUrl && value.inventory && value.repoSignals && Array.isArray(value.allRoutes)) ||
      (value.website && value.inventory && Array.isArray(value.allRoutes))
  );
  const hasAnalysisShape = Boolean(
    value.auditCompletionState ||
      value.aiAnalysisStatus ||
      value.overallVerdict ||
      value.scoreTable ||
      value.rankedIssueLedger ||
      value.fullIssueRecords ||
      value.finalVerdictAndImplementationOrder
  );
  return hasEvidenceShape && !hasAnalysisShape;
}

function rejectAuditEvidenceRequestEcho(value) {
  if (!looksLikeAuditEvidenceRequestPayload(value)) return;
  const err = new Error("AI forensic provider repeated the audit evidence request instead of returning forensic analysis JSON");
  err.code = "AUDIT_AI_PROMPT_ECHO";
  err.validationErrors = [
    "The provider response looked like the original audit evidence package, not the required forensic report JSON.",
    "Do not accept echoed request payloads as analysis; repair or fall back to deterministic forensic analysis.",
  ];
  throw err;
}

function looksLikeAuditPromptEchoText(value) {
  const raw = compactString(value);
  if (!raw) return false;
  const lowered = raw.toLowerCase();
  const requestMarkers = [
    "forensic seo + aeo + geo audit - full estate evidence package",
    "use the evidence payload only",
    "mandatory top-level json keys",
    "workflowrequirements",
    "dynamicfamiliesmandatory",
  ];
  const markerCount = requestMarkers.filter((marker) => lowered.includes(marker)).length;
  const evidenceShape = lowered.includes('"allroutes"') || lowered.includes('allroutes') || lowered.includes('"reposignals"') || lowered.includes('reposignals');
  const analysisShape = lowered.includes('"rankedissueledger"') || lowered.includes('"fullissuerecords"') || lowered.includes('"scoretable"');
  return markerCount >= 2 || (markerCount >= 1 && evidenceShape && !analysisShape);
}

function rejectRawPromptEcho(value) {
  if (!looksLikeAuditPromptEchoText(value)) return;
  const err = new Error("AI forensic provider repeated the prompt/request text instead of returning analysis JSON");
  err.code = "AUDIT_AI_PROMPT_ECHO";
  err.validationErrors = [
    "The provider response repeated the request/prompt text, not forensic analysis JSON.",
    "Skip repair for prompt echoes and use deterministic forensic fallback to avoid duplicate AI requests.",
  ];
  throw err;
}

function familyScore(payload, pattern) {
  const row = coverageRows(payload).find((item) => pattern.test(String(item?.pageType || item?.family || "")));
  return Number(row?.averageScore || row?.score || 0);
}

function deriveNarrative(payload, issues) {
  const bookScore = familyScore(payload, /book page/i);
  const podcastScore = familyScore(payload, /podcast episode/i);
  const transcriptScore = familyScore(payload, /transcript/i);
  const strongest = bookScore ? `book pages remain the strongest commercial layer at ${bookScore}` : "the static commercial estate is the strongest layer";
  const weakestParts = [];
  if (podcastScore) weakestParts.push(`podcast episodes at ${podcastScore}`);
  if (transcriptScore) weakestParts.push(`transcripts at ${transcriptScore}`);
  const critical = asArray(issues).filter((issue) => issue.severity === "Critical").map((issue) => issue.issueId).join(" and ");
  return `The static estate is materially stronger than the dynamic editorial estate: ${strongest}, while ${weakestParts.join(" and ") || "podcast, transcript, and blog families carry the main risk"}. The main root cause is source-of-truth drift across repo, workbook, sitemap, feed, live routes, and generated manifests${critical ? `, led by ${critical}` : ""}. Fix governance and canonical integrity before polishing page copy.`;
}

function isPodcastCompatibilityRoute(value) {
  const raw = compactString(value);
  return /\/podcast\/TT-\d{4}-\d{2}-\d{2}\/?$/i.test(raw);
}

function isExcludedOrRedirectFamily(pageType, coverageState = "") {
  const type = String(pageType || "").toLowerCase();
  const state = String(coverageState || "").toLowerCase();
  return type.includes("buy-now") || state.includes("excluded") || state.includes("redirect");
}

function sanitiseTemplateEvidence(pageType, value, analysedCount = 0) {
  const candidate = compactString(value);
  if (/transcript/i.test(String(pageType || "")) && /^0 transcript pages behave/i.test(candidate)) {
    const total = Number(analysedCount || 0);
    return `${total}/${total} transcript page(s) lack verified above-the-fold summary, key-takeaway, topic-index, timestamp/section-anchor, or entity-index evidence before the transcript body.`;
  }
  return candidate;
}

function pageTypeSpecificGap(pageType, fallback = "See issue ledger") {
  const type = String(pageType || "").toLowerCase();
  if (type.includes("podcast episode")) return "Missing key takeaways, FAQPage JSON-LD, transcript preview anchors, and related topic/book CTAs";
  if (type.includes("podcast transcript") || type.includes("transcript")) return "Missing summary, entity index, timestamp/section anchors before transcript body";
  if (type.includes("blog article")) return "Repeated standfirst and weak question-led extraction structure";
  if (type.includes("blog archive")) return "Archive list freshness and crawlable article-card depth need stronger server-rendered evidence";
  if (type.includes("book page")) return "Question-led H2/H3 opportunities remain despite strong Book and FAQ schema";
  if (type.includes("book buy")) return "Redirect/non-page route needs explicit canonical exclusion evidence";
  if (type.includes("topic")) return "Topic guides need more question-led headings and citation-ready answer blocks";
  if (type.includes("category") || type.includes("hub")) return "Hub pages need more extractable intent summaries and contextual next-step links";
  if (type.includes("lead") || type.includes("newsletter") || type.includes("contact")) return "Conversion pages need answer-led objections, trust cues, and clearer next-step copy";
  if (type.includes("homepage")) return "Homepage needs stronger question-led extraction for entity, books, podcast, and newsletter intents";
  if (type.includes("author") || type.includes("about")) return "Missing concise AI-author entity summary, credentials block, and podcast/book cross-links";
  if (type.includes("service") || type.includes("product")) return "Missing problem-answer structure, implementation examples, and trust proof";
  if (type.includes("comparison")) return "Missing direct comparison answer block and decision matrix";
  if (type.includes("archive") || type.includes("utility")) return "Missing archive purpose statement and crawlable route explanation";
  if (type.includes("site page")) return "Missing question-led summary and internal path to books/topics/podcast";
  if (type.includes("knowledge")) return "Glossary needs richer definitions, examples, and entity relationships";
  return fallback === "Answer-first evidence blocks" ? "Missing route-family-specific answer structure and contextual internal links" : fallback;
}

function duplicatePodcastEvidence(duplicates) {
  const rows = asArray(duplicates).filter(isPlainObject);
  if (!rows.length) return "Duplicate podcast page_url values were reported without row details.";
  return rows.slice(0, 3).map((row) => {
    const pageUrl = compactString(row.pageUrl || row.page_url || row.url || row.path || row.route);
    const count = Number(row.count || row.duplicateCount || 0);
    const sessions = asArray(row.sessionIds || row.session_ids).map(compactString).filter(Boolean).slice(0, 8).join(", ");
    const titles = asArray(row.titles).map(compactString).filter(Boolean).slice(0, 3).join(" | ");
    return `${count || "Multiple"} podcast record(s) share ${pageUrl || "the same page_url"}${sessions ? `; session IDs: ${sessions}` : ""}${titles ? `; titles: ${titles}` : ""}`;
  }).join("; ");
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
      evidenceObserved: duplicatePodcastEvidence(duplicatePodcastUrls),
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

  const freshness = freshnessDriftEvidence(payload);
  if (freshness.confirmed) {
    issues.push(forensicIssue({
      issueId: "JH-SEO-002",
      severity: "High",
      auditLens: "SEO / Freshness / Governance",
      rootCauseLevel: "source reconciliation",
      affectedPagesTemplatesFilesOrRoutes: "data/podcast-episodes.json; sitemap.xml; workbook Pages; live podcast episode and transcript routes",
      evidenceObserved: freshness.evidence,
      whyItMatters: "The live estate can move ahead of the governed repo snapshot, making release gates, sitemap checks, workbook parity, and audit coverage stale before the next deployment.",
      exactRemediation: "Move podcast/transcript route generation into one deterministic build step that writes data/podcast-episodes.json, episode HTML, transcript route ledger, sitemap entries, and workbook/dynamic inventory together before deployment.",
      expectedGain: "Keeps fresh podcast and transcript content discoverable, auditable, and governed from one source of truth.",
      estimatedEffort: "Medium",
      recommendedOwner: "Engineering / Editorial Ops",
      verificationMethod: "Rerun the audit after the podcast build and confirm the latest live podcast/transcript date matches data/podcast-episodes.json, sitemap.xml, workbook/dynamic inventory, and coverage.json.",
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
  if (isPlainObject(podcastEpisode)) {
    const analysed = Number(podcastEpisode.analysed || podcastEpisode.count || podcastEpisode.totalAnalysed || 0);
    const failed = Number(podcastEpisode.failed || podcastEpisode.failedCount || 0);
    const score = Number(podcastEpisode.averageScore || podcastEpisode.score || 100);
    if (analysed <= 0 && failed > 0) {
      issues.push(forensicIssue({
        issueId: "JH-TECH-000",
        severity: "Critical",
        auditLens: "Technical / Crawl / Coverage",
        rootCauseLevel: "route / source-owner mapping",
        affectedPagesTemplatesFilesOrRoutes: "R2 podcast episode routes; podcast RSS feed; legacy /podcast/TT-* compatibility URLs; workbook Pages source",
        evidenceObserved: `${failed} podcast episode URL(s) failed or were not mapped to the current R2 podcast source. Episode page quality was not scored because no episode page was successfully analysed.`,
        whyItMatters: "Failed or mis-owned podcast URLs prevent full-estate verification and create crawl reliability risk.",
        exactRemediation: "Map current podcast episode URLs through the AIMS/R2 podcast source, redirect or retire legacy /podcast/TT-* URLs, and remove stale workbook rows unless they remain intentionally public.",
        expectedGain: "Restores honest podcast coverage without asking the website repo to patch R2-owned pages.",
        estimatedEffort: "Medium",
        recommendedOwner: "AIMS / SEO / Redirect governance",
        verificationMethod: "Rerun the SEO + AEO + GEO audit and confirm podcast episode routes are either analysed through the R2 source or listed as explicit redirect/exclusion evidence.",
      }));
    } else if (score < 70) {
      issues.push(forensicIssue({
        issueId: "JH-AEO-001",
        severity: "High",
        auditLens: "AEO / Content / Podcast",
        rootCauseLevel: "AIMS/R2 template / content",
        affectedPagesTemplatesFilesOrRoutes: podcastEpisode.sourceFile || "services/rss-feed-podcast/generateFeed.js; services/tts/utils/podcastProcessor.js; R2 podcast episode pages",
        evidenceObserved: evidenceText(podcastEpisode.observedTemplateEvidence) || `Podcast episode family average score is ${podcastEpisode.averageScore || "below target"}; sample URLs: ${listSample(podcastEpisode.sampleUrls, "url", 3)}.`,
        whyItMatters: "Episode pages that are mainly audio wrappers cannot win answer surfaces or generative citations for the topics discussed in the show.",
        exactRemediation: "Update the R2 episode template so every episode renders a 60-word answer-first summary, 3-5 key takeaways, discussed entities/topics, transcript preview anchors, related topic guides/books, PodcastEpisode JSON-LD, FAQPage JSON-LD, and a canonical transcript link.",
        expectedGain: "Turns each episode from a thin doorway into a retrieval-ready landing page.",
        estimatedEffort: "Medium",
        recommendedOwner: "Content / AIMS Engineering",
        verificationMethod: "Rerun the audit and confirm podcast episode priority pages show takeaways, topic/book links, FAQPage schema, and improved AEO/GEO evidence.",
      }));
    }
  }

  const transcript = findFamilyDiagnostic(payload, /transcript/);
  if (isPlainObject(transcript) && Number(transcript.averageScore || transcript.score || 100) < 75) {
    issues.push(forensicIssue({
      issueId: "JH-AEO-002",
      severity: "High",
      auditLens: "AEO / GEO / Transcript",
      rootCauseLevel: "template / content structure",
      affectedPagesTemplatesFilesOrRoutes: transcript.sourceFile || "services/script/utils/generateTranscriptHtml.js; transcript R2 bucket; /transcripts/TT-*.html",
      evidenceObserved: transcriptDiagnosticEvidence(payload, transcript),
      whyItMatters: "Long transcript pages without summary-led chunking are harder for answer engines and LLM retrievers to cite accurately.",
      exactRemediation: "Before the transcript body, render episode summary, what changed this week, key named entities, five bullet takeaways, topic index, timestamped or sectioned anchors, related books/topics, and Transcript/PodcastEpisode schema alignment.",
      expectedGain: "Improves extractability, snippet potential, and LLM citation quality for transcript pages.",
      estimatedEffort: "Medium",
      recommendedOwner: "Editorial / Engineering",
      verificationMethod: "Inspect /transcripts/TT-*.html after rebuild and confirm summary, takeaways, entity index, anchors, and schema are visible before the raw transcript.",
    }));
  }

  const blog = findFamilyDiagnostic(payload, /blog article/);
  if (isPlainObject(blog) && Number(blog.repeatedOpeningParagraphPages || blog.repeatedOpeningCount || 0) > 0) {
    issues.push(forensicIssue({
      issueId: "JH-AEO-003",
      severity: "High",
      auditLens: "AEO / Blog / Content",
      rootCauseLevel: "template / R2 HTML",
      affectedPagesTemplatesFilesOrRoutes: blog.sourceFile || "blog post template; functions/blog/posts/[[slug]].js; blog R2 HTML renderer",
      evidenceObserved: `${Number(blog.repeatedOpeningParagraphPages || blog.repeatedOpeningCount || 0)} blog article page(s) show repeated opening/standfirst paragraphs. Sample: ${listSample(blog.sampleUrls, "url", 3)}.`,
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

  const internalLinking = dynamicInternalLinkEvidence(payload);
  if (internalLinking.confirmed) {
    issues.push(forensicIssue({
      issueId: "JH-INTERNAL-001",
      severity: "Medium",
      confidence: "Probable",
      auditLens: "Internal linking / Entity",
      rootCauseLevel: "template / editorial graph",
      affectedPagesTemplatesFilesOrRoutes: "podcast episode pages; transcript detail pages; blog posts; topic guides; ebook detail pages; glossary routes",
      evidenceObserved: internalLinking.evidence,
      whyItMatters: "The site has useful topical assets, but dynamic editorial content is not consistently feeding topic, book, glossary, and episode clusters.",
      exactRemediation: "Generate contextual related links from extracted episode/post topics: two topic guides, two relevant ebooks, three glossary terms, prior/next episode, and the matching weekly blog/newsletter item where available.",
      expectedGain: "Improves crawl paths, topical graph strength, entity relationships, and post-listening conversion journeys.",
      estimatedEffort: "Medium",
      recommendedOwner: "Editorial / Engineering",
      verificationMethod: "Rerun the audit and confirm podcast, transcript, and blog diagnostics show full topic/book/glossary link coverage with crawlable anchors.",
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
    if (merged.length >= 10) break;
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
  const narrative = deriveNarrative(payload, issues);
  return {
    auditCompletionState: "Complete",
    aiAnalysisStatus: diagnostics.usedFallback ? "valid-deterministic-fallback" : "valid",
    executiveSummary: narrative,
    overallVerdict: narrative,
    scoreTable: {
      seo: scoreBlock(scores.seo, "Technical SEO and on-page intent were scored from supplied page evidence."),
      aeo: scoreBlock(scores.aeo, "Answer-engine readiness was scored from summaries, headings, lists, tables, and FAQ evidence."),
      geo: scoreBlock(scores.geo, "Generative-search readiness was scored from entity cues, schema, links, and reusable context."),
      entityAuthority: scoreBlock(scores.entityAuthority, "Entity authority was scored from author, schema, and family evidence."),
      conversionSupport: scoreBlock(scores.conversionSupport, "Conversion support was scored from commercial route and CTA evidence."),
    },
    rankedIssueLedger: issues,
    fullIssueRecords: buildFullIssueRecords(issues),
    coverageAssurance: buildCoverageAssurance(payload, []),
    sourceReconciliation: buildSourceReconciliation(payload, normaliseSourceLedger({}, payload), normaliseSourceMismatches({}, payload)),
    pageTypeFindings: [],
    priorityPageAnnex: [],
    templateComponentGeneratorAnnex: [],
    codeMarkupContentRemediationAppendix: [],
    deterministicRemediationLedger: { findings: [] },
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
    return rows.filter((row) => !isPodcastCompatibilityRoute(row.url || row.filePath)).map((row) => {
      const pageType = text(row.pageType || row.family, "Unknown page type");
      const coverageState = text(row.coverageState, "Not verified from supplied context");
      const excludedOrRedirect = isExcludedOrRedirectFamily(pageType, coverageState);
      const score = excludedOrRedirect ? "N/A" : clampScore(row.score ?? row.averageScore, 0);
      return {
        pageType,
        count: Number(row.count ?? row.discovered ?? 0),
        coverageState,
        score,
        grade: excludedOrRedirect ? "N/A" : expectedGrade(score),
        judgement: excludedOrRedirect ? "Intentional redirect/canonical path, tracked for governance but not scored as content." : text(row.judgement || row.verdict, "Judgement derived from supplied AI analysis and coverage ledger."),
        keyNote: excludedOrRedirect ? "Redirect/non-page route, score not applicable." : text(row.keyNote || row.keyFinding, "See coverage ledger for URL-level evidence."),
      };
    });
  }

  return coverageRows(payload).map((row) => {
    const pageType = text(row.pageType || row.family, "Unknown page type");
    const coverageState = coverageStateFromRow(row);
    const excludedOrRedirect = isExcludedOrRedirectFamily(pageType, coverageState) && Number(row.analysed || 0) === 0;
    const score = excludedOrRedirect ? "N/A" : clampScore(row.averageScore, 0);
    return {
      pageType,
      count: Number(row.discovered || 0),
      coverageState,
      score,
      grade: excludedOrRedirect ? "N/A" : expectedGrade(score),
      judgement: excludedOrRedirect ? "Intentional redirect/canonical path, tracked for governance but not scored as content." : Number(row.failed || 0) > 0 ? "Coverage defects remain in this family." : "Family inventoried with explicit URL-level coverage states.",
      keyNote: excludedOrRedirect ? `Excluded ${Number(row.excluded || 0)} redirect/non-page URL(s); content score not applicable.` : `Analysed ${Number(row.analysed || 0)}, excluded ${Number(row.excluded || 0)}, failed ${Number(row.failed || 0)}.`,
    };
  });
}

function normalisePriorityPageAnnex(data, payload) {
  const rows = asArray(data?.priorityPageAnnex).filter((row) => isPlainObject(row) && (row.url || row.filePath));
  if (rows.length) {
    return rows.filter((row) => !isPodcastCompatibilityRoute(row.url || row.filePath)).map((row) => {
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

  return asArray(payload?.priorityPages).filter((page) => !isPodcastCompatibilityRoute(page?.url || page?.route || page?.path)).slice(0, 30).map((page) => {
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
      observedLogic: text(sanitiseTemplateEvidence(row.area || row.pageFamily, row.observedLogic || row.metadataLogic || row.schemaLogic), "Observed from supplied route/template evidence."),
      repeatedEffect: text(sanitiseTemplateEvidence(row.area || row.pageFamily, row.repeatedEffect || row.repeatedDefects || row.generativeSearchGaps), "Repeated family effect recorded in coverage ledger."),
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
    return rows.map((row) => {
      const pageType = text(row.pageType || row.family, "Unknown page type");
      const excludedOrRedirect = isExcludedOrRedirectFamily(pageType, row.coverageState);
      return {
        pageType,
        seo: excludedOrRedirect ? "N/A" : text(row.seo || row.seoCompliance, "Not verified"),
        aeo: excludedOrRedirect ? "N/A" : text(row.aeo || row.aeoCompliance, "Not verified"),
        geo: excludedOrRedirect ? "N/A" : text(row.geo || row.geoCompliance, "Not verified"),
        confidence: text(row.confidence, "Needs verification"),
        topMissingElement: excludedOrRedirect ? "Intentional redirect/canonical route, verify target and exclusion evidence" : pageTypeSpecificGap(pageType, text(row.topMissingElement || row.topMissing, "See issue ledger")),
        businessImpact: text(row.businessImpact, "Medium"),
      };
    });
  }

  return coverageRows(payload).map((row) => {
    const pageType = text(row.pageType || row.family, "Unknown page type");
    const excludedOrRedirect = isExcludedOrRedirectFamily(pageType, coverageStateFromRow(row)) && Number(row.analysed || 0) === 0;
    return {
      pageType,
      seo: excludedOrRedirect ? "N/A" : Number(row.averageScore || 0) >= 80 ? "Strong" : Number(row.averageScore || 0) >= 70 ? "Partial" : "Weak",
      aeo: excludedOrRedirect ? "N/A" : Number(row.averageScore || 0) >= 80 ? "Partial" : "Weak",
      geo: excludedOrRedirect ? "N/A" : Number(row.averageScore || 0) >= 80 ? "Partial" : "Weak",
      confidence: "Confirmed",
      topMissingElement: excludedOrRedirect ? "Intentional redirect/canonical route, verify target and exclusion evidence" : Number(row.failed || 0) > 0 ? "Fetch or redirect reliability" : pageTypeSpecificGap(pageType, "Answer-first evidence blocks"),
      businessImpact: /book|podcast|transcript|blog|lead|conversion/i.test(String(pageType || "")) ? "High" : "Medium",
    };
  });
}

function normaliseSourceLedger(data, payload) {
  const source = asArray(data?.sourceLedger).length ? asArray(data.sourceLedger) : asArray(payload?.sourceLedger);
  if (source.length) {
    return source.filter(isPlainObject).map((row) => {
      const status = text(row.status || row.confidence, "Confirmed");
      const evidence = text(row.evidence || row.notes || row.limitation || row.detail, "Used in route reconciliation.");
      return {
        source: text(row.source || row.name, "Unknown source"),
        count: Number(row.count ?? row.urlCount ?? row.routes ?? 0),
        role: text(row.role || row.sourceRole, "Discovery and reconciliation input"),
        status,
        evidence,
        confidence: status,
        notes: evidence,
      };
    });
  }

  const counts = payload?.inventory?.sourceCounts || payload?.sourceCounts || {};
  if (isPlainObject(counts)) {
    return Object.entries(counts).map(([sourceName, count]) => ({
      source: sourceName,
      count: Number(count || 0),
      role: "URL discovery and reconciliation evidence",
      status: "Confirmed",
      evidence: "Derived from the audit context package sourceCounts field.",
      confidence: "Confirmed",
      notes: "Derived from the audit context package sourceCounts field.",
    }));
  }

  return [];
}

function mismatchId(index, row) {
  return text(row.id || row.issueId || row.mismatchId, `SRC-${String(index + 1).padStart(3, "0")}`);
}

function normaliseSourceMismatches(data, payload) {
  const source = asArray(data?.sourceMismatchesThatMatter || data?.sourceMismatches || data?.sourceConflicts).length
    ? asArray(data.sourceMismatchesThatMatter || data.sourceMismatches || data.sourceConflicts)
    : asArray(payload?.sourceMismatchesThatMatter || payload?.sourceConflicts);

  if (source.length) {
    return source.filter(isPlainObject).map((row, index) => {
      const id = mismatchId(index, row);
      const sources = text(row.sources || row.affected || row.affectedRoutes || row.sample || row.routeFamily, "Affected source or route family");
      const impact = text(row.impact || row.whyItMatters, "This weakens source-of-truth integrity.");
      const fix = text(row.fix || row.requiredAction || row.exactRemediation || row.action, "Reconcile the affected source ledgers and rerun the audit.");
      return {
        id,
        severity: text(row.severity, "High"),
        sources,
        evidence: text(row.evidence || row.evidenceObserved || row.detail || row.mismatch || row.type || row.name, "Mismatch observed in supplied reconciliation context."),
        impact,
        fix,
        mismatch: text(row.mismatch || row.type || row.name || id, "Source mismatch"),
        affected: sources,
        whyItMatters: impact,
        requiredAction: fix,
        confidence: text(row.confidence, "Confirmed"),
      };
    });
  }

  const signals = isPlainObject(payload?.repoSignals) ? payload.repoSignals : {};
  const rows = [];
  if (asArray(signals.duplicatePodcastPageUrls).length) {
    rows.push({
      id: "SRC-002",
      severity: "Critical",
      sources: "data/podcast-episodes.json vs canonical episode URL ledger",
      evidence: duplicatePodcastEvidence(signals.duplicatePodcastPageUrls),
      impact: "Episode-level sitemap and canonical signals become ambiguous.",
      fix: "Regenerate unique podcast slugs and update sitemap/workbook/dynamic inventory.",
      mismatch: "Duplicate podcast canonical URLs",
      affected: listSample(signals.duplicatePodcastPageUrls, "pageUrl", 3),
      whyItMatters: "Episode-level sitemap and canonical signals become ambiguous.",
      requiredAction: "Regenerate unique podcast slugs and update sitemap/workbook/dynamic inventory.",
      confidence: "Confirmed",
    });
  }
  if (Number(signals.transcriptSitemapMissingCount || 0) > 0) {
    rows.push({
      id: "SRC-003",
      severity: "High",
      sources: "data/podcast-episodes.json vs sitemap.xml",
      evidence: `${Number(signals.transcriptSitemapMissingCount)} transcript URLs are present in the podcast manifest but absent from sitemap.xml.`,
      impact: "Transcript discovery and generative retrieval coverage are weaker than the available content warrants.",
      fix: "Generate transcript sitemap entries from the podcast manifest and feed.",
      mismatch: "Transcript URLs absent from sitemap",
      affected: `${Number(signals.transcriptSitemapMissingCount)} transcript leaves`,
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

function conciseAppendixText(value, limit = 260) {
  const words = compactString(value).replace(/\s+/g, " ");
  if (words.length <= limit) return words;
  const clipped = words.slice(0, limit).replace(/\s+\S*$/, "").trim();
  return `${clipped}...`;
}

function normaliseRemediationAppendix(data, issues) {
  const rows = asArray(data?.codeMarkupContentRemediationAppendix || data?.codeRemediationAppendix).filter(isPlainObject);
  if (rows.length) {
    return rows.map((row) => ({
      target: text(row.target || row.filePath || row.sourceFile || row.route, "Affected source path or route family"),
      issueId: text(row.issueId, "Unmapped issue"),
      currentPattern: conciseAppendixText(text(row.currentPattern || row.currentFaultyPattern || row.evidenceObserved, "See issue evidence.")),
      correctedPattern: conciseAppendixText(text(row.correctedPattern || row.replacementPattern || row.exactRemediation, "Apply the issue remediation exactly.")),
      rationale: conciseAppendixText(text(row.rationale || row.whyItMatters, "This change resolves the affected audit issue."), 220),
      verificationMethod: conciseAppendixText(row.verificationMethod || row.verification || "Rerun the audit and confirm the issue-specific evidence changes in coverage.json and report.html.", 220),
    }));
  }

  return issues
    .filter((issue) => ["Critical", "High"].includes(issue.severity))
    .map((issue) => ({
      target: issue.affectedPagesTemplatesFilesOrRoutes,
      issueId: issue.issueId,
      currentPattern: conciseAppendixText(issue.evidenceObserved),
      correctedPattern: conciseAppendixText(issue.exactRemediation),
      rationale: conciseAppendixText(issue.whyItMatters, 220),
      verificationMethod: conciseAppendixText(issue.verificationMethod, 220),
    }))
    .slice(0, 15);
}


const DETERMINISTIC_SEO_FIX_CLASSES = new Set([
  "meta_fix",
  "schema_fix",
  "sitemap_fix",
  "internal_link_fix",
  "robots_fix",
  "canonical_fix",
]);

function normaliseLedgerSeverity(value) {
  const lowered = compactString(value).toLowerCase();
  if (["critical", "high", "medium", "low"].includes(lowered)) return lowered;
  if (["p0", "blocker"].includes(lowered)) return "critical";
  if (["p1", "major"].includes(lowered)) return "high";
  if (["p2", "moderate"].includes(lowered)) return "medium";
  return "low";
}

function normaliseLedgerConfidence(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.min(1, Number(value)));
  const lowered = compactString(value).toLowerCase();
  if (["confirmed", "certain", "high"].includes(lowered)) return 0.9;
  if (["probable", "medium", "moderate"].includes(lowered)) return 0.75;
  if (["low", "weak", "needs verification"].includes(lowered)) return 0.5;
  return 0.8;
}

function isExactRepoOwnedPath(value) {
  const path = compactString(value).replace(/\\/g, "/").replace(/^\.\//, "");
  if (!path) return false;
  if (/^https?:\/\//i.test(path)) return false;
  if (path.startsWith("/") || path.includes("..")) return false;
  if (/[*{}<>|]/.test(path)) return false;
  if (/\s/.test(path)) return false;
  return /\.[a-z0-9]+$/i.test(path);
}

function isR2PodcastEpisodePath(value) {
  const path = compactString(value).replace(/\\/g, "/").replace(/^\.\//, "");
  return path === "podcast/episodes" || path.startsWith("podcast/episodes/");
}


function classifySourceOwner(value = "") {
  const raw = compactString(value).replace(/\\/g, "/").toLowerCase();
  if (!raw) return "manual_review";
  if (/\/podcast\/tt-20\d{2}-\d{2}-\d{2}/i.test(raw) || raw.includes("legacy") || raw.includes("compatibility")) return "redirect_governance";
  if (raw.includes("podcast/episodes") || raw.includes("podcast episode") || raw.includes("rss-feed-podcast") || raw.includes("podcastprocessor")) return "aims_r2_podcast";
  if (raw.includes("transcripts/") || raw.includes("podcast transcript") || raw.includes("generatetranscripthtml") || raw.includes("transcript r2")) return "aims_r2_transcript";
  if (raw.includes("blog/posts") || raw.includes("blog article") || raw.includes("weekly blog") || raw.includes("social-media-blog")) return "aims_r2_blog";
  if (raw.includes("redirect") || raw.includes("canonicalised exclusion")) return "redirect_governance";
  if (/^(assets|catalogue|ebooks|topics|blog|bio|contact|newsletter|privacy-policy|terms-of-use|glossary|compare|index\.html|404\.html)\b/.test(raw)) return "website_repo";
  if (raw.endsWith(".html") || raw.endsWith(".css") || raw.endsWith(".js") || raw.endsWith(".xml") || raw.endsWith(".json")) return "website_repo";
  return "manual_review";
}

function sourceOwnerFromFinding(row = {}) {
  const supplied = compactString(row?.sourceOwner || row?.owner || row?.source_owner);
  if (supplied) return supplied;
  const haystack = [
    row?.route,
    row?.url,
    row?.affectedPagesTemplatesFilesOrRoutes,
    row?.sourceFile,
    row?.source,
    ...asArray(row?.affectedPaths),
    ...asArray(row?.evidence),
  ].join(" ");
  return classifySourceOwner(haystack);
}

function automationReadinessForOwner(owner = "", classification = "manual_review") {
  const normalised = compactString(owner).toLowerCase();
  if (classification === "code_fix" && normalised === "website_repo") return "auto_patch_ready";
  if (normalised === "aims_r2_blog") return "r2_generator_fix";
  if (normalised === "aims_r2_podcast" || normalised === "aims_r2_transcript") return "r2_generator_fix";
  if (normalised === "redirect_governance") return "redirect_governance_fix";
  if (normalised === "future_guidance") return "future_guidance";
  return "manual_review_only";
}

function ramsRoutingHintForOwner(owner = "") {
  const normalised = compactString(owner).toLowerCase();
  if (normalised === "website_repo") return "website_repo_patch_candidate";
  if (normalised === "aims_r2_blog") return "route_to_aims_blog_generator";
  if (normalised === "aims_r2_podcast") return "route_to_aims_podcast_r2_generator";
  if (normalised === "aims_r2_transcript") return "route_to_transcript_generator";
  if (normalised === "redirect_governance") return "route_to_redirect_governance";
  return "manual_review";
}

function buildSourceOwnerMap(payload = {}) {
  const rows = [
    ...asArray(payload?.allRoutes),
    ...asArray(payload?.coverageRows),
    ...asArray(payload?.priorityPages),
  ];
  const map = {};
  for (const row of rows) {
    const key = compactString(row?.url || row?.route || row?.path || row?.pageType || row?.family);
    if (!key) continue;
    const owner = classifySourceOwner(`${key} ${row?.pageType || ""} ${row?.sourceFile || ""}`);
    map[key] = {
      owner,
      pageType: compactString(row?.pageType || row?.family),
      patchRoute: ramsRoutingHintForOwner(owner),
    };
  }
  return map;
}

function normaliseLedgerFinding(row, index) {
  const rawPaths = asArray(row?.affectedPaths).map((item) => compactString(item)).filter(Boolean);
  const affectedPaths = rawPaths.filter(isExactRepoOwnedPath);
  const evidence = asArray(row?.evidence || row?.exactEvidence).map((item) => compactString(item)).filter(Boolean);
  const allowedFixClass = compactString(row?.allowedFixClass || row?.fixClass);
  const requiredOutcome = compactString(row?.requiredOutcome || row?.exactRemediation || row?.recommendation);
  const requestedCodeFix = compactString(row?.classification).toLowerCase() === "code_fix";
  const sourceOwner = sourceOwnerFromFinding(row);
  const reasons = [];

  if (sourceOwner !== "website_repo" && requestedCodeFix) reasons.push(`Source owner ${sourceOwner} is not a website repo auto-patch target.`);
  if (rawPaths.some(isR2PodcastEpisodePath)) reasons.push("R2-hosted podcast/episodes pages are not repo-owned website patch targets.");
  if (!affectedPaths.length) reasons.push("No exact repo-owned affectedPaths were supplied.");
  if (!DETERMINISTIC_SEO_FIX_CLASSES.has(allowedFixClass)) reasons.push(`Unsupported or missing allowedFixClass: ${allowedFixClass || "<missing>"}.`);
  if (!evidence.length) reasons.push("No deterministic evidence was supplied.");
  if (!requiredOutcome) reasons.push("No exact requiredOutcome was supplied.");

  const classification = requestedCodeFix && !reasons.length ? "code_fix" : "manual_review";

  return {
    id: compactString(row?.id || row?.issueId || row?.findingId) || `SEO-${String(index + 1).padStart(3, "0")}`,
    classification,
    severity: normaliseLedgerSeverity(row?.severity),
    confidence: normaliseLedgerConfidence(row?.confidence),
    affectedPaths,
    allowedFixClass: classification === "code_fix" ? allowedFixClass : "",
    evidence: reasons.length ? [...evidence, ...reasons] : evidence,
    requiredOutcome: requiredOutcome || "Review the aggregate SEO/AEO/GEO evidence and create deterministic file-level remediation evidence before patching.",
    sourceOwner,
    automationReadiness: automationReadinessForOwner(sourceOwner, classification),
    ramsRoutingHint: ramsRoutingHintForOwner(sourceOwner),
  };
}

function buildManualReviewLedgerFromIssues(issues) {
  return asArray(issues)
    .slice(0, 10)
    .map((issue, index) => ({
      id: compactString(issue.issueId) || `SEO-${String(index + 1).padStart(3, "0")}`,
      classification: "manual_review",
      severity: normaliseLedgerSeverity(issue.severity),
      confidence: normaliseLedgerConfidence(issue.confidence),
      affectedPaths: [],
      allowedFixClass: "",
      evidence: [compactString(issue.evidenceObserved)].filter(Boolean),
      requiredOutcome: compactString(issue.exactRemediation) || "Review the aggregate SEO/AEO/GEO finding before creating a repo patch.",
      sourceOwner: sourceOwnerFromFinding(issue),
      automationReadiness: automationReadinessForOwner(sourceOwnerFromFinding(issue), "manual_review"),
      ramsRoutingHint: ramsRoutingHintForOwner(sourceOwnerFromFinding(issue)),
    }));
}

function normaliseDeterministicRemediationLedger(data, issues) {
  const source = isPlainObject(data?.deterministicRemediationLedger) ? data.deterministicRemediationLedger : {};
  const supplied = asArray(source.findings).filter(isPlainObject);
  const findings = supplied.length
    ? supplied.map((row, index) => normaliseLedgerFinding(row, index))
    : buildManualReviewLedgerFromIssues(issues);
  return { findings };
}

function normaliseImplementation(data, issues, payload = {}) {
  const source = isPlainObject(data?.finalVerdictAndImplementationOrder) ? data.finalVerdictAndImplementationOrder : isPlainObject(data?.implementationOrder) ? data.implementationOrder : {};
  const steps = asArray(source.steps || source.implementationSequence).map(String).filter(Boolean);
  const gains = asArray(source.expectedGains).map(String).filter(Boolean);
  const suppliedNarrative = source.narrative || source.finalVerdict || data?.overallVerdict;
  const narrative = isWeakNarrative(suppliedNarrative) ? deriveNarrative(payload, issues) : text(suppliedNarrative, deriveNarrative(payload, issues));

  return {
    narrative,
    steps: (steps.length ? steps : issues.slice(0, 8).map((issue) => `${issue.issueId}: ${issue.exactRemediation}`)).slice(0, 12),
    expectedGains: (gains.length ? gains : issues.slice(0, 5).map((issue) => issue.expectedGain)).slice(0, 8),
  };
}


function issueLooksEvidenceWeak(issue) {
  const evidence = compactString(issue?.evidenceObserved);
  return !evidence || /detected:\s*\.?$/i.test(evidence) || /sample:\s*\.?$/i.test(evidence) || evidence.length < 24;
}

function mergeEvidenceIssues(aiIssues, payload) {
  const deterministic = deterministicIssuesFromPayload(payload).filter((issue) => ["Critical", "High"].includes(issue.severity));
  const byId = new Map();
  for (const issue of aiIssues) byId.set(issue.issueId, issue);
  for (const det of deterministic) {
    const current = byId.get(det.issueId);
    if (!current) {
      byId.set(det.issueId, det);
      continue;
    }
    byId.set(det.issueId, {
      ...current,
      evidenceObserved: issueLooksEvidenceWeak(current) ? det.evidenceObserved : current.evidenceObserved,
      affectedPagesTemplatesFilesOrRoutes: compactString(current.affectedPagesTemplatesFilesOrRoutes) ? current.affectedPagesTemplatesFilesOrRoutes : det.affectedPagesTemplatesFilesOrRoutes,
      exactRemediation: isGenericAdvice(current.exactRemediation) ? det.exactRemediation : current.exactRemediation,
      whyItMatters: compactString(current.whyItMatters) ? current.whyItMatters : det.whyItMatters,
      expectedGain: compactString(current.expectedGain) ? current.expectedGain : det.expectedGain,
      verificationMethod: compactString(current.verificationMethod) ? current.verificationMethod : det.verificationMethod,
    });
  }
  return Array.from(byId.values());
}

function buildCoverageAssurance(payload, pageTypeFindings) {
  const totalDiscovered = asArray(payload?.allRoutes).length || Number(payload?.inventory?.discoveredRouteCount || 0);
  const analysed = asArray(payload?.allRoutes).filter((route) => isAnalysedCoverageState(route.coverageState)).length;
  const excluded = asArray(payload?.allRoutes).filter((route) => String(route.coverageState || "").startsWith("Excluded")).length;
  const failed = asArray(payload?.allRoutes).filter((route) => /failed/i.test(String(route.coverageState || route.status || ""))).length;
  const mandatoryFamilies = ["blog archive", "blog article", "podcast hub", "podcast episode", "podcast transcript", "archive / pagination / utility", "book page", "category / hub", "topic hub"];
  const rows = asArray(pageTypeFindings);
  const byFamily = new Map(rows.map((row) => [compactString(row.pageType).toLowerCase(), row]));
  const incompleteMandatoryFamilies = mandatoryFamilies.filter((family) => {
    const row = byFamily.get(family);
    if (!row) return false;
    return /partial|failed/i.test(String(row.coverageState || ""));
  });
  return {
    totalDiscoveredUrls: totalDiscovered,
    totalAnalysedUrls: analysed,
    totalExcludedUrls: excluded,
    totalFailedUrls: failed,
    mandatoryFamilies,
    incompleteMandatoryFamilies,
    confirmation: incompleteMandatoryFamilies.length
      ? `Material limitation: ${incompleteMandatoryFamilies.join(", ")} did not reach full coverage.`
      : "Every discovered in-scope URL has an explicit coverage state; no mandatory family was reported as partially covered.",
    routeFamiliesNotDeeplyAnalysed: rows.filter((row) => /shared template|template/i.test(String(row.coverageState || ""))).map((row) => row.pageType),
  };
}

function isAnalysedCoverageState(state) {
  return ["Fully analysed", "Analysed through shared template plus page-specific checks"].includes(String(state || ""));
}

function buildSourceReconciliation(payload, sourceLedger, sourceMismatches) {
  return {
    sourceLedger,
    sourceMismatchesThatMatter: sourceMismatches,
    inventory: payload?.inventory || {},
    repoSignals: payload?.repoSignals || {},
    judgement: sourceMismatches.length
      ? "Source conflicts were found and must be resolved before the estate can be treated as fully governed."
      : "No material source conflict was supplied in the audit context package.",
  };
}

function buildFullIssueRecords(issues) {
  return issues.map((issue) => ({
    issueId: issue.issueId,
    severity: issue.severity,
    confidence: issue.confidence,
    auditLens: issue.auditLens,
    rootCauseLevel: issue.rootCauseLevel,
    affectedPagesTemplatesFilesOrRoutes: issue.affectedPagesTemplatesFilesOrRoutes,
    evidenceObserved: issue.evidenceObserved,
    whyItMatters: issue.whyItMatters,
    exactRemediation: issue.exactRemediation,
    expectedGain: issue.expectedGain,
    estimatedEffort: issue.estimatedEffort,
    recommendedOwner: issue.recommendedOwner,
    verificationMethod: issue.verificationMethod,
  }));
}

function buildNormalisedPayload(data, payload) {
  const scoreTable = normaliseScoreTable(data, payload);
  const issues = mergeEvidenceIssues(normaliseIssues(data), payload);
  const implementation = normaliseImplementation(data, issues, payload);
  const executiveSummary = isPlainObject(data?.executiveSummary) ? data.executiveSummary : {};
  const sourceLedger = normaliseSourceLedger(data, payload);
  const sourceMismatches = normaliseSourceMismatches(data, payload);
  const pageTypeFindings = normalisePageTypeFindings(data, payload);

  return {
    auditCompletionState: text(data?.auditCompletionState, "Complete"),
    aiAnalysisStatus: text(data?.aiAnalysisStatus, "valid"),
    executiveSummary: isWeakNarrative(executiveSummary.summary || executiveSummary.overview || data?.executiveSummary)
      ? deriveNarrative(payload, issues)
      : text(executiveSummary.summary || executiveSummary.overview || data?.executiveSummary, deriveNarrative(payload, issues)),
    overallVerdict: isWeakNarrative(data?.overallVerdict || executiveSummary.overallVerdict)
      ? implementation.narrative
      : text(data?.overallVerdict || executiveSummary.overallVerdict, implementation.narrative),
    scoreTable,
    topFivePriorities: asArray(data?.topFivePriorities || executiveSummary.topFivePriorities).map(String).filter(Boolean).slice(0, 5),
    quickWins: asArray(data?.quickWins || executiveSummary.quickWins).map(String).filter(Boolean).slice(0, 6),
    majorRisks: asArray(data?.majorRisks || executiveSummary.majorRisks).map(String).filter(Boolean).slice(0, 8),
    estateLabels: asArray(data?.estateLabels || executiveSummary.estateLabels).map(String).filter(Boolean).slice(0, 10),
    scopeInputsMethod: isPlainObject(data?.scopeInputsMethod) ? data.scopeInputsMethod : { method: text(data?.scopeInputsMethod, "Evidence-led repo, workbook, sitemap, feed, route, and coverage reconciliation.") },
    sourceLedger,
    sourceMismatchesThatMatter: sourceMismatches,
    inventoryReconciliationSummary: isPlainObject(data?.inventoryReconciliationSummary) ? data.inventoryReconciliationSummary : { summary: text(data?.inventoryReconciliationSummary, "Inventory reconciliation derived from supplied route and coverage ledgers.") },
    findingsByAuditLens: normaliseFindings(data?.findingsByAuditLens || data?.findingsByLens),
    rankedIssueLedger: issues,
    fullIssueRecords: buildFullIssueRecords(issues),
    coverageAssurance: buildCoverageAssurance(payload, pageTypeFindings),
    sourceReconciliation: buildSourceReconciliation(payload, sourceLedger, sourceMismatches),
    sourceOwnerMap: buildSourceOwnerMap(payload),
    pageTypeFindings,
    priorityPageAnnex: normalisePriorityPageAnnex(data, payload),
    templateComponentGeneratorAnnex: normaliseTemplateAnnex(data, payload),
    codeMarkupContentRemediationAppendix: [],
    deterministicRemediationLedger: normaliseDeterministicRemediationLedger(data, issues),
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
  if (!asArray(normalised.fullIssueRecords).length) errors.push("fullIssueRecords must not be empty");
  if (!isPlainObject(normalised.coverageAssurance)) errors.push("coverageAssurance must be present");
  if (!isPlainObject(normalised.sourceReconciliation)) errors.push("sourceReconciliation must be present");
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
    fullIssueRecords: normalised.fullIssueRecords,
    coverageAssurance: normalised.coverageAssurance,
    sourceReconciliation: normalised.sourceReconciliation,
    issues: normalised.rankedIssueLedger.map((issue) => ({
      ...issue,
      lens: issue.auditLens,
      affected: issue.affectedPagesTemplatesFilesOrRoutes,
    })),
    templateAnnex: normalised.templateComponentGeneratorAnnex,
    codeRemediationAppendix: normalised.codeMarkupContentRemediationAppendix,
    deterministicFindings: normalised.deterministicRemediationLedger.findings,
    implementationOrder: normalised.finalVerdictAndImplementationOrder,
  };

  return aliased;
}

function validateAndNormaliseAnalysisShape(data, payload = {}) {
  if (!isPlainObject(data)) throw new Error("Analysis response is not a JSON object");
  rejectAuditEvidenceRequestEcho(data);

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
    rejectRawPromptEcho(raw);
    draft = extractJson(raw);
    return validateAndNormaliseAnalysisShape(draft, payload);
  } catch (err) {
    const firstError = err;
    if (err?.code === "AUDIT_AI_PROMPT_ECHO") {
      return buildDeterministicFallback(payload, firstError, new Error("Repair skipped because the provider echoed the prompt/request."));
    }

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

      rejectRawPromptEcho(repairedRaw);
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
  normaliseDeterministicRemediationLedger,
  duplicatePodcastEvidence,
  looksLikeAuditEvidenceRequestPayload,
  looksLikeAuditPromptEchoText,
  rejectRawPromptEcho,
};

export default { runSeoAeoGeoAnalysis };
