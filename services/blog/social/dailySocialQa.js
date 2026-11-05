const DAILY_SOCIAL_ADVISORY_DEFECTS = Object.freeze([
  /British English drift/i,
  /Banned or hype phrase detected/i,
  /Sentence length exceeds the autonomous readability limit/i,
  /Social caption is too thin for autonomous scheduling/i,
  /At least three hashtags are required/i,
  /No more than eight hashtags are allowed/i,
  /Hashtags must be plain #CamelCase tags/i,
  /Too many hashtags for organic cross-platform posting/i,
]);

function isDailySocialAdvisoryDefect(defect) {
  return DAILY_SOCIAL_ADVISORY_DEFECTS.some((pattern) => pattern.test(String(defect || "")));
}

export function advisoryDailySocialGate(gate = {}, reason = "quality-review-exhausted") {
  const validGate = Boolean(
    gate
    && typeof gate === "object"
    && typeof gate.ok === "boolean"
    && Array.isArray(gate.defects)
  );
  const originalDefects = validGate ? gate.defects.map(String) : [];
  const advisoryDefects = originalDefects.filter(isDailySocialAdvisoryDefect);
  const blockingDefects = originalDefects.filter((defect) => !isDailySocialAdvisoryDefect(defect));
  const explicitHardFailure = Boolean(
    gate?.hardFailure
    || gate?.hardGateFailed
    || Number(gate?.hardFailureCount || 0) > 0
    || (Array.isArray(gate?.hardDefects) && gate.hardDefects.length > 0)
  );
  const canPublishWithAdvisories = validGate && !explicitHardFailure && blockingDefects.length === 0;
  const warnings = [...new Set([...(Array.isArray(gate?.warnings) ? gate.warnings : []), ...advisoryDefects])];

  return {
    ...gate,
    ok: canPublishWithAdvisories,
    advisory: canPublishWithAdvisories,
    publicationBlocked: !canPublishWithAdvisories,
    advisoryReason: reason,
    originalDefects,
    advisoryDefects,
    blockingDefects: explicitHardFailure && blockingDefects.length === 0
      ? ["Gate reported an explicit hard failure."]
      : blockingDefects,
    warnings,
  };
}
