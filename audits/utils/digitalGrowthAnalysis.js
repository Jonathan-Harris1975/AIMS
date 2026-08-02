import { compactWebsiteAuditPolicy } from "./websiteAuditPolicy.js";

const OBJECTIVES = [
  ["trafficGrowth", "Traffic Growth"],
  ["newsletterSignUpRate", "Newsletter Sign-Up Rate"],
  ["podcastClickThroughs", "Podcast Click-Throughs"],
  ["llmDiscoverability", "LLM / AI Model Discoverability"],
  ["ebookSalesMaximisation", "Ebook Sales Maximisation"],
];

const SYSTEM_PROMPT = `You are the Stage 1 Digital Growth and Monetisation audit lead for jonathan-harris.online.
Operate as a senior digital growth strategist and technical web consultant specialising in personal-brand monetisation, SEO and content-driven revenue.

Audit exactly five primary objectives:
1. Traffic Growth.
2. Newsletter Sign-Up Rate.
3. Podcast Click-Throughs.
4. LLM / AI Model Discoverability.
5. Ebook Sales Maximisation.

Also assess dynamic keyword strategy and high-value cross-objective opportunities.

Rules:
- Use only supplied repository/live evidence. Never invent analytics, traffic, sales, search volume, conversion rates, browser behaviour or files.
- Plain British English. Direct language. No corporate filler.
- Prefer exact routes, files, elements and observed evidence.
- Every recommendation must include exact change, expected impact, rationale, effort, confidence, owner, acceptance criterion and verification method.
- Effort must be Quick Win, Medium Lift or Strategic Investment.
- Confidence must be Confirmed, Probable or Needs Verification.
- Impact must be Very High, High, Medium or Low.
- Prioritise verified blockers, then high-impact Quick Wins.
- Scores are 1-10 and must have a one-line evidence rationale.
- The websiteAuditPolicy target of 8.5/10 is an acceptance target, not a score floor. Never inflate a score to meet it.
- /blog and /transcripts are intentionally excluded from this website audit because their R2 content is audited by dedicated pipelines. Do not penalise this audit for their absence. /podcast remains in scope.
- Respect the governed newsletter, Contribute, podcast, accessibility, visual-design, deployment-parity and link-integrity contracts in websiteAuditPolicy whenever matching evidence is supplied.
- Do not treat llms.txt or special AI markup as a Google AI-search requirement. Treat llms.txt as optional supporting infrastructure and prioritise crawl/index eligibility, textual usefulness, internal linking, entity clarity, and structured-data/visible-content alignment.
- Do not claim checkout, analytics or revenue performance unless it was supplied.
- If evidence is missing, say what is unverified and define the measurement/event needed.
- Return JSON only. Do not return markdown fences, the prompt, private reasoning or chain-of-thought.

Required JSON shape:
{
  "auditCompletionState":"Complete|Incomplete",
  "overallVerdict":"...",
  "scorecard":{
    "trafficGrowth":{"score":1,"rationale":"..."},
    "newsletterSignUpRate":{"score":1,"rationale":"..."},
    "podcastClickThroughs":{"score":1,"rationale":"..."},
    "llmDiscoverability":{"score":1,"rationale":"..."},
    "ebookSalesMaximisation":{"score":1,"rationale":"..."}
  },
  "executiveSummary":{"top10Actions":["..."]},
  "findings":[{
    "findingId":"DG-001",
    "title":"...",
    "objective":"Traffic Growth|Newsletter Sign-Up Rate|Podcast Click-Throughs|LLM / AI Model Discoverability|Ebook Sales Maximisation|Cross-objective",
    "severity":"Critical|High|Medium|Low",
    "impact":"Very High|High|Medium|Low",
    "effort":"Quick Win|Medium Lift|Strategic Investment",
    "confidence":"Confirmed|Probable|Needs Verification",
    "location":"exact URL, route, component or file",
    "evidence":["..."],
    "exactChange":"...",
    "expectedImpact":"...",
    "rationale":"...",
    "owner":"...",
    "acceptanceCriterion":"...",
    "verificationMethod":"...",
    "crossObjectiveMultiplier":1
  }],
  "dynamicKeywordStrategy":[{"topic":"...","intent":"...","opportunity":"...","evidenceBasis":"...","confidence":"Confirmed|Probable|Needs Verification"}],
  "highValueOpportunities":[{"title":"...","why":"...","exactChange":"...","effort":"Quick Win|Medium Lift|Strategic Investment","confidence":"Confirmed|Probable|Needs Verification"}],
  "limitations":["..."]
}`;

const REPAIR_SYSTEM_PROMPT = `You repair a Digital Growth audit response into the exact JSON contract requested by the original audit.
Use only facts already present in the supplied response. Do not add recommendations, scores, evidence or claims that are not there.
Return JSON only. The result must contain auditCompletionState, scorecard, executiveSummary.top10Actions, findings, dynamicKeywordStrategy, highValueOpportunities and limitations.
A finding must use the Digital Growth fields findingId, title, objective, severity, impact, effort, confidence, location, evidence, exactChange, expectedImpact, rationale, owner, acceptanceCriterion, verificationMethod and crossObjectiveMultiplier.`;

function trim(value) {
  return String(value ?? "").trim();
}

function clamp(value, min, max, fallback = min) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function obj(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstCompleteJsonObject(textValue) {
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
  const text = trim(raw).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!text) throw new Error("Digital growth analysis returned an empty response");
  try {
    return JSON.parse(text);
  } catch {}
  const candidate = firstCompleteJsonObject(text);
  if (!candidate) throw new Error("Digital growth analysis did not contain a complete JSON object");
  return JSON.parse(candidate);
}

function shapeScore(value) {
  const source = obj(value);
  let score = 0;
  if (Array.isArray(source.findings)) score += 8;
  if (Array.isArray(source.rankedIssueLedger)) score += 7;
  if (Array.isArray(source.issues)) score += 6;
  if (source.scorecard && typeof source.scorecard === "object") score += 4;
  if (source.executiveSummary && typeof source.executiveSummary === "object") score += 3;
  if (Array.isArray(source.top10Actions) || Array.isArray(source.topActions)) score += 3;
  if (source.auditCompletionState) score += 1;
  return score;
}

function unwrapAnalysisPayload(value) {
  const root = obj(value);
  const candidates = [root];
  const queue = [{ value: root, depth: 0 }];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current?.value || seen.has(current.value) || current.depth >= 4) continue;
    seen.add(current.value);
    for (const [key, nested] of Object.entries(current.value)) {
      if (!nested || typeof nested !== "object" || Array.isArray(nested)) continue;
      if (["analysis", "result", "output", "response", "data", "audit", "report", "payload", "digitalGrowthAnalysis"].includes(key) || shapeScore(nested) > 0) {
        candidates.push(nested);
      }
      queue.push({ value: nested, depth: current.depth + 1 });
    }
  }
  return candidates.sort((a, b) => shapeScore(b) - shapeScore(a))[0] || root;
}

function normaliseScorecard(value) {
  const input = obj(value);
  const aliases = {
    trafficGrowth: ["trafficGrowth", "traffic", "traffic_growth"],
    newsletterSignUpRate: ["newsletterSignUpRate", "newsletterSignUp", "newsletter", "newsletter_signup_rate"],
    podcastClickThroughs: ["podcastClickThroughs", "podcastClickThrough", "podcast", "podcast_click_throughs"],
    llmDiscoverability: ["llmDiscoverability", "aiDiscoverability", "generativeDiscoverability", "llm_discoverability"],
    ebookSalesMaximisation: ["ebookSalesMaximisation", "ebookSales", "ebookSalesPath", "ebook_sales_maximisation"],
  };
  const scorecard = {};
  for (const [key, label] of OBJECTIVES) {
    const alias = aliases[key].find((candidate) => input[candidate] !== undefined);
    const row = obj(alias ? input[alias] : input[key]);
    const hasScore = row.score !== null && row.score !== undefined && row.score !== "" && Number.isFinite(Number(row.score));
    scorecard[key] = {
      label,
      score: hasScore ? clamp(row.score, 1, 10, 1) : null,
      rationale: trim(row.rationale || row.basis || row.reason) || (hasScore ? "Evidence rationale was not supplied by the analysis." : "The analysis did not return a defensible score for this objective."),
    };
  }
  return scorecard;
}

function normaliseFinding(value, index) {
  const finding = obj(value);
  const validSeverity = new Set(["Critical", "High", "Medium", "Low"]);
  const validImpact = new Set(["Very High", "High", "Medium", "Low"]);
  const validEffort = new Set(["Quick Win", "Medium Lift", "Strategic Investment"]);
  const validConfidence = new Set(["Confirmed", "Probable", "Needs Verification"]);
  const severity = trim(finding.severity || finding.priority);
  const impact = trim(finding.impact || finding.expectedImpactLevel);
  const effort = trim(finding.effort || finding.estimatedEffort);
  const confidence = trim(finding.confidence || finding.findingConfidence);
  return {
    findingId: trim(finding.findingId || finding.issueId || finding.id) || `DG-${String(index + 1).padStart(3, "0")}`,
    title: trim(finding.title || finding.issue || finding.finding || finding.rootCause) || `Digital growth finding ${index + 1}`,
    objective: trim(finding.objective || finding.category) || "Cross-objective",
    severity: validSeverity.has(severity) ? severity : "Medium",
    impact: validImpact.has(impact) ? impact : "Medium",
    effort: validEffort.has(effort) ? effort : "Medium Lift",
    confidence: validConfidence.has(confidence) ? confidence : "Needs Verification",
    location: trim(finding.location || finding.affected || finding.url || finding.path || finding.route) || "Not isolated from supplied evidence",
    evidence: arr(finding.evidence || finding.evidenceBasis || finding.observations).map(trim).filter(Boolean).slice(0, 12),
    exactChange: trim(finding.exactChange || finding.exactRemediation || finding.remediation || finding.recommendation || finding.action) || "Define a verified implementation change before action.",
    expectedImpact: trim(finding.expectedImpact || finding.expectedGain) || "Impact requires verification after implementation.",
    rationale: trim(finding.rationale || finding.whyItMatters || finding.why) || "The evidence did not include a separate rationale.",
    owner: trim(finding.owner || finding.recommendedOwner) || "Website owner",
    acceptanceCriterion: trim(finding.acceptanceCriterion || finding.definitionOfDone) || "The identified defect is no longer present on rerun.",
    verificationMethod: trim(finding.verificationMethod || finding.verification) || "Rerun the digital growth audit and inspect the affected journey.",
    crossObjectiveMultiplier: clamp(finding.crossObjectiveMultiplier, 1, 5, 1),
  };
}

function collectTopActions(source) {
  const executive = obj(source.executiveSummary);
  const values = [
    executive.top10Actions,
    executive.topActions,
    executive.actions,
    executive.priorities,
    source.top10Actions,
    source.topActions,
    source.actions,
    source.actionItems,
    source.priorities,
  ];
  return values.flatMap(arr)
    .map((item) => typeof item === "string" ? trim(item) : trim(item?.action || item?.title || item?.exactChange || item?.exactRemediation))
    .filter(Boolean)
    .slice(0, 10);
}

function collectFindings(source) {
  return [source.findings, source.rankedIssueLedger, source.issues, source.issueLedger, source.recommendations]
    .flatMap(arr)
    .filter((item) => item && typeof item === "object")
    .slice(0, 120);
}

function normaliseAnalysis(data, { fallbackEvidence } = {}) {
  const source = unwrapAnalysisPayload(data);
  const findings = collectFindings(source).map(normaliseFinding);
  const scorecard = normaliseScorecard(source.scorecard || source.scores);
  const top10 = collectTopActions(source);

  if (!findings.length && !top10.length) {
    if (fallbackEvidence) return deterministicAnalysisFallback(fallbackEvidence, "The model response was valid JSON but did not match the required findings/action schema.");
    throw new Error("Digital growth analysis returned neither findings nor a usable top-10 action list");
  }

  return {
    auditType: "digital-growth",
    auditCompletionState: trim(source.auditCompletionState || source.completionState) || "Complete",
    overallVerdict: trim(source.overallVerdict || source.executiveSummary?.overallVerdict || source.summary) || "Digital growth evidence was analysed; see the ranked findings for implementation priorities.",
    scorecard,
    executiveSummary: { top10Actions: top10.length ? top10 : findings.slice(0, 10).map((finding) => finding.exactChange) },
    findings,
    dynamicKeywordStrategy: arr(source.dynamicKeywordStrategy || source.keywordStrategy).slice(0, 40),
    highValueOpportunities: arr(source.highValueOpportunities || source.opportunities).slice(0, 40),
    limitations: arr(source.limitations || source.evidenceLimitations).map((item) => typeof item === "string" ? trim(item) : trim(item?.limitation || item?.description)).filter(Boolean),
  };
}

function compactValue(value, { depth = 0, maxDepth = 5, maxArray = 30, maxKeys = 80, maxString = 1200 } = {}) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > maxString ? `${value.slice(0, maxString)}…` : value;
  if (["number", "boolean"].includes(typeof value)) return value;
  if (depth >= maxDepth) return Array.isArray(value) ? `[${value.length} item(s) omitted at depth limit]` : "[object omitted at depth limit]";
  if (Array.isArray(value)) {
    return value.slice(0, maxArray).map((item) => compactValue(item, { depth: depth + 1, maxDepth, maxArray, maxKeys, maxString }));
  }
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, maxKeys).map(([key, item]) => [key, compactValue(item, { depth: depth + 1, maxDepth, maxArray, maxKeys, maxString })]));
  }
  return trim(value);
}

function compactPage(page) {
  const source = obj(page);
  return compactValue({
    route: source.route || source.path,
    url: source.url,
    status: source.status || source.statusCode,
    title: source.title || source.meta?.title,
    metaDescription: source.metaDescription || source.meta?.metaDescription,
    h1: source.h1,
    headings: arr(source.headings).slice(0, 12),
    ctas: arr(source.ctas).slice(0, 12),
    forms: arr(source.forms).slice(0, 6),
    schemaTypes: source.schemaTypes,
    wordCount: source.wordCount,
    internalLinks: arr(source.internalLinks).slice(0, 15),
    issues: arr(source.issues).slice(0, 12),
  }, { maxArray: 15, maxKeys: 35, maxString: 800 });
}

function compactPayload(payload) {
  const input = obj(payload);
  return {
    auditType: "digital-growth",
    sessionId: input.sessionId,
    baseUrl: input.baseUrl,
    generatedAt: input.generatedAt,
    inventory: compactValue(input.inventory, { maxArray: 25, maxKeys: 60, maxString: 800 }),
    priorityPages: arr(input.priorityPages).slice(0, 25).map(compactPage),
    allRoutes: arr(input.allRoutes).slice(0, 100).map((route) => compactValue(route, { maxArray: 10, maxKeys: 20, maxString: 500 })),
    heuristicIssues: arr(input.heuristicIssues).slice(0, 60).map((issue) => compactValue(issue, { maxArray: 12, maxKeys: 40, maxString: 900 })),
    repoSignals: compactValue(input.repoSignals, { maxArray: 25, maxKeys: 100, maxString: 900 }),
    liveDynamicUrls: arr(input.liveDynamicUrls).slice(0, 40),
    coverage: arr(input.coverage).slice(0, 60).map((item) => compactValue(item, { maxArray: 10, maxKeys: 30, maxString: 700 })),
    conversionEvidence: compactValue(input.conversionEvidence || {}, { maxArray: 25, maxKeys: 60, maxString: 900 }),
    navigationEvidence: compactValue(input.navigationEvidence || {}, { maxArray: 25, maxKeys: 60, maxString: 900 }),
    measurementAvailability: compactValue(input.measurementAvailability || {}, { maxArray: 15, maxKeys: 40, maxString: 600 }),
    websiteAuditPolicy: compactWebsiteAuditPolicy(),
  };
}

function enforcePayloadBudget(evidence, maxChars = Number(process.env.DIGITAL_GROWTH_AI_MAX_INPUT_CHARS || 90000)) {
  const bounded = structuredClone(evidence);
  const size = () => JSON.stringify(bounded).length;
  if (size() <= maxChars) return bounded;
  bounded.allRoutes = arr(bounded.allRoutes).slice(0, 50);
  bounded.coverage = arr(bounded.coverage).slice(0, 30);
  bounded.priorityPages = arr(bounded.priorityPages).slice(0, 18);
  bounded.heuristicIssues = arr(bounded.heuristicIssues).slice(0, 45);
  if (size() <= maxChars) return bounded;
  bounded.repoSignals = compactValue(bounded.repoSignals, { maxDepth: 4, maxArray: 12, maxKeys: 55, maxString: 500 });
  bounded.navigationEvidence = compactValue(bounded.navigationEvidence, { maxDepth: 3, maxArray: 12, maxKeys: 30, maxString: 500 });
  bounded.conversionEvidence = compactValue(bounded.conversionEvidence, { maxDepth: 3, maxArray: 12, maxKeys: 30, maxString: 500 });
  if (size() <= maxChars) return bounded;
  bounded.allRoutes = arr(bounded.allRoutes).slice(0, 20);
  bounded.coverage = arr(bounded.coverage).slice(0, 15);
  bounded.priorityPages = arr(bounded.priorityPages).slice(0, 10);
  bounded.heuristicIssues = arr(bounded.heuristicIssues).slice(0, 20).map((item) => compactValue(item, { maxDepth: 3, maxArray: 6, maxKeys: 20, maxString: 300 }));
  bounded.repoSignals = { summary: "Repository signals were compacted because the verified evidence bundle exceeded the configured AI input budget." };
  bounded.navigationEvidence = {};
  bounded.conversionEvidence = {};
  if (size() <= maxChars) return bounded;
  bounded.allRoutes = arr(bounded.allRoutes).slice(0, 10);
  bounded.coverage = arr(bounded.coverage).slice(0, 8);
  bounded.priorityPages = arr(bounded.priorityPages).slice(0, 6);
  bounded.heuristicIssues = arr(bounded.heuristicIssues).slice(0, 10).map((item) => compactValue(item, { maxDepth: 2, maxArray: 4, maxKeys: 12, maxString: 180 }));
  bounded.inventory = compactValue(bounded.inventory, { maxDepth: 2, maxArray: 8, maxKeys: 20, maxString: 250 });
  bounded.liveDynamicUrls = arr(bounded.liveDynamicUrls).slice(0, 10);
  return bounded;
}

function deterministicAnalysisFallback(payload, reason) {
  const input = obj(payload);
  const heuristic = arr(input.heuristicIssues).slice(0, 80);
  const findings = heuristic.map((item, index) => normaliseFinding({
    ...obj(item),
    findingId: item?.findingId || item?.issueId || item?.id || `DG-H-${String(index + 1).padStart(3, "0")}`,
    confidence: item?.confidence || "Needs Verification",
  }, index));
  const hasDeterministicEvidence = findings.length > 0
    && (arr(input.priorityPages).length > 0
      || arr(input.coverage).length > 0
      || Number(obj(input.inventory).repoRouteCount) > 0);

  if (!findings.length) {
    findings.push(normaliseFinding({
      findingId: "DG-EVIDENCE-001",
      title: "Digital growth synthesis could not be completed",
      objective: "Cross-objective",
      severity: "High",
      impact: "High",
      effort: "Medium Lift",
      confidence: "Confirmed",
      location: input.baseUrl || "Digital growth audit pipeline",
      evidence: [reason],
      exactChange: "Repair the synthesis route, rerun the digital growth stage, and retain this evidence record until a validated response is produced.",
      expectedImpact: "Restores a complete, evidence-led growth audit without discarding the deterministic crawl and repository evidence.",
      rationale: "A failed model response must not erase or falsely complete the source audit.",
      owner: "AIMS audit pipeline owner",
      acceptanceCriterion: "The rerun returns a validated scorecard, findings and top-ten action list.",
      verificationMethod: "Rerun the digital growth analysis and verify the stored response against the required schema.",
    }, 0));
  }

  return {
    auditType: "digital-growth",
    auditCompletionState: hasDeterministicEvidence ? "Complete" : "Incomplete",
    overallVerdict: hasDeterministicEvidence
      ? "The AI synthesis was unavailable or structurally invalid, so AIMS completed this stage deterministically from the retained crawl, route, repository and heuristic evidence. No unsupported scores were invented."
      : "The supplied evidence did not contain enough deterministic findings to complete the Digital Growth stage.",
    scorecard: normaliseScorecard({}),
    executiveSummary: { top10Actions: findings.slice(0, 10).map((finding) => finding.exactChange) },
    findings,
    dynamicKeywordStrategy: [],
    highValueOpportunities: [],
    limitations: [reason, "Objective scores remain unscored because the model synthesis did not complete with a valid response."],
    diagnostics: {
      fallbackUsed: true,
      completionMode: hasDeterministicEvidence ? "deterministic-evidence" : "controlled-failure",
      reason,
    },
  };
}

function retainedRawResponse(value) {
  const raw = String(value || "");
  const configured = Number(process.env.DIGITAL_GROWTH_RAW_RESPONSE_MAX_CHARS || 200000);
  const maxChars = Number.isFinite(configured) && configured > 0 ? configured : 200000;
  return {
    value: raw.length > maxChars ? raw.slice(0, maxChars) : raw,
    originalCharacters: raw.length,
    truncated: raw.length > maxChars,
  };
}

function attachFailureDiagnostics(analysis, { inputCharacters, raw, repairRaw, error, repairError } = {}) {
  const primary = retainedRawResponse(raw);
  const repair = retainedRawResponse(repairRaw);
  analysis.diagnostics = {
    ...(analysis.diagnostics || {}),
    fallbackUsed: true,
    inputCharacters,
    validationError: error ? trim(error?.message || error) : null,
    repairError: repairError ? trim(repairError?.message || repairError) : null,
    rawModelResponse: primary.value || null,
    rawResponseCharacters: primary.originalCharacters,
    rawResponseTruncated: primary.truncated,
    repairModelResponse: repair.value || null,
    repairResponseCharacters: repair.originalCharacters,
    repairResponseTruncated: repair.truncated,
  };
  return analysis;
}

export async function runDigitalGrowthAnalysis(payload) {
  const compacted = compactPayload(payload);
  const evidence = enforcePayloadBudget(compacted);
  const inputCharacters = JSON.stringify(evidence).length;
  let raw = "";
  let repairRaw = "";
  try {
    const { resilientRequest, getProviderDiagnosticsForRoute } = await import("../../services/shared/utils/ai-service.js");
    const diagnostics = getProviderDiagnosticsForRoute("auditForensic");
    const configured = arr(diagnostics.configuredProviders).filter((provider) => provider.configured);
    if (!configured.length) {
      return attachFailureDiagnostics(
        deterministicAnalysisFallback(payload, "No configured auditForensic provider was available."),
        { inputCharacters }
      );
    }

    raw = await resilientRequest("auditForensic", {
      sessionId: payload?.sessionId,
      section: "digital-growth-and-monetisation",
      max_tokens: Number(process.env.DIGITAL_GROWTH_AI_MAX_TOKENS || 12000),
      temperature: Number(process.env.DIGITAL_GROWTH_AI_TEMPERATURE || 0.15),
      timeoutMs: Number(process.env.DIGITAL_GROWTH_AI_TIMEOUT_MS || 240000),
      maxRetries: Number(process.env.DIGITAL_GROWTH_AI_MAX_RETRIES || 0),
      reasoning: false,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Analyse this verified evidence bundle. Return only the required JSON.\n${JSON.stringify(evidence)}` },
      ],
    });

    try {
      const analysis = normaliseAnalysis(extractJson(raw));
      analysis.diagnostics = {
        ...(analysis.diagnostics || {}),
        fallbackUsed: false,
        repairUsed: false,
        inputCharacters,
        rawResponseCharacters: String(raw || "").length,
      };
      return analysis;
    } catch (validationError) {
      try {
        const retained = retainedRawResponse(raw);
        repairRaw = await resilientRequest("auditForensic", {
          sessionId: payload?.sessionId,
          section: "digital-growth-schema-repair",
          max_tokens: Number(process.env.DIGITAL_GROWTH_AI_REPAIR_MAX_TOKENS || 8000),
          temperature: 0,
          timeoutMs: Number(process.env.DIGITAL_GROWTH_AI_REPAIR_TIMEOUT_MS || 120000),
          maxRetries: 0,
          reasoning: false,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: REPAIR_SYSTEM_PROMPT },
            { role: "user", content: `Repair this response without inventing facts.\n${retained.value}` },
          ],
        });
        const repaired = normaliseAnalysis(extractJson(repairRaw));
        repaired.diagnostics = {
          ...(repaired.diagnostics || {}),
          fallbackUsed: false,
          repairUsed: true,
          inputCharacters,
          initialValidationError: trim(validationError?.message || validationError),
          rawResponseCharacters: String(raw || "").length,
          repairResponseCharacters: String(repairRaw || "").length,
        };
        return repaired;
      } catch (repairError) {
        return attachFailureDiagnostics(
          deterministicAnalysisFallback(payload, `Digital growth AI response could not be validated or repaired: ${trim(repairError?.message || repairError)}`),
          { inputCharacters, raw, repairRaw, error: validationError, repairError }
        );
      }
    }
  } catch (err) {
    return attachFailureDiagnostics(
      deterministicAnalysisFallback(payload, err?.message || String(err)),
      { inputCharacters, raw, repairRaw, error: err }
    );
  }
}

export const __digitalGrowthAnalysisTestHooks = {
  extractJson,
  unwrapAnalysisPayload,
  normaliseAnalysis,
  compactPayload,
  enforcePayloadBudget,
  deterministicAnalysisFallback,
  retainedRawResponse,
  attachFailureDiagnostics,
  SYSTEM_PROMPT,
  REPAIR_SYSTEM_PROMPT,
  OBJECTIVES,
};

export default { runDigitalGrowthAnalysis };
