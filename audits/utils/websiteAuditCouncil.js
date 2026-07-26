import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright-core";

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
2. Full-Estate SEO + AEO + GEO.
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
    status: source.status || analysis.auditCompletionState || "unknown",
    scorecard: analysis.scorecard || source.scorecard || {},
    overallVerdict: analysis.overallVerdict || source.overallVerdict || "",
    findings: arr(analysis.findings || source.findings || source.heuristicIssues).slice(0, 80),
    topActions: arr(analysis.executiveSummary?.top10Actions || source.executiveSummary?.top10Actions).slice(0, 10),
    dynamicKeywordStrategy: arr(analysis.dynamicKeywordStrategy || source.dynamicKeywordStrategy).slice(0, 40),
    highValueOpportunities: arr(analysis.highValueOpportunities || source.highValueOpportunities).slice(0, 30),
    limitations: arr(analysis.limitations || source.limitations || evidence.limitations).slice(0, 30),
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
    status: source.status || coverage.auditCompletionState || analysis.auditCompletionState || "unknown",
    scores: analysis.scores || source.scores || {},
    executiveSummary: analysis.executiveSummary || source.summary || {},
    rankedIssueLedger: arr(analysis.rankedIssueLedger || analysis.issues || source.heuristicIssues).slice(0, 100),
    fullIssueRecords: arr(analysis.fullIssueRecords || analysis.issueRecords).slice(0, 100),
    bestPracticeGapMatrix: arr(analysis.bestPracticeGapMatrix || analysis.gapMatrix).slice(0, 60),
    pageTypeFindings: arr(analysis.pageTypeFindings).slice(0, 60),
    sourceMismatches: arr(source.sourceMismatchesThatMatter || coverage.sourceMismatchesThatMatter).slice(0, 60),
    familyDiagnostics: arr(source.familyDiagnostics || coverage.familyDiagnostics).slice(0, 60),
    coverageSummary: arr(coverage.pageFamilyCoverage || source.pageFamilyCoverage).slice(0, 60),
    limitations: arr(analysis.limitations || source.limitations).slice(0, 40),
  };
}

function compactMobile(report = {}) {
  const source = obj(report);
  const summary = obj(source.summary);
  const coverage = obj(source.coverage);
  const control = obj(source.reportControl || source.control || summary.reportControl);
  return {
    status: source.status || summary.status || "unknown",
    hardGateBlocked: Boolean(source.hardGateBlocked ?? summary.hardGateBlocked),
    mobileQualityScore: source.mobileQualityScore ?? summary.mobileQualityScore ?? null,
    releaseVerdict: source.releaseVerdict || summary.releaseVerdict || null,
    screenshotCount: source.screenshotCount ?? summary.screenshotCount ?? control.screenshotCount ?? null,
    mobileFailureCount: source.mobileFailureCount ?? summary.mobileFailureCount ?? control.mobileFailuresCount ?? null,
    capabilities: source.capabilities || summary.capabilities || {},
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
    digitalGrowth: compactDigital(stageReports.digitalGrowth),
    seoAeoGeo: compactSeo(stageReports.seoAeoGeo),
    mobileUx: compactMobile(stageReports.mobileUx),
  };
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

function normaliseCouncil(data, stageReports) {
  const source = obj(data);
  const input = compactWebsiteAuditInputs(stageReports);
  const mobile = input.mobileUx;
  const mobileScorable = mobile.status === "completed" && !mobile.hardGateBlocked && Number.isFinite(Number(mobile.mobileQualityScore));
  const score = obj(source.scorecard);
  const keys = ["trafficGrowth", "newsletterSignUp", "podcastClickThrough", "llmDiscoverability", "ebookSalesPath", "technicalSeo", "aeo", "geo", "entityAuthority", "internalLinkingIa", "councilConfidence"];
  const scorecard = Object.fromEntries(keys.map((key) => [key, normaliseScoreRow(score[key])]));
  scorecard.mobileUx = mobileScorable
    ? { ...normaliseScoreRow(score.mobileUx), score: clamp(score.mobileUx?.score ?? mobile.mobileQualityScore / 10, 1, 10, 1) }
    : { score: null, basis: "Rendered Mobile UX evidence gate did not complete with a score; council scoring is prohibited.", status: "Not Scored - Evidence Gate Not Met" };

  const record = obj(source.councilRecord);
  const returnedSeats = arr(record.seats);
  const seats = WEBSITE_AUDIT_COUNCIL_MEMBERS.map((member) => {
    const found = returnedSeats.find((item) => Number(item?.seat) === member.seat || text(item?.role) === member.role) || {};
    return { seat: member.seat, role: member.role, reviewNote: text(found.reviewNote) || "Seat represented in the council synthesis; no separate note was returned." };
  });

  return {
    synthesisState: text(source.synthesisState) || "Complete",
    executiveSummary: text(source.executiveSummary) || "The three audit stages were consolidated into one evidence-led implementation programme.",
    scorecard,
    councilVerdict: obj(source.councilVerdict),
    topActions: arr(source.topActions).slice(0, 20),
    quickWins: arr(source.quickWins).slice(0, 30),
    blockers: arr(source.blockers).slice(0, 30),
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
}

function deterministicFallback(stageReports, errorMessage) {
  const compact = compactWebsiteAuditInputs(stageReports);
  const mobileScorable = compact.mobileUx.status === "completed" && !compact.mobileUx.hardGateBlocked && Number.isFinite(Number(compact.mobileUx.mobileQualityScore));
  const digitalScore = (key) => {
    const row = obj(compact.digitalGrowth.scorecard[key]);
    return row.score !== null && row.score !== undefined && row.score !== "" && Number.isFinite(Number(row.score)) ? clamp(row.score, 1, 10, 1) : null;
  };
  return {
    synthesisState: "Incomplete",
    executiveSummary: "The audit stages completed or froze their available evidence, but the multidisciplinary AI council synthesis was unavailable. This fallback preserves evidence without inventing council conclusions.",
    scorecard: {
      trafficGrowth: { score: digitalScore("trafficGrowth"), basis: "Stage 1 score where available.", status: digitalScore("trafficGrowth") ? "Stage 1 score only" : "Not Scored" },
      newsletterSignUp: { score: digitalScore("newsletterSignUpRate"), basis: "Stage 1 score where available.", status: digitalScore("newsletterSignUpRate") ? "Stage 1 score only" : "Not Scored" },
      podcastClickThrough: { score: digitalScore("podcastClickThroughs"), basis: "Stage 1 score where available.", status: digitalScore("podcastClickThroughs") ? "Stage 1 score only" : "Not Scored" },
      llmDiscoverability: { score: digitalScore("llmDiscoverability"), basis: "Stage 1 score where available.", status: digitalScore("llmDiscoverability") ? "Stage 1 score only" : "Not Scored" },
      ebookSalesPath: { score: digitalScore("ebookSalesMaximisation"), basis: "Stage 1 score where available.", status: digitalScore("ebookSalesMaximisation") ? "Stage 1 score only" : "Not Scored" },
      technicalSeo: { score: null, basis: "Council synthesis unavailable; raw SEO evidence is retained below.", status: "Not Scored" },
      aeo: { score: null, basis: "Council synthesis unavailable; raw SEO evidence is retained below.", status: "Not Scored" },
      geo: { score: null, basis: "Council synthesis unavailable; raw SEO evidence is retained below.", status: "Not Scored" },
      entityAuthority: { score: null, basis: "Council synthesis unavailable.", status: "Not Scored" },
      internalLinkingIa: { score: null, basis: "Council synthesis unavailable.", status: "Not Scored" },
      mobileUx: mobileScorable ? { score: clamp(compact.mobileUx.mobileQualityScore / 10, 1, 10, 1), basis: "Stage 3 rendered score only.", status: "Stage 3 score only" } : { score: null, basis: "Rendered Mobile UX evidence gate not met.", status: "Not Scored - Evidence Gate Not Met" },
      councilConfidence: { score: 1, basis: `Council synthesis unavailable: ${text(errorMessage) || "unknown error"}`, status: "Incomplete" },
    },
    councilVerdict: { overallDiagnosis: "Council synthesis unavailable. Use source-stage evidence and rerun the council before treating cross-audit priorities as settled." },
    topActions: [], quickWins: [], blockers: [], unifiedFindings: [], conflicts: [], funnelMap: [], keywordOpportunities: [],
    implementationProgramme: {}, measurementPlan: [], gapMatrix: [], masterIssueLedger: [],
    councilRecord: {
      seats: WEBSITE_AUDIT_COUNCIL_MEMBERS.map((member) => ({ ...member, reviewNote: "Council synthesis unavailable; no expert judgement invented." })),
      majorVotes: [], dissent: [], rejectedAssumptions: [], unresolvedVerificationItems: [`Council synthesis failed: ${text(errorMessage) || "unknown error"}`],
    },
    definitionOfDone: ["Rerun the council synthesis successfully before treating cross-audit priorities as final."],
  };
}

export async function runWebsiteAuditCouncil(stageReports) {
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
      maxRetries: Number(process.env.WEBSITE_AUDIT_COUNCIL_MAX_RETRIES || 1),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Consolidate this verified audit evidence bundle into the required council JSON.\n${JSON.stringify(payload)}` },
      ],
    });
    return normaliseCouncil(parseJsonResponse(raw), stageReports);
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
    entityAuthority: "Entity Authority", internalLinkingIa: "Internal Linking / IA", mobileUx: "Mobile UX", councilConfidence: "Council Confidence",
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
  const sourceState = [
    ["Digital Growth", text(stageReports.digitalGrowth?.status || stageReports.digitalGrowth?.analysis?.auditCompletionState || "unknown")],
    ["SEO / AEO / GEO", text(stageReports.seoAeoGeo?.status || stageReports.seoAeoGeo?.coverage?.auditCompletionState || "unknown")],
    ["Mobile UX", text(stageReports.mobileUx?.status || stageReports.mobileUx?.summary?.status || "unknown")],
  ];

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Website Growth, Search & Mobile Audit</title><style>
    @page{size:A4;margin:16mm 12mm 18mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#172033;margin:0;font-size:9.5pt;line-height:1.45}h1{font-size:27pt;line-height:1.05;margin:0 0 8mm}h2{font-size:17pt;margin:9mm 0 4mm;border-bottom:2px solid #172033;padding-bottom:2mm}h3{font-size:12pt;margin:6mm 0 2mm}p{margin:0 0 3mm}.cover{min-height:245mm;display:flex;flex-direction:column;justify-content:center;page-break-after:always}.kicker{font-size:10pt;text-transform:uppercase;letter-spacing:.12em;font-weight:700}.subtitle{font-size:14pt;max-width:145mm}.meta{margin-top:14mm;padding:5mm;border:1px solid #cbd5e1;border-radius:3mm}.section{break-inside:auto}.pagebreak{page-break-before:always}.callout{padding:4mm 5mm;border-left:4px solid #172033;background:#f1f5f9;margin:4mm 0}.muted{color:#64748b}.chips span{display:inline-block;border:1px solid #cbd5e1;border-radius:99px;padding:1.2mm 2.5mm;margin:0 1mm 1mm 0;font-size:8pt}table{width:100%;border-collapse:collapse;margin:3mm 0 5mm;table-layout:fixed}th,td{border:1px solid #d8dee8;padding:2.2mm;vertical-align:top;word-break:break-word}th{background:#eef2f7;text-align:left;font-size:8.2pt}td{font-size:8pt}ul{margin:2mm 0 4mm 5mm;padding-left:4mm}li{margin:0 0 1.6mm}.small{font-size:8pt}.avoid{break-inside:avoid}.toc li{margin-bottom:1mm}.ledger td:nth-child(1){width:8%}.coverage{font-size:7pt}.coverage td,.coverage th{font-size:6.7pt;padding:1.3mm}.status{font-weight:700}.footer-note{margin-top:8mm;font-size:7.5pt;color:#64748b}
  </style></head><body>
  <section class="cover"><div class="kicker">Unified Website Audit</div><h1>Digital Growth + Full-Estate SEO/AEO/GEO + Mobile UX</h1><p class="subtitle">One evidence-led council report for ${esc(websiteUrl)}. Three audit lenses, one implementation order, one retained report set in PDF, HTML and JSON.</p><div class="meta"><p><strong>Session:</strong> ${esc(sessionId)}</p><p><strong>Generated:</strong> ${esc(generatedAt)}</p><p><strong>Council:</strong> ${WEBSITE_AUDIT_COUNCIL_MEMBERS.length} specialist seats</p><p><strong>Synthesis state:</strong> ${esc(council.synthesisState)}</p>${sourceState.map(([name,status])=>`<p><strong>${esc(name)}:</strong> ${esc(status)}</p>`).join("")}</div></section>

  <section><h2>1. Executive Scorecard</h2>${scorecardHtml(council.scorecard)}<div class="callout"><strong>Executive synthesis.</strong> ${esc(council.executiveSummary)}</div></section>
  <section><h2>2. Council Verdict</h2><p><strong>Overall diagnosis:</strong> ${esc(verdict.overallDiagnosis || "")}</p><p><strong>Biggest structural weakness:</strong> ${esc(verdict.biggestStructuralWeakness || "")}</p><p><strong>Biggest commercial opportunity:</strong> ${esc(verdict.biggestCommercialOpportunity || "")}</p><p><strong>Biggest search opportunity:</strong> ${esc(verdict.biggestSearchOpportunity || "")}</p><p><strong>Biggest mobile risk:</strong> ${esc(verdict.biggestMobileRisk || "")}</p><p><strong>Greatest cross-objective lever:</strong> ${esc(verdict.greatestCrossObjectiveLever || "")}</p><h3>Strongest assets</h3>${listHtml(verdict.strongestAssets)}</section>
  <section><h2>3. Top Priorities</h2>${table(["Rank","ID","Exact change","Objectives","Impact","Effort","Confidence","Owner","Acceptance criterion","Verification"], actionRows(council.topActions))}<h3>Quick Wins</h3>${listHtml(council.quickWins, (item)=>typeof item === "string" ? item : item.exactChange || item.action || item.title)}<h3>Release / Evidence Blockers</h3>${listHtml(council.blockers, (item)=>typeof item === "string" ? item : item.title || item.blocker || item.description)}</section>
  <section class="pagebreak"><h2>4. Source Audit Evidence Summary</h2><h3>Digital Growth & Monetisation</h3><p><strong>Status:</strong> ${esc(sourceEvidence.digitalGrowth.status)}</p><p>${esc(sourceEvidence.digitalGrowth.overallVerdict || "")}</p>${table(["ID","Severity","Confidence","Finding","Location","Exact change","Effort","Owner"], findingRows(sourceEvidence.digitalGrowth.findings.slice(0,30)))}<h3>Full-Estate SEO / AEO / GEO</h3><p><strong>Status:</strong> ${esc(sourceEvidence.seoAeoGeo.status)}</p>${table(["ID","Severity","Confidence","Finding","Affected","Exact remediation","Effort","Owner"], findingRows(sourceEvidence.seoAeoGeo.rankedIssueLedger.slice(0,40)))}<h3>Rendered Mobile UX Hard-Gate</h3><p><strong>Status:</strong> ${esc(sourceEvidence.mobileUx.status)} &nbsp; <strong>Release verdict:</strong> ${esc(sourceEvidence.mobileUx.releaseVerdict || "Not available")} &nbsp; <strong>Mobile score:</strong> ${sourceEvidence.mobileUx.mobileQualityScore == null ? "Not scored" : esc(sourceEvidence.mobileUx.mobileQualityScore)}</p>${sourceEvidence.mobileUx.hardGateBlocked ? "<div class='callout'><strong>Mobile evidence gate blocked.</strong> No council Mobile UX score may be fabricated.</div>" : ""}${table(["ID","Severity","Confidence","Finding","Affected","Exact remediation","Effort","Owner"], findingRows([...sourceEvidence.mobileUx.rootCauseGroups, ...sourceEvidence.mobileUx.findings].slice(0,40)))}</section>
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
  <section><h2>15. Definition of Done</h2>${listHtml(council.definitionOfDone)}<p class="footer-note">Retention contract: only the final PDF, HTML and JSON representations are retained by the website audit pipeline. Stage artefacts are temporary working evidence and are deleted after successful final report-set publication.</p></section>
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
  deterministicFallback,
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
