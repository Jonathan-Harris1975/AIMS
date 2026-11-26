/**
 * Deterministic image QA and bounded model-escalation policy.
 * Subjective vision review remains provider-specific; this module owns the
 * non-negotiable technical and governance gates.
 */
import { createHash } from "node:crypto";

const APPROVED_MODELS = new Set();
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_MAX_ESCALATIONS = 1;

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

export function imageFingerprint({ prompt = "", assetId = "", perceptualHash = "" } = {}) {
  return createHash("sha256").update([prompt, assetId, perceptualHash].join("|")).digest("hex");
}

export function validateImageGovernance({ model = "", primary = "", fallback = "", allowedModels = [] } = {}) {
  const allowed = new Set([...APPROVED_MODELS, ...allowedModels].map(String).filter(Boolean));
  const selected = String(model || primary || "").trim();
  if (!selected) throw new Error("Image model is required");
  if (!allowed.size) {
    const error = new Error("Approved image model allowlist is required");
    error.code = "IMAGE_MODEL_ALLOWLIST_REQUIRED";
    error.statusCode = 503;
    throw error;
  }
  if (!allowed.has(selected)) {
    const error = new Error(`Unauthorised image model rejected: ${selected}`);
    error.code = "UNAUTHORISED_IMAGE_MODEL";
    error.statusCode = 422;
    throw error;
  }
  if (fallback && fallback === selected) {
    const error = new Error("Image fallback must differ from primary model");
    error.code = "CIRCULAR_IMAGE_FALLBACK";
    throw error;
  }
  return selected;
}

/**
 * Order only image providers already resolved through AIMS' central artwork
 * route. Explicit model selections outside that route fail closed. With no
 * new policy settings, the existing central route order is preserved.
 */
export function resolveImageProviderPlan({
  providers = [],
  primary,
  qualityTier,
  fallback,
  strategy = "existing-first",
  escalationEnabled = false,
  fallbackEnabled = true,
  maxAttempts,
  maxEscalations = DEFAULT_MAX_ESCALATIONS,
} = {}) {
  const available = Array.isArray(providers) ? providers.filter((provider) => provider?.model) : [];
  const models = [...new Set(available.map((provider) => String(provider.model).trim()).filter(Boolean))];
  if (!models.length) {
    const error = new Error("No centrally configured image models are available");
    error.code = "IMAGE_MODEL_ROUTE_EMPTY";
    error.statusCode = 503;
    throw error;
  }

  const findConfigured = (requested, label) => {
    const model = String(requested || "").trim();
    if (!model) return undefined;
    if (!models.includes(model)) {
      const error = new Error(`${label} image model is not in the central artwork route: ${model}`);
      error.code = "UNAUTHORISED_IMAGE_MODEL";
      error.statusCode = 422;
      throw error;
    }
    return model;
  };

  const primaryModel = findConfigured(primary, "Primary") || models[0];
  const qualityModel = findConfigured(qualityTier, "Quality tier");
  const safeStrategy = ["existing-first", "quality-first", "existing-only"].includes(String(strategy))
    ? String(strategy)
    : "existing-first";
  const configuredFallback = findConfigured(fallback, "Fallback");
  const fallbackModel = configuredFallback || models.find((model) =>
    model !== primaryModel && (safeStrategy !== "quality-first" || model !== qualityModel));
  if (fallbackModel && fallbackModel === primaryModel) {
    const error = new Error("Image fallback must differ from the primary model");
    error.code = "CIRCULAR_IMAGE_FALLBACK";
    error.statusCode = 422;
    throw error;
  }
  if (qualityModel && qualityModel === primaryModel && bool(escalationEnabled)) {
    const error = new Error("Image quality-tier model must differ from the primary model");
    error.code = "DUPLICATE_IMAGE_QUALITY_TIER";
    error.statusCode = 422;
    throw error;
  }
  const allowFallback = safeStrategy !== "existing-only" && bool(fallbackEnabled, true);
  const allowEscalation = safeStrategy !== "existing-only" && bool(escalationEnabled);
  const escalationLimit = Math.max(0, Math.min(2, Number(maxEscalations) || 0));

  let sequence;
  if (safeStrategy === "quality-first") {
    if (!qualityModel) {
      const error = new Error("Quality-first image strategy requires a centrally configured quality-tier model");
      error.code = "IMAGE_QUALITY_TIER_REQUIRED";
      error.statusCode = 503;
      throw error;
    }
    sequence = [qualityModel, primaryModel];
  } else {
    sequence = [primaryModel];
    if (allowEscalation && escalationLimit > 0 && qualityModel) sequence.push(qualityModel);
  }
  if (allowFallback && fallbackModel) sequence.push(fallbackModel);

  const orderedModels = [...new Set(sequence)].slice(0, Math.max(1, Math.min(3, Number(maxAttempts) || 3)));
  return {
    strategy: safeStrategy,
    models: orderedModels,
    providers: orderedModels.map((model) => available.find((provider) => provider.model === model)),
    primaryModel,
    qualityTierModel: qualityModel || null,
    fallbackModel: allowFallback ? fallbackModel || null : null,
    escalationEnabled: allowEscalation && Boolean(qualityModel),
    fallbackEnabled: allowFallback,
    maxAttempts: orderedModels.length,
    maxEscalations: allowEscalation && qualityModel ? Math.min(1, escalationLimit) : 0,
  };
}

export function chooseImageModel({
  primary,
  fallback,
  escalationModel,
  escalationEnabled = false,
  fallbackEnabled = true,
  attempt = 1,
  escalationCount = 0,
  maxEscalations = DEFAULT_MAX_ESCALATIONS,
  allowedModels = [],
} = {}) {
  const base = validateImageGovernance({ model: primary, fallback, allowedModels });
  if (
    bool(escalationEnabled)
    && attempt > 1
    && escalationCount < Number(maxEscalations)
    && escalationModel
  ) {
    return validateImageGovernance({ model: escalationModel, primary: escalationModel, fallback, allowedModels });
  }
  if (attempt > 1 && bool(fallbackEnabled) && fallback) return validateImageGovernance({ model: fallback, primary: fallback, allowedModels });
  return base;
}

export function imageQualityScore({
  relevance = 0,
  visualQuality = 0,
  composition = 0,
  brand = 0,
  originality = 0,
  platform = 0,
  technical = 0,
  criticalDefects = [],
} = {}) {
  const score = Math.round(
    relevance * 0.25
    + visualQuality * 0.2
    + composition * 0.15
    + brand * 0.15
    + originality * 0.1
    + platform * 0.1
    + technical * 0.05,
  );
  const defects = Array.isArray(criticalDefects) ? criticalDefects : [];
  return {
    score: Math.max(0, Math.min(100, score)),
    criticalDefects: defects,
    pass: !defects.length && score >= 75,
  };
}

export function boundedImageAttempts({ maxAttempts = DEFAULT_MAX_ATTEMPTS, maxEscalations = DEFAULT_MAX_ESCALATIONS } = {}) {
  return {
    maxAttempts: Math.max(1, Math.min(3, Number(maxAttempts) || DEFAULT_MAX_ATTEMPTS)),
    maxEscalations: Math.max(0, Math.min(2, Number.isFinite(Number(maxEscalations)) ? Number(maxEscalations) : DEFAULT_MAX_ESCALATIONS)),
  };
}

export function buildTargetedRepairPrompt({ basePrompt = "", defects = [] } = {}) {
  const unique = [...new Set(
    (Array.isArray(defects) ? defects : [])
      .map(String)
      .map((v) => v.trim())
      .filter(Boolean),
  )].slice(0, 5);
  const correction = unique.join("; ") || "improve topic relevance and mobile composition";
  return [
    String(basePrompt).trim(),
    `Targeted correction only: ${correction}.`,
    "Preserve successful subject, theme and brand constraints.",
    "Do not repeat the rejected defect.",
  ].join(" ");
}

export default {
  imageFingerprint,
  validateImageGovernance,
  resolveImageProviderPlan,
  chooseImageModel,
  imageQualityScore,
  boundedImageAttempts,
  buildTargetedRepairPrompt,
};
