const ROTATION_DAYS = Math.max(1, Number(process.env.BLOTATO_AUTOSHORT_ROTATION_DAYS || 12));

export const AUTO_SHORT_STYLES = Object.freeze([
  "cinematic workplace tension","documentary close-up","editorial portrait","over-the-shoulder workflow",
  "macro technology detail","real-world operations","moody control room","human decision moment",
  "clean split-composition","practical desk story","industrial documentary","creator studio",
  "research laboratory","customer interaction","small-business reality","technical troubleshooting",
  "before-and-after workflow","quiet consequences","high-contrast newsroom","field-report documentary",
  "hands-on demonstration","screen-light portrait","physical infrastructure","team collaboration",
  "single-protagonist journey","analogue-versus-digital","process bottleneck","risk-and-reward tension",
  "minimal cinematic objects","urban technology context","manufacturing floor","healthcare workflow",
  "financial operations","logistics movement","education setting","developer workspace",
  "security operations","policy-and-people tension","hardware close-up","data-centre reality",
  "creative production","remote-work reality","retail operations","energy infrastructure",
  "scientific observation","executive decision room","public-space technology","calm editorial finale",
]);

function utcDayNumber(date = new Date()) {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000);
}

export function getAutoShortStyleRotation(date = new Date()) {
  const cycle = Math.floor(utcDayNumber(date) / ROTATION_DAYS);
  const index = ((cycle % AUTO_SHORT_STYLES.length) + AUTO_SHORT_STYLES.length) % AUTO_SHORT_STYLES.length;
  return {
    creativeStyle: AUTO_SHORT_STYLES[index],
    styleNumber: index + 1,
    styleCount: AUTO_SHORT_STYLES.length,
    rotationDays: ROTATION_DAYS,
    cycle,
  };
}

export function getAutoShortStyleConfigSummary() {
  return {
    configured: true,
    source: "built-in-creative-style-rotation",
    styleCount: AUTO_SHORT_STYLES.length,
    rotationDays: ROTATION_DAYS,
  };
}
