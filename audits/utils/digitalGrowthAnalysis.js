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

function normaliseScorecard(value) {
  const input = obj(value);
  const scorecard = {};
  for (const [key, label] of OBJECTIVES) {
    const row = obj(input[key]);
    const hasScore = row.score !== null && row.score !== undefined && row.score !== "" && Number.isFinite(Number(row.score));
    scorecard[key] = {
      label,
      score: hasScore ? clamp(row.score, 1, 10, 1) : null,
      rationale: trim(row.rationale) || (hasScore ? "Evidence rationale was not supplied by the analysis." : "The analysis did not return a defensible score for this objective."),
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
  return {
    findingId: trim(finding.findingId || finding.issueId) || `DG-${String(index + 1).padStart(3, "0")}`,
    title: trim(finding.title) || `Digital growth finding ${index + 1}`,
    objective: trim(finding.objective) || "Cross-objective",
    severity: validSeverity.has(finding.severity) ? finding.severity : "Medium",
    impact: validImpact.has(finding.impact) ? finding.impact : "Medium",
    effort: validEffort.has(finding.effort) ? finding.effort : "Medium Lift",
    confidence: validConfidence.has(finding.confidence) ? finding.confidence : "Needs Verification",
    location: trim(finding.location || finding.affected || finding.url || finding.path) || "Not isolated from supplied evidence",
    evidence: arr(finding.evidence).map(trim).filter(Boolean).slice(0, 12),
    exactChange: trim(finding.exactChange || finding.remediation || finding.recommendation) || "Define a verified implementation change before action.",
    expectedImpact: trim(finding.expectedImpact) || "Impact requires verification after implementation.",
    rationale: trim(finding.rationale || finding.whyItMatters) || "The evidence did not include a separate rationale.",
    owner: trim(finding.owner) || "Website owner",
    acceptanceCriterion: trim(finding.acceptanceCriterion) || "The identified defect is no longer present on rerun.",
    verificationMethod: trim(finding.verificationMethod) || "Rerun the digital growth audit and inspect the affected journey.",
    crossObjectiveMultiplier: clamp(finding.crossObjectiveMultiplier, 1, 5, 1),
  };
}

function normaliseAnalysis(data) {
  const source = obj(data);
  const findings = arr(source.findings || source.rankedIssueLedger).map(normaliseFinding);
  const scorecard = normaliseScorecard(source.scorecard);
  const top10 = arr(source.executiveSummary?.top10Actions || source.top10Actions)
    .map((item) => typeof item === "string" ? trim(item) : trim(item?.action || item?.title || item?.exactChange))
    .filter(Boolean)
    .slice(0, 10);

  if (!findings.length && !top10.length) {
    throw new Error("Digital growth analysis returned neither findings nor a usable top-10 action list");
  }

  return {
    auditType: "digital-growth",
    auditCompletionState: trim(source.auditCompletionState) || "Complete",
    overallVerdict: trim(source.overallVerdict) || "Digital growth evidence was analysed; see the ranked findings for implementation priorities.",
    scorecard,
    executiveSummary: { top10Actions: top10.length ? top10 : findings.slice(0, 10).map((finding) => finding.exactChange) },
    findings,
    dynamicKeywordStrategy: arr(source.dynamicKeywordStrategy).slice(0, 40),
    highValueOpportunities: arr(source.highValueOpportunities).slice(0, 40),
    limitations: arr(source.limitations).map(trim).filter(Boolean),
  };
}

function compactPayload(payload) {
  const input = obj(payload);
  return {
    auditType: "digital-growth",
    sessionId: input.sessionId,
    baseUrl: input.baseUrl,
    generatedAt: input.generatedAt,
    inventory: input.inventory,
    priorityPages: arr(input.priorityPages).slice(0, 40),
    allRoutes: arr(input.allRoutes).slice(0, 160),
    heuristicIssues: arr(input.heuristicIssues).slice(0, 80),
    repoSignals: input.repoSignals,
    liveDynamicUrls: arr(input.liveDynamicUrls).slice(0, 60),
    coverage: arr(input.coverage).slice(0, 80),
    conversionEvidence: input.conversionEvidence || {},
    navigationEvidence: input.navigationEvidence || {},
    measurementAvailability: input.measurementAvailability || {},
    websiteAuditPolicy: compactWebsiteAuditPolicy(),
  };
}

export async function runDigitalGrowthAnalysis(payload) {
  const { resilientRequest, getProviderDiagnosticsForRoute } = await import("../../services/shared/utils/ai-service.js");
  const diagnostics = getProviderDiagnosticsForRoute("auditForensic");
  const configured = arr(diagnostics.configuredProviders).filter((provider) => provider.configured);
  if (!configured.length) {
    throw new Error("Digital growth analysis unavailable: no configured auditForensic provider");
  }

  const evidence = compactPayload(payload);
  const raw = await resilientRequest("auditForensic", {
    sessionId: payload?.sessionId,
    section: "digital-growth-and-monetisation",
    max_tokens: Number(process.env.DIGITAL_GROWTH_AI_MAX_TOKENS || 10000),
    temperature: Number(process.env.DIGITAL_GROWTH_AI_TEMPERATURE || 0.15),
    top_p: Number(process.env.DIGITAL_GROWTH_AI_TOP_P || 0.95),
    timeoutMs: Number(process.env.DIGITAL_GROWTH_AI_TIMEOUT_MS || 240000),
    maxRetries: Number(process.env.DIGITAL_GROWTH_AI_MAX_RETRIES || 0),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Analyse this verified evidence bundle. Return only the required JSON.\n${JSON.stringify(evidence)}` },
    ],
  });

  return normaliseAnalysis(extractJson(raw));
}

export const __digitalGrowthAnalysisTestHooks = {
  extractJson,
  normaliseAnalysis,
  compactPayload,
  SYSTEM_PROMPT,
  OBJECTIVES,
};

export default { runDigitalGrowthAnalysis };
