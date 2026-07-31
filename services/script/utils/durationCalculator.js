// ============================================================
// ⏱️ Duration Calculator (Automatic Episode Length Rotation)
// ============================================================
//
// Single source of truth for planned podcast length. The script
// prompts, episode metadata, and RSS duration fallback all read from
// this deterministic plan so 30/45/50/60 minute episode plans do not drift.
// ============================================================

import { rotateDurations } from "./durationRotator.js";

const DURATION_SEQUENCE_MINS = [30, 45, 50, 60];

const DURATION_PROFILES = {
  30: { introSeconds: 70, outroSeconds: 75 },
  45: { introSeconds: 80, outroSeconds: 85 },
  50: { introSeconds: 85, outroSeconds: 90 },
  60: { introSeconds: 90, outroSeconds: 95 },
};

function normalizeSessionId(input) {
  if (!input) return "session-unknown";
  if (typeof input === "string") return input;
  if (typeof input === "object") {
    const sid = String(input.sessionId || input.id || "").trim();
    const date = String(input.date || "").trim();
    return [sid, date].filter(Boolean).join("-") || "session-unknown";
  }
  return "session-unknown";
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i);
  return Math.abs(h);
}

function numericCandidate(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function normaliseAllowedTargetMins(...values) {
  const n = numericCandidate(...values);
  if (!n) return null;

  const exact = DURATION_SEQUENCE_MINS.find((mins) => mins === Math.round(n));
  if (exact) return exact;

  // Snap unknown values to the nearest supported runtime rather than
  // silently creating a fourth profile the rest of the system does not know.
  return DURATION_SEQUENCE_MINS.reduce((best, mins) =>
    Math.abs(mins - n) < Math.abs(best - n) ? mins : best
  );
}

function explicitTargetMins(input = {}) {
  if (typeof input !== "object" || !input) return null;

  return normaliseAllowedTargetMins(
    input.targetMins,
    input.targetMinutes,
    input.durationMins,
    input.durationMinutes,
    input.episodeLengthMins,
    input.episodeLengthMinutes,
    input.runtimeMins,
    input.runtimeMinutes
  );
}

function envTargetMins() {
  return normaliseAllowedTargetMins(
    process.env.PODCAST_TARGET_MINS,
    process.env.PODCAST_TARGET_MINUTES,
    process.env.PODCAST_DURATION_MINS,
    process.env.PODCAST_DURATION_MINUTES
  );
}

function autoSelectTargetMins(sessionIdNormalized) {
  const h = hashCode(sessionIdNormalized);
  return DURATION_SEQUENCE_MINS[h % DURATION_SEQUENCE_MINS.length];
}

export function resolveTargetMins(sessionMeta = {}) {
  const explicit = explicitTargetMins(sessionMeta);
  if (explicit) return explicit;

  const fromEnv = envTargetMins();
  if (fromEnv) return fromEnv;

  return autoSelectTargetMins(normalizeSessionId(sessionMeta));
}

export function buildDurationPlan(sessionMeta = {}, articleCount = 0) {
  const targetMins = resolveTargetMins(sessionMeta);
  const profile = DURATION_PROFILES[targetMins] || DURATION_PROFILES[50];
  const totalSeconds = targetMins * 60;

  // Raw split before normalization. mainSeconds has a 300s floor so very
  // short/misconfigured profiles never collapse the main section — but that
  // floor can push the raw sum above the target, so run it through
  // rotateDurations() to rescale intro/main/outro back to fit exactly.
  const rawIntro = profile.introSeconds;
  const rawOutro = profile.outroSeconds;
  const rawMain = Math.max(300, totalSeconds - rawIntro - rawOutro);

  const rotated = rotateDurations({
    targetMins,
    introSeconds: rawIntro,
    mainSeconds: rawMain,
    outroSeconds: rawOutro,
  });

  return {
    targetMins,
    targetMinutes: targetMins,
    targetLabel: `${targetMins} minute`,
    totalSeconds,
    plannedDurationSeconds: totalSeconds,
    introSeconds: rotated.introSeconds,
    mainSeconds: rotated.mainSeconds,
    outroSeconds: rotated.outroSeconds,
    articleCount: Number.isFinite(Number(articleCount)) ? Number(articleCount) : 0,
  };
}

export function calculateDuration(section, sessionMeta = {}, articleCount = 0) {
  const plan = buildDurationPlan(sessionMeta, articleCount);

  if (section === "intro") {
    return { ...plan, sectionSeconds: plan.introSeconds };
  }
  if (section === "outro") {
    return { ...plan, sectionSeconds: plan.outroSeconds };
  }
  if (section === "main") {
    return { ...plan, sectionSeconds: plan.mainSeconds };
  }

  return plan;
}

export default { calculateDuration, buildDurationPlan, resolveTargetMins };
