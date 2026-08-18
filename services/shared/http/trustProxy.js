function normaliseEnvString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function isProductionEnv(value = process.env.NODE_ENV) {
  return normaliseEnvString(value).toLowerCase() === "production";
}

export function parseTrustProxy(value, nodeEnv = process.env.NODE_ENV) {
  if (value === undefined || value === null || value === "") {
    return isProductionEnv(nodeEnv) ? 1 : false;
  }

  if (value === true || value === false) return value;

  const normalized = String(value).trim().toLowerCase();
  // Numeric hop counts are parsed before boolean aliases. In particular,
  // TRUST_PROXY=1 means one trusted proxy hop, never "trust every proxy".
  if (/^\d+$/.test(normalized)) return Number(normalized);
  if (["true", "yes", "on"].includes(normalized)) return true;
  if (["false", "no", "off"].includes(normalized)) return false;
  return value;
}
