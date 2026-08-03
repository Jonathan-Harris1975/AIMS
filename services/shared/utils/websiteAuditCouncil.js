import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright-core";
import { compactWebsiteAuditPolicy } from "./websiteAuditPolicy.js";

export const WEBSITE_AUDIT_COUNCIL_MEMBERS = Object.freeze([
  { seat: 1, role: "Council Chair / Systems Integrator", remit: "Reconcile all three audits, resolve dependencies and produce one implementation order." },
  { seat: 2, role: "Digital Growth Strategist", remit: "Traffic growth, discoverability, cross-channel growth and practical prioritisation." },
  { seat: 3, role: "Personal Brand Monetisation Strategist", remit: "Revenue architecture, audience-to-product pathways and creator-economy economics." },
  { seat: 4, role: "Technical SEO Lead", remit: "Crawlability, indexability, canonicals, redirects, rendering and technical search integrity." },
  { seat: 5, role: "On-Page SEO & Search Intent Lead", remit: "Search intent, titles, metadata, headings, semantic completeness and SERP fit." },
  { seat: 6, role: "Information Architecture & Internal Linking Lead", remit: "Navigation, crawl depth, topical graph, orphaning and link-equity flow." },
  { seat: 7, role: "Answer Engine Optimisation Lead", remit: "Answer-first structure, direct-answer extraction, FAQs and passage clarity." },
  { seat: 8, role: "Generative Engine / LLM Retrieval Lead", remit: "Citation readiness, retrieval usefulness, grounding and generative-search visibility." },
  { seat: 9, role: "Entity, Knowledge Graph & Schema Lead", remit: "Entity clarity, relationships, structured data and machine-readable authority." },
  { seat: 10, role: "Content Strategy & Topical Authority Lead", remit: "Content clusters, coverage gaps, programme quality and authority building." },
  { seat: 11, role: "Editorial Quality & Evidence Lead", remit: "Clarity, substantiation, attribution, trust and editorial usefulness." },
  { seat: 12, role: "Podcast Growth Strategist", remit: "Podcast visibility, episode discovery, transcript leverage and click-through paths." },
  { seat: 13, role: "Newsletter Growth & Email Capture Strategist", remit: "Opt-in visibility, value proposition, form friction and subscriber conversion." },
  { seat: 14, role: "Ebook & Digital Product Conversion Strategist", remit: "Ebook discovery, product positioning, proof and sales-path continuity." },
  { seat: 15, role: "Conversion Rate Optimisation Lead", remit: "CTA hierarchy, funnel friction, persuasion architecture and conversion continuity." },
  { seat: 16, role: "Analytics & Measurement Lead", remit: "Measurement gaps, event design, baselines, KPI definitions and decision quality." },
  { seat: 17, role: "Experimentation & Causal Testing Lead", remit: "Test design, prioritised experiments, causality and guardrails against false attribution." },
  { seat: 18, role: "Mobile UX & Human-Computer Interaction Lead", remit: "Rendered mobile usability, navigation, reflow, touch ergonomics and journey continuity." },
  { seat: 19, role: "Accessibility Lead", remit: "Accessible interaction, semantics, focus, labels, contrast and inclusive usability." },
  { seat: 20, role: "Web Performance & Core Web Vitals Lead", remit: "Performance risk, rendering cost, asset efficiency and user-perceived speed." },
  { seat: 21, role: "Frontend Engineering & Design Systems Lead", remit: "Template/component root causes, maintainable fixes and design-system consistency." },
  { seat: 22, role: "Browser Automation & QA Lead", remit: "Evidence quality, reproducibility, regression testing and rendered verification." },
  { seat: 23, role: "Platform, Cloudflare & Deployment Lead", remit: "Hosting, R2, deployment constraints, reliability and operational safety." },
  { seat: 24, role: "Independent Red-Team Auditor", remit: "Challenge unsupported assumptions, inflated scores, weak evidence and groupthink." },
]);

const SYSTEM_PROMPT = `You chair a 24-seat expert council consolidating three completed or explicitly blocked website audits into ONE final implementation report for jonathan-harris.online.

Council seats are supplied in the input and must all be represented. The source audits are:
1. Digital Growth & Monetisation.
2. Website-estate SEO + AEO + GEO, with /blog and /transcripts delegated to their dedicated R2 pipelines.
3. Mobile UX rendered hard-gate.

Non-negotiable rules:
- Treat supplied evidence as the only source of truth. Never invent analytics, traffic, sales, search volume, browser runs, screenshots, files or test results.
- Preserve explicit uncertainty and audit-stage limitations.
- A blocked or incomplete stage remains a finding, not a reason to fabricate completion.
- Do not score Mobile UX unless the rendered hard gate completed with the required evidence. Use null and "Not Scored - Evidence Gate Not Met" when it did not.
- Deduplicate overlapping symptoms into root-cause findings. Keep source finding IDs/anchors so traceability is preserved.
- Prefer fixes that improve several objectives at once.
- Prioritise confirmed blockers, then high-impact Quick Wins, then medium lifts, then strategic investments.
- Recommendations must be executable by a small team and include exact change, owner, acceptance criterion and verification method.
- The masterIssueLedger is the machine-readable remediation contract consumed by RAMS. Build it deliberately rather than copying prose rows.
- Mark a masterIssueLedger row classification="code_fix" ONLY when ALL of these are true: confidence is exactly Confirmed; the source audits explicitly name one or more exact repository-relative files; affectedPaths contains only those verbatim observed file paths; sourceFindingIds is non-empty; exactRemediation is deterministic; and fixClass is one of the allowed website fix classes in the required JSON shape.
- Never infer a repository file from a URL, route, selector, template family or likely implementation. Never invent affectedPaths. When the source evidence names only a URL/route, use classification="manual_review" and leave affectedPaths empty.
- Use classification="future_guidance" for editorial, strategic or content recommendations that are not a deterministic repository patch. Use classification="manual_review" for anything else that lacks the full code_fix evidence contract.
- R2/AIMS-owned generated podcast or transcript content must not be presented as a static website repository code_fix unless the source evidence explicitly identifies a governed website source file that actually controls the defect.
- The supplied websiteAuditPolicy is binding governance. /blog and /transcripts are deliberately delegated to their dedicated R2 audit pipelines. Their absence from this website audit is NOT a coverage defect and must not reduce website-audit scores. /podcast remains in scope and must be audited as a website route.
- Treat the policy minimumTargetScore (8.5/10) as an acceptance target, never as a score floor. Never inflate a score to meet the target. Explicitly identify any scored area below target or any required area that is unscored because evidence is missing.
- Require live/source deployment parity evidence before merging live-production observations with repository-readiness observations. If /release.json or equivalent SHA parity is missing or mismatched, separate the two states and mark live parity as unverified or below target rather than blending evidence.
- Accessibility assessment must distinguish WCAG 2.2 AA minimum target size (24 CSS px subject to its exceptions) from the preferred 44 CSS px usability target. Require evidence for text contrast, UI component contrast, keyboard use, visible focus, Focus Not Obscured (Minimum), 200% zoom/reflow and text-spacing resilience before claiming strong accessibility.
- Visual/design-system assessment must explicitly cover card/page surface separation, text and button contrast, consistent component radii, template-family spacing/padding, branded hero/header presence, floating-menu lifecycle, third-party embed clipping and typography-system consistency. Do not recommend centre-aligning long-form body text; centralise the typography system, not every paragraph.
- Do not award strong accessibility or visual/design-system scores without structured rendered evidence. If those evidence blocks are missing, leave the corresponding score unscored rather than extrapolating from source HTML.
- Core Web Vitals must prefer field evidence. Good thresholds are LCP <= 2500 ms, INP <= 200 ms and CLS <= 0.1 at the 75th percentile. Lighthouse/lab evidence is diagnostic and must not be presented as field proof.
- For Google AI search features, do not treat llms.txt or special AI markup as ranking requirements. Standard crawl/index eligibility, useful textual content, internal linking and visible-content/structured-data alignment remain primary. llms.txt may be scored only as optional supporting infrastructure. Check OAI-SearchBot crawlability when evidence is supplied.
- Recommend FAQPage schema only when a real visible FAQ/Q&A block exists and the schema matches it. Do not add FAQ schema merely to improve AEO.
- Where Search Console evidence is supplied, use query/page performance and the Generative AI performance report when available. Its absence is a measurement limitation, not an audit failure.
- Validate the governed Jotform and Elfsight contracts from websiteAuditPolicy when rendered evidence is available, including iframe visibility/height, fallback-link hierarchy and exactly-one loader/widget rules.
- Security/platform hygiene must use supplied evidence rather than assumption. Check HTTPS, mixed content, Content-Security-Policy, Strict-Transport-Security, Referrer-Policy, Permissions-Policy, third-party script inventory, iframe permissions and form/privacy surfaces. If this evidence is absent, keep the security/platform score unscored rather than inferring safety from a successful page load.
- Do not repeat the three reports. Synthesize them.
- Use British English and direct language.
- Return JSON only. No markdown fences. No private chain-of-thought.

Council process that must be reflected in councilRecord, without revealing hidden reasoning:
Pass 1: independent specialist review notes.
Pass 2: contradiction and overlap register.
Pass 3: root-cause clustering.
Pass 4: prioritisation vote/outcome.
Pass 5: final deliberation, including dissent and unresolved verification items.

Required JSON shape:
{
  "synthesisState":"Complete|Incomplete",
  "executiveSummary":"...",
  "scorecard":{
    "trafficGrowth":{"score":1,"basis":"...","status":"Scored"},
    "newsletterSignUp":{"score":1,"basis":"...","status":"Scored"},
    "podcastClickThrough":{"score":1,"basis":"...","status":"Scored"},
    "llmDiscoverability":{"score":1,"basis":"...","status":"Scored"},
    "ebookSalesPath":{"score":1,"basis":"...","status":"Scored"},
    "technicalSeo":{"score":1,"basis":"...","status":"Scored"},
    "aeo":{"score":1,"basis":"...","status":"Scored"},
    "geo":{"score":1,"basis":"...","status":"Scored"},
    "entityAuthority":{"score":1,"basis":"...","status":"Scored"},
    "internalLinkingIa":{"score":1,"basis":"...","status":"Scored"},
    "accessibility":{"score":1,"basis":"...","status":"Scored"},
    "visualDesignSystemConsistency":{"score":1,"basis":"...","status":"Scored"},
    "coreWebVitalsPerformance":{"score":null,"basis":"...","status":"Not Scored - Evidence Not Supplied"},
    "structuredData":{"score":1,"basis":"...","status":"Scored"},
    "deploymentLiveParity":{"score":1,"basis":"...","status":"Scored"},
    "linkConversionRouteIntegrity":{"score":1,"basis":"...","status":"Scored"},
    "securityPlatformHygiene":{"score":null,"basis":"...","status":"Not Scored - Evidence Not Supplied"},
    "mobileUx":{"score":null,"basis":"...","status":"Not Scored - Evidence Gate Not Met"},
    "councilConfidence":{"score":1,"basis":"...","status":"Scored"}
  },
  "councilVerdict":{"overallDiagnosis":"...","strongestAssets":["..."],"biggestStructuralWeakness":"...","biggestCommercialOpportunity":"...","biggestSearchOpportunity":"...","biggestMobileRisk":"...","greatestCrossObjectiveLever":"..."},
  "topActions":[{"rank":1,"actionId":"A-01","exactChange":"...","objectives":["..."],"affected":["..."],"impact":"Very High|High|Medium|Low","effort":"Quick Win|Medium Lift|Strategic Investment","confidence":"Confirmed|Probable|Needs Verification","dependency":"...","owner":"...","acceptanceCriterion":"...","verificationMethod":"...","priorityScore":100,"dissentNote":"","sourceFindingIds":["..."]}],
  "quickWins":[],
  "blockers":[],
  "unifiedFindings":[{"findingId":"U-001","title":"...","rootCause":"...","severity":"Critical|High|Medium|Low","confidence":"Confirmed|Probable|Needs Verification","affected":["..."],"evidence":["..."],"objectives":["..."],"exactRemediation":"...","expectedGain":"...","effort":"Quick Win|Medium Lift|Strategic Investment","owner":"...","acceptanceCriterion":"...","verificationMethod":"...","sourceFindingIds":["..."]}],
  "conflicts":[{"topic":"...","positions":["..."],"resolution":"...","confidence":"..."}],
  "funnelMap":[{"journey":"...","currentFriction":"...","exactChange":"...","measurement":"..."}],
  "keywordOpportunities":[{"topic":"...","intent":"...","targetPageOrGap":"...","action":"...","confidence":"..."}],
  "implementationProgramme":{"days0to14":[],"days15to30":[],"days31to60":[],"days61to90":[]},
  "measurementPlan":[{"objective":"...","metric":"...","eventOrSource":"...","baseline":"Not supplied|...","successCriterion":"..."}],
  "gapMatrix":[{"area":"...","currentState":"...","targetState":"...","priority":"...","owner":"..."}],
  "masterIssueLedger":[{
    "findingId":"U-001",
    "title":"...",
    "rootCause":"...",
    "severity":"Critical|High|Medium|Low",
    "confidence":"Confirmed|Probable|Needs Verification",
    "classification":"code_fix|manual_review|future_guidance",
    "fixClass":"html_fix|css_fix|meta_fix|schema_fix|structured_data_fix|canonical_fix|redirect_fix|crawler_fix|sitemap_fix|robots_fix|llms_fix|accessibility_fix|template_fix|partial_fix|internal_link_fix|viewport_fix|",
    "affected":["URL, route, template or human-readable scope"],
    "affectedPaths":["exact/repo-relative/file.ext"],
    "evidence":["specific observed evidence"],
    "exactRemediation":"...",
    "expectedGain":"...",
    "effort":"Quick Win|Medium Lift|Strategic Investment",
    "owner":"...",
    "acceptanceCriterion":"...",
    "verificationMethod":"...",
    "sourceFindingIds":["source-audit-finding-id"]
  }],
  "councilRecord":{"seats":[{"seat":1,"role":"...","reviewNote":"..."}],"majorVotes":[{"decision":"...","outcome":"..."}],"dissent":[],"rejectedAssumptions":[],"unresolvedVerificationItems":[]},
  "definitionOfDone":[]
}`;

function arr(value) { return Array.isArray(value) ? value : []; }
function obj(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function text(value) { return String(value ?? "").trim(); }
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function clamp(value, min, max, fallback = null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function mobileQualityScoreOutOfTen(value) {
  const score = Number(value) / 10;
  if (!Number.isFinite(score)) return null;
  return Math.round(Math.max(1, Math.min(10, score)) * 10) / 10;
}

function firstCompleteJsonObject(value) {
  const source = String(value || "");
  for (let start = source.indexOf("{"); start >= 0; start = source.indexOf("{", start + 1)) {
    let depth = 0; let inString = false; let escaped = false;
    for (let i = start; i < source.length; i += 1) {
      const char = source[i];
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
        if (depth === 0) return source.slice(start, i + 1);
      }
    }
  }
  return "";
}

function parseJsonResponse(raw) {
  const cleaned = text(raw).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!cleaned) throw new Error("Website audit council returned an empty response");
  try { return JSON.parse(cleaned); } catch {}
  const candidate = firstCompleteJsonObject(cleaned);
  if (!candidate) throw new Error("Website audit council response did not contain a complete JSON object");
  return JSON.parse(candidate);
}

function compactDigital(report = {}) {
  const source = obj(report);
  const analysis = obj(source.analysis || source.digitalGrowthAnalysis || source.result?.analysis);
  const evidence = obj(source.evidenceSummary || source.evidence);
  const repo = obj(evidence.repoSignals);
  const ebookRows = arr(repo.ebookSalesPathEvidence).map((row) => ({
    route: row?.route,
    file: row?.file,
    salesLinks: arr(row?.salesLinks).slice(0, 6),
    hasPriceSignal: row?.hasPriceSignal,
    hasProofSignal: row?.hasProofSignal,
    hasSampleSignal: row?.hasSampleSignal,
  }));
  return {
    status: source.status || "unknown",
    analysisCompletionState: analysis.auditCompletionState || source.auditCompletionState || null,
    jobError: source.jobError || source.error || null,
    workflowRunUrl: source.workflowRunUrl || null,
    reportJsonUrl: source.reportJsonUrl || null,
    callbackDiagnostics: source.callbackDiagnostics || null,
    scorecard: analysis.scorecard || source.scorecard || {},
    overallVerdict: analysis.overallVerdict || source.overallVerdict || "",
    findings: arr(analysis.findings || source.findings || source.heuristicIssues).slice(0, 80),
    topActions: arr(analysis.executiveSummary?.top10Actions || source.executiveSummary?.top10Actions).slice(0, 10),
    dynamicKeywordStrategy: arr(analysis.dynamicKeywordStrategy || source.dynamicKeywordStrategy).slice(0, 40),
    highValueOpportunities: arr(analysis.highValueOpportunities || source.highValueOpportunities).slice(0, 30),
    limitations: arr(analysis.limitations || source.limitations || evidence.limitations).slice(0, 30),
    sourceRevisionSha: source.sourceRevisionSha || evidence.sourceRevisionSha || null,
    liveReleaseSha: source.liveReleaseSha || evidence.liveReleaseSha || null,
    liveSourceParity: source.liveSourceParity || evidence.liveSourceParity || "unverified",
    searchConsoleEvidence: source.searchConsoleEvidence || evidence.searchConsoleEvidence || null,
    accessibilityEvidence: source.accessibilityEvidence || evidence.accessibilityEvidence || null,
    visualDesignEvidence: source.visualDesignEvidence || evidence.visualDesignEvidence || null,
    performanceEvidence: source.performanceEvidence || evidence.performanceEvidence || null,
    securityEvidence: source.securityEvidence || evidence.securityEvidence || null,
    evidenceSummary: {
      inventory: evidence.inventory || source.inventory || {},
      priorityPages: arr(evidence.priorityPages || source.priorityPages).slice(0, 25).map((page) => ({
        route: page?.route, status: page?.status, title: page?.title, metaDescription: page?.metaDescription, h1: page?.h1,
        schemaTypes: page?.schemaTypes, forms: arr(page?.forms).slice(0, 6), ctas: arr(page?.ctas).slice(0, 15), headings: arr(page?.headings).slice(0, 12),
      })),
      repoSignals: {
        routeCount: repo.routeCount, relevantFilesPresent: repo.relevantFilesPresent, keywordReferenceCounts: repo.keywordReferenceCounts,
        ebookSalesPathEvidence: ebookRows,
      },
    },
  };
}

function compactSeo(report = {}) {
  const source = obj(report);
  const analysis = obj(source.analysis || source.claudeAnalysis || source.aiAnalysis);
  const coverage = obj(source.coverage);
  return {
    status: source.status || "unknown",
    auditCompletionState: coverage.auditCompletionState || analysis.auditCompletionState || source.auditCompletionState || null,
    jobError: source.jobError || source.error || null,
    workflowRunUrl: source.workflowRunUrl || null,
    reportJsonUrl: source.reportJsonUrl || null,
    callbackDiagnostics: source.callbackDiagnostics || null,
    scores: analysis.scores || analysis.scoreTable || source.scores || source.scoreTable || {},
    executiveSummary: analysis.executiveSummary || source.summary || {},
    rankedIssueLedger: arr(analysis.rankedIssueLedger || analysis.issues || source.heuristicIssues).slice(0, 100),
    fullIssueRecords: arr(analysis.fullIssueRecords || analysis.issueRecords).slice(0, 100),
    bestPracticeGapMatrix: arr(analysis.bestPracticeGapMatrix || analysis.gapMatrix).slice(0, 60),
    pageTypeFindings: arr(analysis.pageTypeFindings).slice(0, 60),
    sourceMismatches: arr(source.sourceMismatchesThatMatter || coverage.sourceMismatchesThatMatter).slice(0, 60),
    familyDiagnostics: arr(source.familyDiagnostics || coverage.familyDiagnostics).slice(0, 60),
    coverageSummary: arr(coverage.pageFamilyCoverage || source.pageFamilyCoverage).slice(0, 60),
    limitations: arr(analysis.limitations || source.limitations).slice(0, 40),
    sourceRevisionSha: source.sourceRevisionSha || null,
    liveReleaseSha: source.liveReleaseSha || null,
    liveSourceParity: source.liveSourceParity || "unverified",
    searchConsoleEvidence: source.searchConsoleEvidence || null,
    accessibilityEvidence: source.accessibilityEvidence || null,
    visualDesignEvidence: source.visualDesignEvidence || null,
    performanceEvidence: source.performanceEvidence || null,
    securityEvidence: source.securityEvidence || null,
  };
}

function compactMobile(report = {}) {
  const source = obj(report);
  const summary = obj(source.summary);
  const coverage = obj(source.coverage);
  const control = obj(source.reportControl || source.control || summary.reportControl);
  const releaseVerdict = source.releaseVerdict || summary.releaseVerdict || null;
  return {
    status: source.status || summary.status || "unknown",
    auditCompletionState: coverage.auditCompletionState || summary.auditCompletionState || null,
    jobError: source.jobError || source.error || null,
    workflowRunUrl: source.workflowRunUrl || null,
    reportJsonUrl: source.reportJsonUrl || null,
    callbackDiagnostics: source.callbackDiagnostics || null,
    hardGateBlocked: Boolean(
      source.hardGateBlocked === true
      || summary.hardGateBlocked === true
      || text(releaseVerdict).toUpperCase() === "BLOCKED"
    ),
    mobileQualityScore: source.mobileQualityScore ?? summary.mobileQualityScore ?? null,
    releaseVerdict,
    screenshotCount: source.screenshotCount ?? summary.screenshotCount ?? control.screenshotCount ?? null,
    mobileFailureCount: source.mobileFailureCount ?? summary.mobileFailureCount ?? control.mobileFailuresCount ?? null,
    capabilities: source.capabilities || summary.capabilities || {},
    sourceRevisionSha: source.sourceRevisionSha || summary.sourceRevisionSha || null,
    liveReleaseSha: source.liveReleaseSha || summary.liveReleaseSha || null,
    liveReleaseMarkerUrl: source.liveReleaseMarkerUrl || summary.liveReleaseMarkerUrl || null,
    liveSourceParity: source.liveSourceParity || summary.liveSourceParity || "unverified",
    accessibilityEvidence: source.accessibilityEvidence || summary.accessibilityEvidence || null,
    visualDesignEvidence: source.visualDesignEvidence || summary.visualDesignEvidence || null,
    performanceEvidence: source.performanceEvidence || summary.performanceEvidence || null,
    securityEvidence: source.securityEvidence || summary.securityEvidence || null,
    stage3Blocks: arr(source.stage3Blocks || summary.stage3Blocks || coverage.stage3Blocks).slice(0, 40),
    criticalBlockers: arr(source.criticalBlockers || summary.criticalBlockers).slice(0, 60),
    rootCauseGroups: arr(source.technicalRootCauseGroups || source.rootCauseGroups || summary.technicalRootCauseGroups || summary.rootCauseGroups).slice(0, 80),
    findings: arr(source.findings || source.issues || summary.findings || summary.issues).slice(0, 100),
    reportControl: control,
    coverageSummary: {
      complete: coverage.complete,
      auditCompletionState: coverage.auditCompletionState,
      totalUrls: coverage.totalUrls ?? coverage.totalDiscoveredUrls,
      renderedUrlsChecked: coverage.renderedUrlsChecked,
      viewportRuns: coverage.viewportRuns,
      skippedRequiredTasksCount: coverage.skippedRequiredTasksCount,
      stage3Blocks: arr(coverage.stage3Blocks).slice(0, 40),
    },
  };
}

export function compactWebsiteAuditInputs(stageReports = {}) {
  return {
    councilMembers: WEBSITE_AUDIT_COUNCIL_MEMBERS,
    websiteAuditPolicy: compactWebsiteAuditPolicy(),
    digitalGrowth: compactDigital(stageReports.digitalGrowth),
    seoAeoGeo: compactSeo(stageReports.seoAeoGeo),
    mobileUx: compactMobile(stageReports.mobileUx),
  };
}

const STAGE_DEFINITIONS = Object.freeze([
  {
    key: "digitalGrowth",
    label: "Digital Growth & Monetisation",
    scoreKeys: ["trafficGrowth", "newsletterSignUp", "podcastClickThrough", "llmDiscoverability", "ebookSalesPath", "linkConversionRouteIntegrity"],
  },
  {
    key: "seoAeoGeo",
    label: "Website SEO / AEO / GEO",
    scoreKeys: ["technicalSeo", "aeo", "geo", "entityAuthority", "internalLinkingIa", "structuredData"],
  },
  {
    key: "mobileUx",
    label: "Rendered Mobile UX Hard-Gate",
    scoreKeys: ["mobileUx"],
  },
]);

function serialiseJobError(value) {
  if (!value) return "";
  if (typeof value === "string") return text(value);
  const source = obj(value);
  return text(source.message || source.error || source.reason || JSON.stringify(source));
}

function stageCompletionState(stage) {
  return text(stage?.analysisCompletionState || stage?.auditCompletionState).toLowerCase();
}

function stageEvidenceContractErrors(definition, stage) {
  const errors = [];
  if (!text(stage.reportJsonUrl)) errors.push("report.json URL was not supplied");

  if (definition.key === "digitalGrowth") {
    const scoreRows = Object.keys(obj(stage.scorecard)).length;
    const substantiveRows = arr(stage.findings).length + arr(stage.topActions).length + arr(stage.highValueOpportunities).length;
    if (!scoreRows) errors.push("Digital Growth scorecard is empty");
    if (!substantiveRows && !text(stage.overallVerdict)) errors.push("Digital Growth analysis contains no verdict, findings, opportunities or actions");
  }

  if (definition.key === "seoAeoGeo") {
    const scoreRows = Object.keys(obj(stage.scores)).length;
    const summaryRows = Object.keys(obj(stage.executiveSummary)).length;
    const substantiveRows = arr(stage.rankedIssueLedger).length
      + arr(stage.fullIssueRecords).length
      + arr(stage.bestPracticeGapMatrix).length
      + arr(stage.pageTypeFindings).length;
    if (!arr(stage.coverageSummary).length) errors.push("SEO/AEO/GEO coverage ledger is empty");
    if (!scoreRows && !summaryRows && !substantiveRows) errors.push("SEO/AEO/GEO machine-readable analysis is empty");
  }

  if (definition.key === "mobileUx") {
    if (stage.coverageSummary?.complete !== true) errors.push("Mobile UX rendered coverage is not complete");
    if (!Number.isFinite(Number(stage.mobileQualityScore))) errors.push("Mobile UX quality score is missing");
    if (!Number.isFinite(Number(stage.screenshotCount)) || Number(stage.screenshotCount) <= 0) errors.push("Mobile UX screenshot evidence is missing");
  }

  return errors;
}

export function evaluateWebsiteAuditStageHealth(stageReports = {}) {
  const input = stageReports?.councilMembers ? stageReports : compactWebsiteAuditInputs(stageReports);
  const stages = STAGE_DEFINITIONS.map((definition) => {
    const stage = obj(input[definition.key]);
    const status = text(stage.status || "unknown").toLowerCase();
    const completionState = stageCompletionState(stage);
    const evidenceContractErrors = stageEvidenceContractErrors(definition, stage);
    // A Mobile UX release gate can be BLOCKED while the audit itself has
    // completed successfully and supplied its full rendered evidence.  That is
    // a release finding, not a source-stage execution failure.
    const completed = status === "completed"
      && completionState === "complete"
      && evidenceContractErrors.length === 0;
    const callback = obj(stage.callbackDiagnostics);
    const callbackDetail = [
      callback.error || callback.message,
      callback.failedStep ? `Failed step: ${callback.failedStep}.` : "",
      callback.exitCode !== null && callback.exitCode !== undefined ? `Exit code: ${callback.exitCode}.` : "",
    ].map(text).filter(Boolean).join(" ");
    const error = serialiseJobError(stage.jobError) || callbackDetail;
    const reason = completed
      ? ""
      : error || (completionState && completionState !== "complete"
        ? `Audit completion state was ${completionState}.`
        : evidenceContractErrors.length
            ? `Evidence contract failed: ${evidenceContractErrors.join("; ")}.`
            : `Child job status was ${status || "unknown"}.`);
    return {
      ...definition,
      status: status || "unknown",
      completionState: completionState || null,
      completed,
      reason,
      workflowRunUrl: stage.workflowRunUrl || callback.workflowRunUrl || null,
      reportJsonUrl: stage.reportJsonUrl || null,
      callbackDiagnostics: callback,
      evidenceContractErrors,
    };
  });
  return {
    ok: stages.every((stage) => stage.completed),
    stages,
    failures: stages.filter((stage) => !stage.completed),
  };
}

function uniqueByText(items) {
  const seen = new Set();
  return arr(items).filter((item) => {
    const key = typeof item === "string" ? text(item) : text(item?.blocker || item?.title || item?.description || JSON.stringify(item));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stageFailureFinding(stage, index) {
  const detail = stage.reason || `Child stage status was ${stage.status}.`;
  const callback = obj(stage.callbackDiagnostics);
  const forensicEvidence = [
    detail,
    callback.failedStep ? `Failed step: ${callback.failedStep}` : "",
    callback.exitCode !== null && callback.exitCode !== undefined ? `Exit code: ${callback.exitCode}` : "",
    callback.workflowLogTail ? `Workflow log tail: ${text(callback.workflowLogTail).slice(-4000)}` : "",
    stage.workflowRunUrl,
  ].filter(Boolean);
  return {
    findingId: `AUD-STAGE-${String(index + 1).padStart(3, "0")}`,
    title: `${stage.label} did not complete`,
    rootCause: `${stage.label} source stage failure`,
    severity: "Critical",
    confidence: "Confirmed",
    affected: [stage.label],
    evidence: forensicEvidence,
    exactRemediation: "Inspect the retained child-stage callback, workflow run and artefacts; fix the exact failing command; then rerun the complete website audit pipeline.",
    effort: "Strategic Investment",
    owner: "Council Chair / Systems Integrator (Seat 1)",
    acceptanceCriterion: `${stage.label} finishes with status completed and a complete evidence contract.`,
    verificationMethod: "Rerun the child workflow and verify its complete callback and required artefacts before final synthesis.",
    classification: "manual_review",
    affectedPaths: [],
    sourceFindingIds: [],
  };
}

export function enforceCouncilInvariants(councilValue, stageReports = {}) {
  const council = obj(councilValue);
  const health = evaluateWebsiteAuditStageHealth(stageReports);
  if (health.ok) return council;

  const scorecard = { ...obj(council.scorecard) };
  for (const stage of health.failures) {
    for (const key of stage.scoreKeys) {
      scorecard[key] = {
        score: null,
        status: "Not Scored - Source Audit Incomplete",
        basis: `${stage.label} did not complete. ${stage.reason} Scoring from partial or failed evidence is prohibited.`,
      };
    }
  }
  const existingConfidence = Number(scorecard.councilConfidence?.score);
  scorecard.councilConfidence = {
    score: Number.isFinite(existingConfidence) ? Math.min(3, Math.max(1, Math.round(existingConfidence))) : 2,
    status: "Scored - Incomplete Evidence",
    basis: `${health.failures.length} of ${health.stages.length} required source audit stage(s) did not complete. The report is a controlled failure record, not a complete website assessment.`,
  };

  const blockers = health.failures.map((stage) => ({
    blocker: `${stage.label} did not complete`,
    description: stage.reason,
    status: stage.status,
    workflowRunUrl: stage.workflowRunUrl,
    reportJsonUrl: stage.reportJsonUrl,
  }));
  const unresolved = health.failures.map((stage) => `${stage.label}: establish the exact failing command from the retained callback/workflow evidence and rerun to completion.`);
  const failureFindings = health.failures.map(stageFailureFinding);

  const normaliseWorkflowConfidence = (item) => {
    const row = { ...obj(item) };
    const title = text(row.title || row.rootCause || row.issue).toLowerCase();
    if (title.includes("workflow") && title.includes("failure") && !arr(row.evidence).some((entry) => /traceback|exit code|failed command|exception/i.test(text(entry)))) {
      row.confidence = "Needs Verification";
      row.exactRemediation = text(row.exactRemediation || row.remediation) || "Inspect retained workflow diagnostics before defining a code change.";
    }
    return row;
  };

  const record = obj(council.councilRecord);
  const result = {
    ...council,
    synthesisState: "Incomplete",
    executiveSummary: `CONTROLLED AUDIT FAILURE: ${health.failures.length} required source stage(s) did not complete. No complete website verdict may be issued until those stages rerun successfully. ${text(council.executiveSummary)}`.trim(),
    scorecard,
    blockers: uniqueByText([...blockers, ...arr(council.blockers)]),
    unifiedFindings: [...failureFindings, ...arr(council.unifiedFindings).map(normaliseWorkflowConfidence)].slice(0, 160),
    masterIssueLedger: [...failureFindings, ...arr(council.masterIssueLedger).map(normaliseWorkflowConfidence)].slice(0, 200),
    councilRecord: {
      ...record,
      unresolvedVerificationItems: uniqueByText([...unresolved, ...arr(record.unresolvedVerificationItems)]).slice(0, 80),
      rejectedAssumptions: uniqueByText([
        "A polished final report is not proof that its source audits completed.",
        "A failed GitHub Actions job confirms the failure event, not its underlying code-level root cause.",
        ...arr(record.rejectedAssumptions),
      ]).slice(0, 50),
    },
    definitionOfDone: uniqueByText([
      ...health.failures.map((stage) => `${stage.label} completes and publishes its full required evidence contract.`),
      "The parent pipeline reaches completed only when every required source stage is complete, temporary evidence is retained until RAMS accepts the valid report, and all report formats agree on synthesis state.",
      ...arr(council.definitionOfDone),
    ]).slice(0, 80),
  };
  result.targetAssessment = buildTargetAssessment(scorecard);
  return result;
}

function normaliseScoreRow(row, allowNull = true) {
  const source = obj(row);
  const hasScore = source.score !== null && source.score !== undefined && source.score !== "" && Number.isFinite(Number(source.score));
  return {
    score: hasScore ? clamp(source.score, 1, 10, 1) : null,
    basis: text(source.basis || source.rationale) || (hasScore ? "No separate basis was returned by the council." : "The council did not return a defensible score."),
    status: text(source.status) || (hasScore ? "Scored" : (allowNull ? "Not Scored" : "Not Scored")),
  };
}

function buildTargetAssessment(scorecard) {
  const target = Number(compactWebsiteAuditPolicy().minimumTargetScore || 8.5);
  const areas = Object.entries(scorecard || {}).map(([key, row]) => {
    const hasScore = row?.score !== null && row?.score !== undefined && row?.score !== "" && Number.isFinite(Number(row.score));
    return {
      key,
      score: hasScore ? Number(row.score) : null,
      status: row?.status || "Not Scored",
      meetsTarget: hasScore ? Number(row.score) >= target : false,
    };
  });
  return {
    target,
    areas,
    belowTarget: areas.filter((row) => row.score !== null && row.score < target).map((row) => row.key),
    unscored: areas.filter((row) => row.score === null).map((row) => row.key),
    overallMeetsTarget: areas.length > 0 && areas.every((row) => row.score !== null && row.meetsTarget),
  };
}

function normaliseCouncil(data, stageReports) {
  const source = obj(data);
  const input = compactWebsiteAuditInputs(stageReports);
  const mobile = input.mobileUx;
  const mobileScorable = mobile.status === "completed" && Number.isFinite(Number(mobile.mobileQualityScore));
  const score = obj(source.scorecard);
  const keys = ["trafficGrowth", "newsletterSignUp", "podcastClickThrough", "llmDiscoverability", "ebookSalesPath", "technicalSeo", "aeo", "geo", "entityAuthority", "internalLinkingIa", "accessibility", "visualDesignSystemConsistency", "coreWebVitalsPerformance", "structuredData", "deploymentLiveParity", "linkConversionRouteIntegrity", "securityPlatformHygiene", "councilConfidence"];
  const scorecard = Object.fromEntries(keys.map((key) => [key, normaliseScoreRow(score[key])]));
  scorecard.mobileUx = mobileScorable
    ? {
        score: mobileQualityScoreOutOfTen(mobile.mobileQualityScore),
        basis: mobile.hardGateBlocked
          ? `Rendered Mobile UX audit completed with source score ${mobile.mobileQualityScore}/100 and release verdict ${mobile.releaseVerdict || "BLOCKED"}.`
          : `Rendered Mobile UX audit completed with source score ${mobile.mobileQualityScore}/100.`,
        status: mobile.hardGateBlocked ? "Scored - Release Hard Gate Blocked" : "Scored from completed rendered evidence",
      }
    : { score: null, basis: "Rendered Mobile UX evidence gate did not complete with a score; council scoring is prohibited.", status: "Not Scored - Evidence Gate Not Met" };

  const hasAccessibilityEvidence = Boolean(input.mobileUx.accessibilityEvidence || input.digitalGrowth.accessibilityEvidence || input.seoAeoGeo.accessibilityEvidence);
  if (!hasAccessibilityEvidence) {
    scorecard.accessibility = { score: null, basis: "No structured WCAG 2.2 rendered accessibility evidence was supplied. Accessibility must not be inferred from markup or a successful mobile render alone.", status: "Not Scored - Accessibility Evidence Not Supplied" };
  }

  const hasVisualDesignEvidence = Boolean(input.mobileUx.visualDesignEvidence || input.digitalGrowth.visualDesignEvidence || input.seoAeoGeo.visualDesignEvidence);
  if (!hasVisualDesignEvidence) {
    scorecard.visualDesignSystemConsistency = { score: null, basis: "No structured rendered design-system evidence was supplied for surfaces, contrast, spacing, radii, hero/header state, floating-menu lifecycle or embedded content.", status: "Not Scored - Visual Evidence Not Supplied" };
  }

  const parityStates = [input.digitalGrowth.liveSourceParity, input.seoAeoGeo.liveSourceParity, input.mobileUx.liveSourceParity]
    .map((value) => text(value).toLowerCase())
    .filter((value) => ["matched", "mismatched"].includes(value));
  if (parityStates.includes("mismatched")) {
    scorecard.deploymentLiveParity = { score: 1, basis: "At least one source audit reports a live /release.json SHA that does not match the audited source revision. Live and repository findings must remain separate.", status: "Scored - Mismatched" };
  } else if (parityStates.length && parityStates.every((value) => value === "matched")) {
    scorecard.deploymentLiveParity = { score: 10, basis: "Available source audits confirm the live release marker matches the audited source revision.", status: "Scored - Matched" };
  } else {
    scorecard.deploymentLiveParity = { score: null, basis: "Release-marker SHA parity was not verified in the supplied audit evidence; live and repository observations must not be blended.", status: "Not Scored - Release SHA Not Verified" };
  }

  const hasPerformanceEvidence = Boolean(input.mobileUx.performanceEvidence || input.digitalGrowth.performanceEvidence || input.seoAeoGeo.performanceEvidence);
  if (!hasPerformanceEvidence) {
    scorecard.coreWebVitalsPerformance = { score: null, basis: "No field Core Web Vitals evidence was supplied. Lighthouse/lab diagnostics alone are not field proof.", status: "Not Scored - Field Evidence Not Supplied" };
  }

  const hasSecurityEvidence = Boolean(input.mobileUx.securityEvidence || input.digitalGrowth.securityEvidence || input.seoAeoGeo.securityEvidence);
  if (!hasSecurityEvidence) {
    scorecard.securityPlatformHygiene = { score: null, basis: "No security/platform header and mixed-content evidence was supplied. A successful page load is not proof of a sound security-header posture.", status: "Not Scored - Security Evidence Not Supplied" };
  }

  const record = obj(source.councilRecord);
  const returnedSeats = arr(record.seats);
  const seats = WEBSITE_AUDIT_COUNCIL_MEMBERS.map((member) => {
    const found = returnedSeats.find((item) => Number(item?.seat) === member.seat || text(item?.role) === member.role) || {};
    return { seat: member.seat, role: member.role, reviewNote: text(found.reviewNote) || "Seat represented in the council synthesis; no separate note was returned." };
  });

  const normalised = {
    synthesisState: text(source.synthesisState) || "Incomplete",
    executiveSummary: text(source.executiveSummary) || "The council response was structurally incomplete and cannot be treated as a final synthesis.",
    scorecard,
    targetAssessment: buildTargetAssessment(scorecard),
    councilVerdict: obj(source.councilVerdict),
    topActions: arr(source.topActions).slice(0, 20),
    quickWins: arr(source.quickWins).slice(0, 30),
    blockers: uniqueByText([
      ...(mobile.hardGateBlocked ? [{
        blocker: "Mobile UX release hard gate blocked",
        description: `Rendered evidence completed with release verdict ${mobile.releaseVerdict || "BLOCKED"} and source score ${mobile.mobileQualityScore ?? "not supplied"}/100.`,
        status: "blocked",
        reportJsonUrl: mobile.reportJsonUrl || null,
      }] : []),
      ...arr(source.blockers),
    ]).slice(0, 30),
    unifiedFindings: arr(source.unifiedFindings).slice(0, 160),
    conflicts: arr(source.conflicts).slice(0, 60),
    funnelMap: arr(source.funnelMap).slice(0, 60),
    keywordOpportunities: arr(source.keywordOpportunities).slice(0, 80),
    implementationProgramme: obj(source.implementationProgramme),
    measurementPlan: arr(source.measurementPlan).slice(0, 80),
    gapMatrix: arr(source.gapMatrix).slice(0, 80),
    masterIssueLedger: arr(source.masterIssueLedger).slice(0, 200),
    councilRecord: {
      seats,
      majorVotes: arr(record.majorVotes).slice(0, 50),
      dissent: arr(record.dissent).slice(0, 50),
      rejectedAssumptions: arr(record.rejectedAssumptions).slice(0, 50),
      unresolvedVerificationItems: arr(record.unresolvedVerificationItems).slice(0, 80),
    },
    definitionOfDone: arr(source.definitionOfDone).slice(0, 80),
  };
  return enforceCouncilInvariants(normalised, stageReports);
}

function councilHasRequiredSubstance(councilValue) {
  const council = obj(councilValue);
  const verdict = obj(council.councilVerdict);
  const scoredRows = Object.values(obj(council.scorecard)).filter((row) => Number.isFinite(Number(row?.score))).length;
  const decisionRows = arr(council.topActions).length
    + arr(council.unifiedFindings).length
    + arr(council.masterIssueLedger).length
    + arr(council.measurementPlan).length
    + arr(council.definitionOfDone).length;
  return text(council.executiveSummary).length >= 40
    && Object.keys(verdict).length > 0
    && scoredRows > 0
    && decisionRows > 0;
}

function deterministicFinding(item, stageKey, index) {
  const source = obj(item);
  const affectedRaw = source.affected ?? source.affectedPagesTemplatesFilesOrRoutes ?? source.affectedPages ?? source.location ?? source.route ?? source.url ?? source.path ?? "";
  const affected = Array.isArray(affectedRaw) ? affectedRaw : (text(affectedRaw) ? [text(affectedRaw)] : []);
  const sourceId = text(source.findingId || source.issueId || source.groupId || source.id) || `${stageKey.toUpperCase()}-${String(index + 1).padStart(3, "0")}`;
  return {
    findingId: sourceId,
    title: text(source.title || source.rootCause || source.issue || source.defectDescription || source.check || source.judgement) || `${stageKey} audit finding`,
    rootCause: text(source.rootCause || source.title || source.issue || source.check) || `${stageKey} source finding`,
    severity: text(source.severity || source.priority) || "Medium",
    confidence: text(source.confidence || source.findingConfidence) || "Needs Verification",
    affected,
    evidence: arr(source.evidence || source.evidenceAnchors || source.observations).slice(0, 20),
    exactRemediation: text(source.exactRemediation || source.exactChange || source.remediation || source.requiredOutcome || source.recommendedFix) || "Review the retained source-stage evidence and implement the smallest verified change.",
    effort: text(source.effort || source.estimatedEffort) || "Needs estimation",
    owner: text(source.owner || source.recommendedOwner || source.ownerClass) || "Website owner",
    acceptanceCriterion: text(source.acceptanceCriterion) || "The source-stage verification passes after deployment.",
    verificationMethod: text(source.verificationMethod) || "Rerun the affected source audit and compare the retained evidence.",
    classification: text(source.classification) || "manual_review",
    affectedPaths: arr(source.affectedPaths).slice(0, 20),
    sourceFindingIds: uniqueByText([sourceId, ...arr(source.sourceFindingIds)]),
  };
}

function deterministicFallback(stageReports, errorMessage) {
  const compact = compactWebsiteAuditInputs(stageReports);
  const health = evaluateWebsiteAuditStageHealth(stageReports);
  const mobileScorable = compact.mobileUx.status === "completed" && Number.isFinite(Number(compact.mobileUx.mobileQualityScore));
  const numericScore = (value) => {
    if (value && typeof value === "object") value = value.score ?? value.value;
    let score = Number(value);
    if (!Number.isFinite(score)) return null;
    // SEO/AEO/GEO source reports use a 0-100 scale; the unified council scorecard uses 1-10.
    if (score > 10) score /= 10;
    return Math.round(Math.max(1, Math.min(10, score)) * 10) / 10;
  };
  const scoreRow = (value, basis) => {
    const score = numericScore(value);
    return { score, basis, status: score === null ? "Not Scored - Source Evidence Did Not Supply a Defensible Score" : "Scored from completed source-stage evidence" };
  };
  const digitalScore = (key) => obj(compact.digitalGrowth.scorecard)[key];
  const seoScore = (key) => obj(compact.seoAeoGeo.scores)[key];

  const sourceFindings = [
    ...arr(compact.digitalGrowth.findings).map((item, index) => deterministicFinding(item, "digital-growth", index)),
    ...arr(compact.seoAeoGeo.rankedIssueLedger).map((item, index) => deterministicFinding(item, "seo-aeo-geo", index)),
    ...arr(compact.seoAeoGeo.fullIssueRecords).map((item, index) => deterministicFinding(item, "seo-aeo-geo-detail", index)),
    ...arr(compact.mobileUx.rootCauseGroups).map((item, index) => deterministicFinding(item, "mobile-ux", index)),
    ...arr(compact.mobileUx.findings).map((item, index) => deterministicFinding(item, "mobile-ux-detail", index)),
  ];
  const issueLedger = uniqueByText(sourceFindings).slice(0, 200);
  const topActions = issueLedger.slice(0, 10).map((finding, index) => ({
    rank: index + 1,
    actionId: `A-${String(index + 1).padStart(2, "0")}`,
    exactChange: finding.exactRemediation,
    title: finding.title,
    objectives: finding.affected,
    impact: finding.severity,
    effort: finding.effort,
    confidence: finding.confidence,
    owner: finding.owner,
    acceptanceCriterion: finding.acceptanceCriterion,
    verificationMethod: finding.verificationMethod,
  }));
  const completed = health.ok;
  const fallback = {
    synthesisState: completed ? "Complete" : "Incomplete",
    executiveSummary: completed
      ? `All three source audits completed their evidence contracts. The AI council response was unavailable or structurally unusable, so AIMS produced this deterministic synthesis directly from the retained source ledgers without inventing evidence. ${text(errorMessage)}`.trim()
      : `The source audit evidence contract is incomplete. AIMS produced a controlled deterministic failure synthesis and retained the forensic evidence. ${text(errorMessage)}`.trim(),
    scorecard: {
      trafficGrowth: scoreRow(digitalScore("trafficGrowth"), "Digital Growth source-stage score where supplied."),
      newsletterSignUp: scoreRow(digitalScore("newsletterSignUpRate") ?? digitalScore("newsletterSignUp"), "Digital Growth source-stage score where supplied."),
      podcastClickThrough: scoreRow(digitalScore("podcastClickThroughs") ?? digitalScore("podcastClickThrough"), "Digital Growth source-stage score where supplied."),
      llmDiscoverability: scoreRow(digitalScore("llmDiscoverability"), "Digital Growth source-stage score where supplied."),
      ebookSalesPath: scoreRow(digitalScore("ebookSalesMaximisation") ?? digitalScore("ebookSalesPath"), "Digital Growth source-stage score where supplied."),
      technicalSeo: scoreRow(seoScore("technicalSeo") ?? seoScore("seo"), "SEO/AEO/GEO source-stage score where supplied."),
      aeo: scoreRow(seoScore("aeo"), "SEO/AEO/GEO source-stage score where supplied."),
      geo: scoreRow(seoScore("geo"), "SEO/AEO/GEO source-stage score where supplied."),
      entityAuthority: scoreRow(seoScore("entityAuthority") ?? seoScore("entity"), "SEO/AEO/GEO source-stage score where supplied."),
      internalLinkingIa: scoreRow(seoScore("internalLinkingIa") ?? seoScore("internalLinking"), "SEO/AEO/GEO source-stage score where supplied."),
      accessibility: scoreRow(null, "No cross-stage accessibility score is inferred without the required structured evidence."),
      visualDesignSystemConsistency: scoreRow(null, "No cross-stage design-system score is inferred without the required structured evidence."),
      coreWebVitalsPerformance: scoreRow(null, "No field Core Web Vitals evidence was supplied."),
      structuredData: scoreRow(seoScore("structuredData"), "SEO/AEO/GEO source-stage score where supplied."),
      deploymentLiveParity: scoreRow(null, "Live/source SHA parity requires an explicit verified marker."),
      linkConversionRouteIntegrity: scoreRow(digitalScore("linkConversionRouteIntegrity"), "Digital Growth source-stage score where supplied."),
      securityPlatformHygiene: scoreRow(null, "No complete security-header evidence block was supplied."),
      mobileUx: mobileScorable
        ? {
            score: mobileQualityScoreOutOfTen(compact.mobileUx.mobileQualityScore),
            basis: compact.mobileUx.hardGateBlocked
              ? `Completed rendered Mobile UX quality score; release verdict ${compact.mobileUx.releaseVerdict || "BLOCKED"}.`
              : "Completed rendered Mobile UX quality score.",
            status: compact.mobileUx.hardGateBlocked ? "Scored - Release Hard Gate Blocked" : "Scored from completed rendered evidence",
          }
        : { score: null, basis: "Rendered Mobile UX evidence gate was not met.", status: "Not Scored - Evidence Gate Not Met" },
      councilConfidence: { score: completed ? 5 : 2, basis: `Deterministic synthesis used because the AI council response was unavailable or invalid: ${text(errorMessage) || "unknown error"}`, status: completed ? "Scored - Deterministic Fallback" : "Scored - Incomplete Evidence" },
    },
    councilVerdict: {
      overallDiagnosis: completed
        ? "Source-stage evidence is complete; priorities below are mechanically consolidated from the retained issue ledgers and still require normal owner verification before implementation."
        : "At least one source audit failed its evidence contract; this is a controlled failure report, not a website verdict.",
      biggestStructuralWeakness: issueLedger[0]?.title || (completed ? "No dominant weakness was deterministically ranked." : "Incomplete source-stage evidence."),
      greatestCrossObjectiveLever: topActions[0]?.exactChange || "Complete and verify every source-stage evidence contract.",
    },
    topActions,
    quickWins: topActions.filter((row) => /quick|small|low/i.test(text(row.effort))).slice(0, 10),
    blockers: [],
    unifiedFindings: issueLedger.slice(0, 160),
    conflicts: [],
    funnelMap: [],
    keywordOpportunities: arr(compact.digitalGrowth.dynamicKeywordStrategy).slice(0, 40),
    implementationProgramme: {
      days0to14: topActions.slice(0, 3),
      days15to30: topActions.slice(3, 6),
      days31to60: topActions.slice(6, 8),
      days61to90: topActions.slice(8, 10),
    },
    measurementPlan: topActions.slice(0, 10).map((action) => ({ objective: action.title, metric: action.acceptanceCriterion, eventOrSource: action.verificationMethod, baseline: "Retained audit evidence", successCriterion: action.acceptanceCriterion })),
    gapMatrix: arr(compact.seoAeoGeo.bestPracticeGapMatrix).slice(0, 60),
    masterIssueLedger: issueLedger,
    councilRecord: {
      seats: WEBSITE_AUDIT_COUNCIL_MEMBERS.map((member) => ({ ...member, reviewNote: "Seat represented by deterministic source-ledger synthesis; no individual AI judgement was invented." })),
      majorVotes: [],
      dissent: [],
      rejectedAssumptions: ["A structurally valid JSON object is not automatically a substantive council synthesis."],
      unresolvedVerificationItems: completed ? [`AI council synthesis fallback used: ${text(errorMessage) || "unknown error"}`] : health.failures.map((stage) => `${stage.label}: ${stage.reason}`),
    },
    definitionOfDone: completed
      ? ["Each accepted remediation is implemented, deployed, and verified by its originating source audit.", "The next unified audit completes all source stages and either returns a substantive council synthesis or repeats this deterministic fallback without losing evidence."]
      : health.failures.map((stage) => `${stage.label} completes with a valid report.json and its full machine-readable evidence contract.`),
  };
  fallback.targetAssessment = buildTargetAssessment(fallback.scorecard);
  return enforceCouncilInvariants(fallback, stageReports);
}

export async function runWebsiteAuditCouncil(stageReports) {
  const health = evaluateWebsiteAuditStageHealth(stageReports);
  if (health.failures.length === health.stages.length) {
    return deterministicFallback(stageReports, "All required source audit stages were incomplete; AI council synthesis was skipped to avoid spending tokens on an evidence-empty report.");
  }
  try {
    const { resilientRequest, getProviderDiagnosticsForRoute } = await import("../../services/shared/utils/ai-service.js");
    const diagnostics = getProviderDiagnosticsForRoute("auditForensic");
    const configured = arr(diagnostics.configuredProviders).filter((provider) => provider.configured);
    if (!configured.length) throw new Error("No configured auditForensic provider");
    const payload = compactWebsiteAuditInputs(stageReports);
    const raw = await resilientRequest("auditForensic", {
      section: "website-audit-expert-council",
      max_tokens: Number(process.env.WEBSITE_AUDIT_COUNCIL_MAX_TOKENS || 18000),
      temperature: Number(process.env.WEBSITE_AUDIT_COUNCIL_TEMPERATURE || 0.12),
      top_p: 0.95,
      timeoutMs: Number(process.env.WEBSITE_AUDIT_COUNCIL_TIMEOUT_MS || 300000),
      maxRetries: Number(process.env.WEBSITE_AUDIT_COUNCIL_MAX_RETRIES || 0),
      reasoning: false,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Consolidate this verified audit evidence bundle into the required council JSON.\n${JSON.stringify(payload)}` },
      ],
    });
    const normalised = normaliseCouncil(parseJsonResponse(raw), stageReports);
    if (!councilHasRequiredSubstance(normalised)) {
      return deterministicFallback(stageReports, "The AI council returned structurally valid JSON without the required verdict, scored evidence and remediation substance.");
    }
    return normalised;
  } catch (err) {
    return deterministicFallback(stageReports, err?.message || String(err));
  }
}

function listHtml(items, formatter = (item) => text(item)) {
  const rows = arr(items).map((item) => formatter(item)).filter(Boolean);
  return rows.length ? `<ul>${rows.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : "<p class='muted'>None recorded.</p>";
}

function table(headers, rows) {
  if (!rows.length) return "<p class='muted'>No records.</p>";
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function scorecardHtml(scorecard = {}) {
  const labels = {
    trafficGrowth: "Traffic Growth", newsletterSignUp: "Newsletter Sign-Up", podcastClickThrough: "Podcast Click-Through",
    llmDiscoverability: "LLM Discoverability", ebookSalesPath: "Ebook Sales Path", technicalSeo: "Technical SEO", aeo: "AEO", geo: "GEO",
    entityAuthority: "Entity Authority", internalLinkingIa: "Internal Linking / IA", accessibility: "Accessibility",
    visualDesignSystemConsistency: "Visual / Design-System Consistency", coreWebVitalsPerformance: "Core Web Vitals / Performance",
    structuredData: "Structured Data", deploymentLiveParity: "Deployment / Live Parity", linkConversionRouteIntegrity: "Link / Conversion Route Integrity",
    securityPlatformHygiene: "Security / Platform Hygiene", mobileUx: "Mobile UX", councilConfidence: "Council Confidence",
  };
  const rows = Object.entries(labels).map(([key, label]) => {
    const row = obj(scorecard[key]);
    return [`<strong>${esc(label)}</strong>`, row.score === null || row.score === undefined ? "Not scored" : `${esc(row.score)}/10`, esc(row.status || ""), esc(row.basis || "")];
  });
  return table(["Area", "Score", "Status", "Evidence basis"], rows);
}

function actionRows(actions = []) {
  return arr(actions).map((item, index) => {
    const action = obj(item);
    return [
      esc(action.rank ?? index + 1), `<strong>${esc(action.actionId || `A-${index + 1}`)}</strong>`, esc(action.exactChange || action.title || action.action || ""),
      esc(arr(action.objectives).join(", ")), esc(action.impact || ""), esc(action.effort || ""), esc(action.confidence || ""), esc(action.owner || ""),
      esc(action.acceptanceCriterion || ""), esc(action.verificationMethod || ""),
    ];
  });
}

function findingRows(findings = []) {
  return arr(findings).map((item, index) => {
    const finding = obj(item);
    const affectedRaw = finding.affected ?? finding.affectedPagesTemplatesFilesOrRoutes ?? finding.affectedPages ?? finding.location ?? finding.url ?? finding.path ?? "";
    const affected = Array.isArray(affectedRaw) ? affectedRaw.join(", ") : text(affectedRaw);
    const title = finding.title || finding.rootCause || finding.issue || finding.defectDescription || finding.check || finding.judgement || "";
    return [
      `<strong>${esc(finding.findingId || finding.issueId || finding.groupId || `U-${index + 1}`)}</strong>`, esc(finding.severity || finding.priority || ""), esc(finding.confidence || finding.findingConfidence || ""),
      esc(title), esc(affected),
      esc(finding.exactRemediation || finding.exactChange || finding.remediation || finding.requiredOutcome || finding.recommendedFix || ""), esc(finding.effort || finding.estimatedEffort || ""), esc(finding.owner || finding.recommendedOwner || finding.ownerClass || ""),
    ];
  });
}

function seoCoverageRows(stageReports = {}) {
  const seo = obj(stageReports.seoAeoGeo);
  const coverage = obj(seo.coverage);
  const urls = arr(coverage.urls || seo.urls);
  return urls.map((item) => {
    const row = obj(item);
    return [esc(row.url || row.liveUrl || row.route || ""), esc(row.pageType || ""), esc(row.statusCode ?? row.status ?? ""), esc(row.canonical || row.canonicalTarget || ""), esc(row.indexability || row.indexabilityStatus || ""), esc(row.coverageState || row.state || ""), esc(row.score ?? row.condensedVerdict ?? row.verdict ?? "")];
  });
}

export function buildWebsiteAuditHtml({ websiteUrl, sessionId, generatedAt = new Date().toISOString(), council, stageReports }) {
  const verdict = obj(council.councilVerdict);
  const programme = obj(council.implementationProgramme);
  const sourceEvidence = compactWebsiteAuditInputs(stageReports);
  const seoCoverage = seoCoverageRows(stageReports);
  const conflicts = arr(council.conflicts).map((item) => [esc(item.topic || ""), esc(arr(item.positions).join(" | ")), esc(item.resolution || ""), esc(item.confidence || "")]);
  const funnel = arr(council.funnelMap).map((item) => [esc(item.journey || ""), esc(item.currentFriction || ""), esc(item.exactChange || ""), esc(item.measurement || "")]);
  const keywords = arr(council.keywordOpportunities).map((item) => [esc(item.topic || ""), esc(item.intent || ""), esc(item.targetPageOrGap || ""), esc(item.action || ""), esc(item.confidence || "")]);
  const measurement = arr(council.measurementPlan).map((item) => [esc(item.objective || ""), esc(item.metric || ""), esc(item.eventOrSource || ""), esc(item.baseline || ""), esc(item.successCriterion || "")]);
  const gaps = arr(council.gapMatrix).map((item) => [esc(item.area || ""), esc(item.currentState || ""), esc(item.targetState || ""), esc(item.priority || ""), esc(item.owner || "")]);
  const seats = arr(council.councilRecord?.seats).map((item) => [esc(item.seat || ""), esc(item.role || ""), esc(item.reviewNote || "")]);
  const incomplete = text(council.synthesisState).toLowerCase() !== "complete";
  const reportLabel = incomplete ? "Controlled Website Audit Failure" : "Unified Website Audit";
  const reportTitle = incomplete ? "Incomplete Audit Evidence + Recovery Report" : "Digital Growth + Website SEO/AEO/GEO + Mobile UX";
  const sourceState = [
    ["Digital Growth", text(stageReports.digitalGrowth?.status || stageReports.digitalGrowth?.analysis?.auditCompletionState || "unknown")],
    ["SEO / AEO / GEO", text(stageReports.seoAeoGeo?.status || stageReports.seoAeoGeo?.coverage?.auditCompletionState || "unknown")],
    ["Mobile UX", text(stageReports.mobileUx?.status || stageReports.mobileUx?.summary?.status || "unknown")],
  ];

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(reportLabel)}</title><style>
    @page{size:A4;margin:16mm 12mm 18mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#172033;margin:0;font-size:9.5pt;line-height:1.45}h1{font-size:27pt;line-height:1.05;margin:0 0 8mm}h2{font-size:17pt;margin:9mm 0 4mm;border-bottom:2px solid #172033;padding-bottom:2mm}h3{font-size:12pt;margin:6mm 0 2mm}p{margin:0 0 3mm}.cover{min-height:245mm;display:flex;flex-direction:column;justify-content:center;page-break-after:always}.kicker{font-size:10pt;text-transform:uppercase;letter-spacing:.12em;font-weight:700}.subtitle{font-size:14pt;max-width:145mm}.meta{margin-top:14mm;padding:5mm;border:1px solid #cbd5e1;border-radius:3mm}.section{break-inside:auto}.pagebreak{page-break-before:always}.callout{padding:4mm 5mm;border-left:4px solid #172033;background:#f1f5f9;margin:4mm 0}.muted{color:#64748b}.chips span{display:inline-block;border:1px solid #cbd5e1;border-radius:99px;padding:1.2mm 2.5mm;margin:0 1mm 1mm 0;font-size:8pt}table{width:100%;border-collapse:collapse;margin:3mm 0 5mm;table-layout:fixed}th,td{border:1px solid #d8dee8;padding:2.2mm;vertical-align:top;word-break:break-word}th{background:#eef2f7;text-align:left;font-size:8.2pt}td{font-size:8pt}ul{margin:2mm 0 4mm 5mm;padding-left:4mm}li{margin:0 0 1.6mm}.small{font-size:8pt}.avoid{break-inside:avoid}.toc li{margin-bottom:1mm}.ledger td:nth-child(1){width:8%}.coverage{font-size:7pt}.coverage td,.coverage th{font-size:6.7pt;padding:1.3mm}.status{font-weight:700}.footer-note{margin-top:8mm;font-size:7.5pt;color:#64748b}
  </style></head><body>
  <section class="cover"><div class="kicker">${esc(reportLabel)}</div><h1>${esc(reportTitle)}</h1><p class="subtitle">${incomplete ? "A controlled failure record for" : "One evidence-led council report for"} ${esc(websiteUrl)}. ${incomplete ? "Failed or incomplete source stages are preserved as blockers and may not be mistaken for a completed website assessment." : "Three audit lenses, one implementation order, one retained report set in PDF, HTML and JSON."}</p><div class="meta"><p><strong>Session:</strong> ${esc(sessionId)}</p><p><strong>Generated:</strong> ${esc(generatedAt)}</p><p><strong>Council:</strong> ${WEBSITE_AUDIT_COUNCIL_MEMBERS.length} specialist seats</p><p><strong>Synthesis state:</strong> ${esc(council.synthesisState)}</p>${sourceState.map(([name,status])=>`<p><strong>${esc(name)}:</strong> ${esc(status)}</p>`).join("")}</div></section>

  <section><h2>1. Executive Scorecard</h2>${scorecardHtml(council.scorecard)}<div class="callout"><strong>Target:</strong> ${esc(council.targetAssessment?.target ?? 8.5)}/10 minimum. <strong>Below target:</strong> ${esc((council.targetAssessment?.belowTarget || []).join(", ") || "None")} &nbsp; <strong>Unscored:</strong> ${esc((council.targetAssessment?.unscored || []).join(", ") || "None")}.</div><div class="callout"><strong>Executive synthesis.</strong> ${esc(council.executiveSummary)}</div></section>
  <section><h2>2. Council Verdict</h2><p><strong>Overall diagnosis:</strong> ${esc(verdict.overallDiagnosis || "")}</p><p><strong>Biggest structural weakness:</strong> ${esc(verdict.biggestStructuralWeakness || "")}</p><p><strong>Biggest commercial opportunity:</strong> ${esc(verdict.biggestCommercialOpportunity || "")}</p><p><strong>Biggest search opportunity:</strong> ${esc(verdict.biggestSearchOpportunity || "")}</p><p><strong>Biggest mobile risk:</strong> ${esc(verdict.biggestMobileRisk || "")}</p><p><strong>Greatest cross-objective lever:</strong> ${esc(verdict.greatestCrossObjectiveLever || "")}</p><h3>Strongest assets</h3>${listHtml(verdict.strongestAssets)}</section>
  <section><h2>3. Top Priorities</h2>${table(["Rank","ID","Exact change","Objectives","Impact","Effort","Confidence","Owner","Acceptance criterion","Verification"], actionRows(council.topActions))}<h3>Quick Wins</h3>${listHtml(council.quickWins, (item)=>typeof item === "string" ? item : item.exactChange || item.action || item.title)}<h3>Release / Evidence Blockers</h3>${listHtml(council.blockers, (item)=>typeof item === "string" ? item : item.title || item.blocker || item.description)}</section>
  <section class="pagebreak"><h2>4. Source Audit Evidence Summary</h2><h3>Digital Growth & Monetisation</h3><p><strong>Status:</strong> ${esc(sourceEvidence.digitalGrowth.status)}</p><p>${esc(sourceEvidence.digitalGrowth.overallVerdict || "")}</p>${table(["ID","Severity","Confidence","Finding","Location","Exact change","Effort","Owner"], findingRows(sourceEvidence.digitalGrowth.findings.slice(0,30)))}<h3>Website SEO / AEO / GEO</h3><p><strong>Status:</strong> ${esc(sourceEvidence.seoAeoGeo.status)}</p>${table(["ID","Severity","Confidence","Finding","Affected","Exact remediation","Effort","Owner"], findingRows(sourceEvidence.seoAeoGeo.rankedIssueLedger.slice(0,40)))}<h3>Rendered Mobile UX Hard-Gate</h3><p><strong>Status:</strong> ${esc(sourceEvidence.mobileUx.status)} &nbsp; <strong>Release verdict:</strong> ${esc(sourceEvidence.mobileUx.releaseVerdict || "Not available")} &nbsp; <strong>Mobile score:</strong> ${sourceEvidence.mobileUx.mobileQualityScore == null ? "Not scored" : esc(sourceEvidence.mobileUx.mobileQualityScore)}</p>${sourceEvidence.mobileUx.hardGateBlocked ? "<div class='callout'><strong>Mobile evidence gate blocked.</strong> No council Mobile UX score may be fabricated.</div>" : ""}${table(["ID","Severity","Confidence","Finding","Affected","Exact remediation","Effort","Owner"], findingRows([...sourceEvidence.mobileUx.rootCauseGroups, ...sourceEvidence.mobileUx.findings].slice(0,40)))}</section>
  <section class="pagebreak"><h2>5. Unified Root-Cause Findings</h2><table class="ledger"><thead><tr><th>ID</th><th>Severity</th><th>Confidence</th><th>Root cause</th><th>Affected</th><th>Exact remediation</th><th>Effort</th><th>Owner</th></tr></thead><tbody>${findingRows(council.unifiedFindings).map(row=>`<tr>${row.map(c=>`<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></section>
  <section><h2>6. Cross-Audit Conflict Register</h2>${table(["Topic","Positions","Resolution","Confidence"], conflicts)}</section>
  <section><h2>7. Funnel & Monetisation Map</h2>${table(["Journey","Current friction","Exact change","Measurement"], funnel)}</section>
  <section><h2>8. Keyword & Content Opportunity Map</h2>${table(["Topic","Intent","Target page / gap","Action","Confidence"], keywords)}</section>
  <section><h2>9. 30 / 60 / 90-Day Implementation Programme</h2><h3>Days 0-14</h3>${listHtml(programme.days0to14, (i)=>typeof i==="string"?i:i.action||i.exactChange||i.title)}<h3>Days 15-30</h3>${listHtml(programme.days15to30, (i)=>typeof i==="string"?i:i.action||i.exactChange||i.title)}<h3>Days 31-60</h3>${listHtml(programme.days31to60, (i)=>typeof i==="string"?i:i.action||i.exactChange||i.title)}<h3>Days 61-90</h3>${listHtml(programme.days61to90, (i)=>typeof i==="string"?i:i.action||i.exactChange||i.title)}</section>
  <section><h2>10. KPI & Verification Plan</h2>${table(["Objective","Metric","Event / source","Baseline","Success criterion"], measurement)}</section>
  <section><h2>11. Best-Practice Gap Matrix</h2>${table(["Area","Current state","Target state","Priority","Owner"], gaps)}</section>
  <section><h2>12. Master Issue Ledger</h2>${table(["ID","Severity","Confidence","Issue","Affected","Remediation","Effort","Owner"], findingRows(council.masterIssueLedger))}</section>
  <section class="pagebreak"><h2>13. Full URL Coverage Appendix</h2><p class="small">Deterministic URL coverage is taken directly from the SEO/AEO/GEO audit evidence rather than regenerated by the council.</p>${seoCoverage.length ? `<table class="coverage"><thead><tr><th>URL</th><th>Page type</th><th>Status</th><th>Canonical</th><th>Indexability</th><th>Coverage state</th><th>Verdict / score</th></tr></thead><tbody>${seoCoverage.map(row=>`<tr>${row.map(c=>`<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>` : "<p class='muted'>Full URL ledger was not available from the SEO stage.</p>"}</section>
  <section class="pagebreak"><h2>14. Council Record</h2><p>The council uses independent specialist review, contradiction analysis, root-cause clustering, prioritisation and final deliberation. Notes below are decision summaries, not private reasoning.</p>${table(["Seat","Role","Review note"], seats)}<h3>Major decisions</h3>${listHtml(council.councilRecord?.majorVotes, (i)=>typeof i==="string"?i:`${i.decision || "Decision"}: ${i.outcome || ""}`)}<h3>Dissent</h3>${listHtml(council.councilRecord?.dissent, (i)=>typeof i==="string"?i:i.note||i.dissent||i.position)}<h3>Rejected assumptions</h3>${listHtml(council.councilRecord?.rejectedAssumptions)}<h3>Unresolved verification items</h3>${listHtml(council.councilRecord?.unresolvedVerificationItems)}</section>
  <section><h2>15. Definition of Done</h2>${listHtml(council.definitionOfDone)}<p class="footer-note">Retention contract: ${incomplete ? "source-stage evidence is retained for diagnosis and rerun; RAMS dispatch and temporary cleanup are prohibited until every required source stage completes." : "the final PDF, HTML and JSON representations are retained after successful RAMS handoff; temporary evidence may then be removed."}</p></section>
  </body></html>`;
}

function chromiumExecutable() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ].filter(Boolean);
  const direct = candidates.find((candidate) => fs.existsSync(candidate));
  if (direct) return direct;
  for (const command of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    const result = spawnSync("which", [command], { encoding: "utf8" });
    const resolved = result.status === 0 ? text(result.stdout) : "";
    if (resolved && fs.existsSync(resolved)) return resolved;
  }
  return null;
}

export async function renderWebsiteAuditPdf(html) {
  const executablePath = chromiumExecutable();
  if (!executablePath) throw new Error("Chromium executable not found; cannot render final website audit PDF");
  const browser = await chromium.launch({ headless: true, executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.setContent(String(html), { waitUntil: "load", timeout: 60000 });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: '<div style="font-size:7px;width:100%;text-align:center;color:#64748b"><span>Jonathan Harris Website Audit</span> · <span class="pageNumber"></span>/<span class="totalPages"></span></div>',
      margin: { top: "16mm", right: "12mm", bottom: "18mm", left: "12mm" },
    });
  } finally {
    await browser.close();
  }
}

export const __websiteAuditCouncilTestHooks = {
  SYSTEM_PROMPT,
  parseJsonResponse,
  normaliseCouncil,
  evaluateWebsiteAuditStageHealth,
  enforceCouncilInvariants,
  deterministicFallback,
  councilHasRequiredSubstance,
  compactDigital,
  compactSeo,
  compactMobile,
  chromiumExecutable,
};

export default {
  WEBSITE_AUDIT_COUNCIL_MEMBERS,
  compactWebsiteAuditInputs,
  runWebsiteAuditCouncil,
  buildWebsiteAuditHtml,
  renderWebsiteAuditPdf,
};
