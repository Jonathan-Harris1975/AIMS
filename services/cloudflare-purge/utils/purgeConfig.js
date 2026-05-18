const ZONE_ENV_CANDIDATES = [
  "CF_zone",
  "CF_ZONE",
  "CLOUDFLARE_ZONE_ID",
  "CLOUDFLARE_ZONE",
];

const TOKEN_ENV_CANDIDATES = [
  "CF_purge",
  "CF_PURGE",
  "CLOUDFLARE_PURGE_API_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "CF_API_TOKEN",
];

const LEGACY_KEY_ENV_CANDIDATES = [
  "CF_GLOBAL_API_KEY",
  "CLOUDFLARE_GLOBAL_API_KEY",
  "CF_API_KEY",
];

function normaliseEnvString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function looksLikeSecretPlaceholder(value) {
  return /^\{\{\s*secret\.[^}]+\}\}$/i.test(normaliseEnvString(value));
}

function redact(value) {
  const text = normaliseEnvString(value);
  if (!text) return "";
  if (text.length <= 8) return "***";
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function firstConfiguredEnv(names, env = process.env) {
  let firstPlaceholder = null;

  for (const name of names) {
    const rawValue = normaliseEnvString(env[name]);
    if (!rawValue) continue;

    const candidate = {
      name,
      value: rawValue,
      isPlaceholder: looksLikeSecretPlaceholder(rawValue),
    };

    if (candidate.isPlaceholder) {
      firstPlaceholder ||= candidate;
      continue;
    }

    return candidate;
  }

  return firstPlaceholder;
}

function stripBearerPrefix(value) {
  return normaliseEnvString(value).replace(/^Bearer\s+/i, "").trim();
}

export function createStatusError(message, statusCode = 500, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (details !== undefined) {
    err.details = details;
  }
  return err;
}

export function resolveCloudflarePurgeConfig(env = process.env) {
  const zone = firstConfiguredEnv(ZONE_ENV_CANDIDATES, env);
  const token = firstConfiguredEnv(TOKEN_ENV_CANDIDATES, env);
  const email = firstConfiguredEnv(["CF_EMAIL", "CLOUDFLARE_EMAIL"], env);
  const legacyKey = firstConfiguredEnv(LEGACY_KEY_ENV_CANDIDATES, env);

  if (!zone) {
    throw createStatusError(
      `Cloudflare purge is not configured. Missing zone id environment variable. Checked: ${ZONE_ENV_CANDIDATES.join(", ")}.`,
      500
    );
  }

  if (zone.isPlaceholder) {
    throw createStatusError(
      `Cloudflare purge zone id environment variable ${zone.name} still contains an unresolved Koyeb secret placeholder.`,
      500,
      { envKey: zone.name }
    );
  }

  if (token) {
    if (token.isPlaceholder) {
      throw createStatusError(
        `Cloudflare purge token environment variable ${token.name} still contains an unresolved Koyeb secret placeholder.`,
        500,
        { envKey: token.name }
      );
    }

    const tokenValue = stripBearerPrefix(token.value);
    if (!tokenValue) {
      throw createStatusError(
        `Cloudflare purge token environment variable ${token.name} is blank after normalisation.`,
        500,
        { envKey: token.name }
      );
    }

    return {
      zoneId: zone.value,
      zoneEnvKey: zone.name,
      authMode: "api-token",
      token: tokenValue,
      tokenEnvKey: token.name,
      tokenPreview: redact(tokenValue),
    };
  }

  if (email && legacyKey) {
    if (email.isPlaceholder || legacyKey.isPlaceholder) {
      throw createStatusError(
        "Cloudflare legacy email/key environment variables still contain unresolved Koyeb secret placeholders.",
        500,
        { emailEnvKey: email.name, keyEnvKey: legacyKey.name }
      );
    }

    return {
      zoneId: zone.value,
      zoneEnvKey: zone.name,
      authMode: "global-key",
      email: email.value,
      emailEnvKey: email.name,
      globalKey: legacyKey.value,
      globalKeyEnvKey: legacyKey.name,
      tokenPreview: redact(legacyKey.value),
    };
  }

  throw createStatusError(
    `Cloudflare purge is not configured. Missing API token environment variable. Checked: ${TOKEN_ENV_CANDIDATES.join(", ")}.`,
    500
  );
}
