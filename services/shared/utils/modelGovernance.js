import { readFileSync } from "node:fs";
import { getObjectAsText, putPrivateJson } from "./r2-client.js";
import { info, warn } from "../../../logger.js";

const BUCKET = "metaSystem";
const KEY = "state/model-governance/aims.json";
const POLICY = JSON.parse(
  readFileSync(new URL("../../../config/model-governance-policy.json", import.meta.url), "utf8"),
);
const ALLOWED_ENV_NAMES = Object.freeze([...POLICY.assignmentEnvironmentVariables]);
const ALLOWED_COST_TIERS = new Set(POLICY.costTiers.map((tier) => tier.id));
let activeGovernance = null;

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function list(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function validDate(value) {
  const cleaned = text(value);
  return cleaned && Number.isFinite(Date.parse(cleaned)) ? new Date(cleaned).toISOString() : null;
}

function nextMonthlyReview(from) {
  const date = new Date(validDate(from) || Date.now());
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString();
}

function rankedModels(registry, category) {
  const items = Array.isArray(registry?.[category]) ? registry[category] : [];
  return items
    .filter((item) => item && typeof item === "object" && text(item.model_id))
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
}

function firstModel(registry, ...categories) {
  for (const category of categories) {
    const model = rankedModels(registry, category)[0]?.model_id;
    if (model) return text(model);
  }
  return "";
}

function fallbackModel(registry, primary) {
  const candidates = [
    ...rankedModels(registry, "reasoning"),
    ...rankedModels(registry, "planning"),
    ...rankedModels(registry, "fast"),
  ];
  return text(candidates.find((item) => text(item.model_id) !== primary)?.model_id || primary);
}

function validateExplicitAssignments(assignments) {
  if (assignments === undefined || assignments === null) return {};
  if (typeof assignments !== "object" || Array.isArray(assignments)) {
    throw new TypeError("assignments must be an object keyed by an AIMS model environment variable");
  }

  const unsupported = Object.keys(assignments).filter((name) => !ALLOWED_ENV_NAMES.includes(name));
  if (unsupported.length) {
    throw new Error(`Unsupported AIMS model assignment variables: ${unsupported.join(", ")}`);
  }

  return Object.fromEntries(
    Object.entries(assignments)
      .map(([name, value]) => [name, text(value)])
      .filter(([, value]) => Boolean(value)),
  );
}

export function buildAimsModelAssignments(registry = {}, explicitAssignments = {}) {
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    throw new TypeError("registry must be an object keyed by HIVE model category");
  }

  const standard = firstModel(registry, "reasoning", "planning");
  const fast = firstModel(registry, "fast", "cheap");
  const highQuality = firstModel(registry, "planning", "reasoning", "creative");
  const audit = firstModel(registry, "research", "reasoning", "long_context");
  const json = firstModel(registry, "planning", "reasoning");
  const summary = firstModel(registry, "fast", "cheap", "reasoning");
  const fallback = fallbackModel(registry, standard);
  const rankedAssignments = Object.fromEntries(Object.entries({
    AI_MODEL_FAST: fast,
    AI_MODEL_STANDARD: standard,
    AI_MODEL_HIGH_QUALITY: highQuality,
    AI_MODEL_FALLBACK: fallback,
    AI_MODEL_JSON: json,
    AI_MODEL_SUMMARY: summary,
    AI_MODEL_AUDIT: audit,
  }).filter(([, value]) => Boolean(value)));

  return { ...rankedAssignments, ...validateExplicitAssignments(explicitAssignments) };
}

export function inferModelCostTier(modelId) {
  const model = text(modelId).toLowerCase();
  if (!model) return "unknown";

  for (const tier of ["free", "economy", "balanced", "expert"]) {
    if ((POLICY.modelTierSignals[tier] || []).some((signal) => model.includes(signal))) return tier;
  }
  return "unknown";
}

function normaliseDecision(rawDecision, assignment, modelId) {
  const raw = rawDecision && typeof rawDecision === "object" && !Array.isArray(rawDecision)
    ? rawDecision
    : {};
  const suppliedTier = text(raw.costTier).toLowerCase();
  const inferredTier = inferModelCostTier(modelId);
  const costTier = inferredTier === "expert"
    ? "expert"
    : ALLOWED_COST_TIERS.has(suppliedTier) ? suppliedTier : inferredTier;
  const expectedMonthlyUsd = Number(raw.expectedMonthlyUsd);

  return {
    assignment,
    modelId,
    justificationId: text(raw.justificationId) || null,
    task: text(raw.task) || null,
    complexity: text(raw.complexity).toLowerCase() || null,
    costTier,
    cheaperAlternative: text(raw.cheaperAlternative) || null,
    justification: text(raw.justification) || null,
    evaluationEvidence: list(raw.evaluationEvidence),
    approvedBy: text(raw.approvedBy) || null,
    expectedMonthlyUsd: Number.isFinite(expectedMonthlyUsd) && expectedMonthlyUsd >= 0
      ? expectedMonthlyUsd
      : null,
  };
}

function normaliseDecisions(assignments, decisions = {}) {
  const input = decisions && typeof decisions === "object" && !Array.isArray(decisions) ? decisions : {};
  return Object.fromEntries(Object.entries(assignments).map(([assignment, modelId]) => {
    const raw = input[assignment] || input[modelId] || {};
    return [assignment, normaliseDecision(raw, assignment, modelId)];
  }));
}

function normaliseRetiringModels(retiringModels = []) {
  if (!Array.isArray(retiringModels)) return [];
  return retiringModels.map((entry) => {
    if (typeof entry === "string") return { modelId: text(entry), retirementDate: null, replacement: null };
    return {
      modelId: text(entry?.modelId || entry?.model_id),
      retirementDate: validDate(entry?.retirementDate || entry?.expiration_date),
      replacement: text(entry?.replacement) || null,
    };
  }).filter((entry) => entry.modelId);
}

function advisory(code, message, details = {}) {
  return { code, severity: "review", message, ...details };
}

export function buildAimsModelAdvisories({
  assignments = {},
  decisions = {},
  retiringModels = [],
  catalogueCheckedAt,
} = {}) {
  const advisories = [];
  if (!validDate(catalogueCheckedAt)) {
    advisories.push(advisory(
      "catalogue-check-not-recorded",
      "Record when the OpenRouter catalogue was checked during the council review.",
    ));
  }

  for (const [assignment, decision] of Object.entries(decisions)) {
    if (decision.costTier === "unknown") {
      advisories.push(advisory(
        "cost-tier-unclassified",
        `${assignment} has no recognised cost tier.`,
        { assignment, modelId: decision.modelId },
      ));
    }
    if (decision.costTier !== "expert") continue;

    const missing = POLICY.expertJustificationFields.filter((field) => {
      const value = decision[field];
      return Array.isArray(value) ? value.length === 0 : !value;
    });
    if (missing.length) {
      advisories.push(advisory(
        "expert-justification-incomplete",
        `${assignment} uses an expert model without a complete decision record.`,
        { assignment, modelId: decision.modelId, missing },
      ));
    }
  }

  for (const retirement of retiringModels) {
    for (const [assignment, modelId] of Object.entries(assignments)) {
      if (modelId !== retirement.modelId) continue;
      advisories.push(advisory(
        "assigned-model-retiring",
        `${assignment} is assigned to a model marked for retirement.`,
        { assignment, modelId, retirementDate: retirement.retirementDate, replacement: retirement.replacement },
      ));
    }
  }
  return advisories;
}

function applyAssignments(assignments) {
  for (const [name, rawValue] of Object.entries(assignments || {})) {
    if (!ALLOWED_ENV_NAMES.includes(name)) continue;
    const value = text(rawValue);
    if (!value) throw new Error(`Invalid persisted model assignment for ${name}`);
    process.env[name] = value;
  }
}

function currentAssignments() {
  return Object.fromEntries(ALLOWED_ENV_NAMES
    .map((name) => [name, text(process.env[name])])
    .filter(([, value]) => Boolean(value)));
}

export async function applyAimsModelGovernance({
  registry = {},
  assignments: explicitAssignments = {},
  decisions = {},
  retiringModels = [],
  sourceRunId,
  councilDate,
  catalogueCheckedAt,
  nextReviewDueAt,
} = {}) {
  const assignments = buildAimsModelAssignments(registry, explicitAssignments);
  const cleanSourceRunId = text(sourceRunId);
  if (!cleanSourceRunId) throw new Error("sourceRunId is required");
  if (!Object.keys(assignments).length) {
    return {
      ok: true,
      applied: false,
      persisted: false,
      reason: "no-compatible-ranked-models-or-explicit-assignments",
      sourceRunId: cleanSourceRunId,
    };
  }

  const appliedAt = new Date().toISOString();
  const checkedAt = validDate(catalogueCheckedAt);
  const decisionRecords = normaliseDecisions(assignments, decisions);
  const retiring = normaliseRetiringModels(retiringModels);
  const advisories = buildAimsModelAdvisories({
    assignments,
    decisions: decisionRecords,
    retiringModels: retiring,
    catalogueCheckedAt: checkedAt,
  });
  const payload = {
    schemaVersion: "aims-model-governance/v2",
    source: "HIVE AI Council",
    service: "AIMS",
    sourceRunId: cleanSourceRunId,
    councilDate: validDate(councilDate) || checkedAt || appliedAt,
    catalogueCheckedAt: checkedAt,
    appliedAt,
    nextReviewDueAt: validDate(nextReviewDueAt) || nextMonthlyReview(checkedAt || appliedAt),
    spendControl: {
      mode: "advisory",
      runtimeRequestBlocking: false,
      hardSpendCaps: false,
    },
    assignments,
    decisions: decisionRecords,
    retiringModels: retiring,
    advisories,
    compliant: advisories.length === 0,
  };

  // Persist before mutating the process so a successful response means the
  // selection survives restart. Advisory findings never prevent persistence.
  await putPrivateJson(BUCKET, KEY, payload);
  applyAssignments(assignments);
  activeGovernance = payload;
  info("model-governance.aims.applied", {
    sourceRunId: payload.sourceRunId,
    assignmentCount: Object.keys(assignments).length,
    advisoryCount: advisories.length,
    spendControlMode: payload.spendControl.mode,
  });
  return { ok: true, applied: true, persisted: true, key: KEY, ...payload };
}

export async function restoreAimsModelGovernance() {
  let payload;
  try {
    payload = JSON.parse(await getObjectAsText(BUCKET, KEY));
  } catch (error) {
    const errorText = text(error?.name || error?.Code || error?.message || error);
    if (/NoSuchKey|not\s*found|404/i.test(errorText)) {
      return { ok: true, restored: false, reason: "no-persisted-model-governance" };
    }
    warn("model-governance.aims.restore-failed", { error: error?.message || String(error) });
    return { ok: false, restored: false, error: error?.message || String(error) };
  }

  applyAssignments(payload?.assignments);
  activeGovernance = {
    ...payload,
    decisions: payload?.decisions || {},
    retiringModels: Array.isArray(payload?.retiringModels) ? payload.retiringModels : [],
    advisories: Array.isArray(payload?.advisories) ? payload.advisories : [],
    nextReviewDueAt: validDate(payload?.nextReviewDueAt)
      || nextMonthlyReview(payload?.catalogueCheckedAt || payload?.appliedAt),
    spendControl: {
      ...(payload?.spendControl || {}),
      mode: "advisory",
      runtimeRequestBlocking: false,
      hardSpendCaps: false,
    },
  };
  info("model-governance.aims.restored", { sourceRunId: payload?.sourceRunId || null });
  return { ok: true, restored: true, sourceRunId: payload?.sourceRunId || null };
}

export function getAimsModelGovernanceStatus() {
  if (activeGovernance) {
    const advisories = [...(activeGovernance.advisories || [])];
    const reviewDue = validDate(activeGovernance.nextReviewDueAt);
    if (reviewDue && Date.now() > Date.parse(reviewDue)
      && !advisories.some((item) => item.code === "council-review-overdue")) {
      advisories.push(advisory(
        "council-review-overdue",
        "The recorded monthly model council review date has passed.",
        { nextReviewDueAt: reviewDue },
      ));
    }
    return {
      ok: true,
      configured: true,
      ...activeGovernance,
      advisories,
      compliant: activeGovernance.compliant === true && advisories.length === 0,
    };
  }
  return {
    ok: true,
    configured: false,
    service: "AIMS",
    source: "committed-defaults",
    spendControl: {
      mode: "advisory",
      runtimeRequestBlocking: false,
      hardSpendCaps: false,
    },
    assignments: currentAssignments(),
    decisions: {},
    retiringModels: [],
    advisories: [advisory(
      "council-decision-not-loaded",
      "A persisted HIVE AI Council decision has not been loaded; committed AIMS defaults remain active.",
    )],
    compliant: false,
  };
}

export function getAimsModelSpendContext({ modelId, assignmentEnv } = {}) {
  const model = text(modelId);
  const status = getAimsModelGovernanceStatus();
  const decision = status.decisions?.[assignmentEnv]
    || Object.values(status.decisions || {}).find((entry) => entry?.modelId === model)
    || null;
  const costTier = decision?.costTier || inferModelCostTier(model);
  const completeJustification = costTier !== "expert"
    || POLICY.expertJustificationFields.every((field) => {
      const value = decision?.[field];
      return Array.isArray(value) ? value.length > 0 : Boolean(value);
    });

  return {
    spendControlMode: "advisory",
    runtimeRequestBlocking: false,
    sourceRunId: status.sourceRunId || null,
    costTier,
    justificationStatus: costTier === "expert"
      ? completeJustification ? "recorded" : "review-required"
      : "not-required",
    justificationId: decision?.justificationId || null,
  };
}

export const AIMS_MODEL_GOVERNANCE_POLICY = Object.freeze(POLICY);
