const DURABLE_STATE_BUCKET_ENV_CANDIDATES = [
  "R2_BUCKET_META_SYSTEM",
  "R2_META_SYSTEM_BUCKET",
  "R2_BUCKET_METASYSTEM",
  "R2_META_BUCKET",
  "R2_BUCKET_META",
];

const DURABLE_STATE_PUBLIC_URL_ENV_CANDIDATES = [
  "R2_PUBLIC_BASE_URL_META_SYSTEM",
  "R2_PUBLIC_BASE_URL_METASYSTEM",
  "R2_PUBLIC_BASE_URL_META",
];

function cleanEnvValue(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function firstConfiguredEnv(env, keys) {
  for (const key of keys) {
    const value = cleanEnvValue(env[key]);
    if (value) {
      return { key, value };
    }
  }

  return { key: null, value: "" };
}

export function getDurableStateBucketConfig(env = process.env) {
  return firstConfiguredEnv(env, DURABLE_STATE_BUCKET_ENV_CANDIDATES);
}

export function getDurableStateBucketName(env = process.env) {
  return getDurableStateBucketConfig(env).value;
}

export function getDurableStateBucketEnvName(env = process.env) {
  return getDurableStateBucketConfig(env).key || DURABLE_STATE_BUCKET_ENV_CANDIDATES[0];
}

export function getDurableStatePublicUrlConfig(env = process.env) {
  return firstConfiguredEnv(env, DURABLE_STATE_PUBLIC_URL_ENV_CANDIDATES);
}

export function getDurableStatePublicBaseUrl(env = process.env) {
  return getDurableStatePublicUrlConfig(env).value;
}

export function getDurableStatePublicUrlEnvName(env = process.env) {
  return getDurableStatePublicUrlConfig(env).key || DURABLE_STATE_PUBLIC_URL_ENV_CANDIDATES[0];
}

export function hasDurableStateEnv(env = process.env) {
  return Boolean(
    cleanEnvValue(env.R2_ENDPOINT) &&
      cleanEnvValue(env.R2_ACCESS_KEY_ID) &&
      cleanEnvValue(env.R2_SECRET_ACCESS_KEY) &&
      getDurableStateBucketName(env)
  );
}

export function durableStateEnvHint() {
  return `Configure R2 credentials plus ${DURABLE_STATE_BUCKET_ENV_CANDIDATES.join(
    " or ")} with STATE_BACKEND=auto or r2, or set ALLOW_EPHEMERAL_STATE=true only if you intentionally accept state loss across container restarts.`;
}

export function durableStateBucketEnvCandidates() {
  return [...DURABLE_STATE_BUCKET_ENV_CANDIDATES];
}

export function durableStatePublicUrlEnvCandidates() {
  return [...DURABLE_STATE_PUBLIC_URL_ENV_CANDIDATES];
}
