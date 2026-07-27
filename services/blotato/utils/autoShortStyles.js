const ROTATION_DAYS = Math.max(1, Number(process.env.BLOTATO_AUTOSHORT_ROTATION_DAYS || 12));
const REQUIRED_STYLE_COUNT = 48;

function configuredTemplateIds() {
  return String(process.env.BLOTATO_AUTOSHORT_TEMPLATE_IDS || "")
    .split(/[\n,;]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function utcDayNumber(date = new Date()) {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000);
}

export function getAutoShortStyleRotation(date = new Date()) {
  const ids = configuredTemplateIds();
  if (ids.length !== REQUIRED_STYLE_COUNT) {
    const err = new Error(
      `BLOTATO_AUTOSHORT_TEMPLATE_IDS must contain exactly ${REQUIRED_STYLE_COUNT} Blotato AutoShort template IDs; received ${ids.length}.`
    );
    err.statusCode = 503;
    err.code = "BLOTATO_AUTOSHORT_STYLE_CONFIG_INCOMPLETE";
    throw err;
  }

  const cycle = Math.floor(utcDayNumber(date) / ROTATION_DAYS);
  const index = ((cycle % REQUIRED_STYLE_COUNT) + REQUIRED_STYLE_COUNT) % REQUIRED_STYLE_COUNT;
  return {
    templateId: ids[index],
    styleNumber: index + 1,
    styleCount: REQUIRED_STYLE_COUNT,
    rotationDays: ROTATION_DAYS,
    cycle,
  };
}

export function getAutoShortStyleConfigSummary() {
  const ids = configuredTemplateIds();
  return {
    configured: ids.length === REQUIRED_STYLE_COUNT,
    configuredCount: ids.length,
    requiredCount: REQUIRED_STYLE_COUNT,
    rotationDays: ROTATION_DAYS,
  };
}
