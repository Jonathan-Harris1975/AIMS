const DEFAULT_TARGET_MINUTES = 50;
const DEFAULT_MAX_MINUTES = 70;
const ABSOLUTE_MAX_MINUTES = 70;

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function resolvePodcastDurationPolicy(env = process.env) {
  const targetMinutes = positiveNumber(
    env.PODCAST_TARGET_MINUTES || env.PODCAST_TARGET_MINS || env.PODCAST_DURATION_MINUTES || env.PODCAST_DURATION_MINS,
    DEFAULT_TARGET_MINUTES,
  );
  const configuredMaxMinutes = positiveNumber(env.PODCAST_MAX_MINUTES, DEFAULT_MAX_MINUTES);
  const maxMinutes = Math.min(configuredMaxMinutes, ABSOLUTE_MAX_MINUTES);

  return {
    targetMinutes,
    configuredMaxMinutes,
    maxMinutes,
    maxSeconds: maxMinutes * 60,
    absoluteMaxMinutes: ABSOLUTE_MAX_MINUTES,
    valid: targetMinutes >= 30 && targetMinutes <= maxMinutes && configuredMaxMinutes >= 60 && configuredMaxMinutes <= ABSOLUTE_MAX_MINUTES,
  };
}

export function buildAtempoFilter(factor) {
  let remaining = Number(factor);
  if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("Tempo factor must be a positive number.");

  const parts = [];
  while (remaining > 2) {
    parts.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5) {
    parts.push(0.5);
    remaining /= 0.5;
  }
  parts.push(remaining);
  return parts.map((value) => `atempo=${Number(value.toFixed(6))}`).join(",");
}

export function calculateMainAudioFit({ mainSeconds, introSeconds = 0, outroSeconds = 0, maxSeconds, safetySeconds = 1 } = {}) {
  const main = Number(mainSeconds);
  const intro = Number(introSeconds) || 0;
  const outro = Number(outroSeconds) || 0;
  const maximum = Number(maxSeconds);
  if (![main, maximum].every(Number.isFinite) || main <= 0 || maximum <= 0) {
    throw new Error("Valid mainSeconds and maxSeconds are required.");
  }

  const originalTotalSeconds = main + intro + outro;
  const availableMainSeconds = Math.max(1, maximum - intro - outro - Math.max(0, Number(safetySeconds) || 0));
  const requiredTempo = main > availableMainSeconds ? main / availableMainSeconds : 1;

  return {
    needsAdjustment: requiredTempo > 1.0005,
    requiredTempo,
    availableMainSeconds,
    originalTotalSeconds,
    projectedTotalSeconds: (main / requiredTempo) + intro + outro,
  };
}

export const PODCAST_DURATION_DEFAULTS = Object.freeze({
  targetMinutes: DEFAULT_TARGET_MINUTES,
  maxMinutes: DEFAULT_MAX_MINUTES,
  absoluteMaxMinutes: ABSOLUTE_MAX_MINUTES,
});

export default { resolvePodcastDurationPolicy, buildAtempoFilter, calculateMainAudioFit, PODCAST_DURATION_DEFAULTS };
