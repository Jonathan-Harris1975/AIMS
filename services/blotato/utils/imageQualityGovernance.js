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
  if (allowed.size && !allowed.has(selected)) {
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
  chooseImageModel,
  imageQualityScore,
  boundedImageAttempts,
  buildTargetedRepairPrompt,
};
