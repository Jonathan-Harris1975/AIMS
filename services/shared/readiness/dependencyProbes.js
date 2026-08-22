import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { getDurableStateBucketName } from "../utils/durableStateEnv.js";

const cache = new Map();

function positiveMs(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function clean(value) {
  const text = String(value || "").trim();
  return /^\{\{\s*secret\.[^}]+\}\}$/i.test(text) ? "" : text;
}

function errorName(error) {
  if (error?.name === "AbortError") return "timeout";
  const status = Number(error?.$metadata?.httpStatusCode || error?.status || error?.statusCode || 0);
  if (status === 401 || status === 403) return "authentication";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "upstream_unavailable";
  return String(error?.name || "unreachable").slice(0, 80);
}

async function withCache(key, ttlMs, force, probe) {
  const now = Date.now();
  const existing = cache.get(key);
  if (!force && existing && existing.expiresAt > now) return existing.value;
  const value = await probe();
  cache.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

export async function probeOpenRouter({ env = process.env, fetchImpl = globalThis.fetch, force = false } = {}) {
  const apiKey = clean(env.OPENROUTER_API_KEY);
  if (!apiKey) return { ok: false, configured: false, detail: "missing" };
  const timeoutMs = positiveMs(env.READINESS_PROBE_TIMEOUT_MS, 3_000);
  const ttlMs = positiveMs(env.READINESS_PROBE_CACHE_MS, 30_000);
  const base = clean(env.OPENROUTER_BASE_URL || env.OPENROUTER_API_BASE) || "https://openrouter.ai/api/v1";

  return withCache(`openrouter:${base}`, ttlMs, force, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const response = await fetchImpl(`${base.replace(/\/+$/, "")}/models`, {
        method: "GET",
        headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
        signal: controller.signal,
      });
      return response.ok
        ? { ok: true, configured: true, detail: "reachable" }
        : { ok: false, configured: true, detail: `http_${response.status}` };
    } catch (error) {
      return { ok: false, configured: true, detail: errorName(error) };
    } finally {
      clearTimeout(timer);
    }
  });
}

export async function probeDurableState({ env = process.env, clientFactory = null, force = false } = {}) {
  const endpoint = clean(env.R2_ENDPOINT || env.R2_ENDPOINT_URL);
  const accessKeyId = clean(env.R2_ACCESS_KEY_ID);
  const secretAccessKey = clean(env.R2_SECRET_ACCESS_KEY);
  const bucket = getDurableStateBucketName(env);
  const configured = Boolean(endpoint && accessKeyId && secretAccessKey && bucket);
  if (!configured) return { ok: false, configured: false, detail: "missing" };

  const timeoutMs = positiveMs(env.READINESS_PROBE_TIMEOUT_MS, 3_000);
  const ttlMs = positiveMs(env.READINESS_PROBE_CACHE_MS, 30_000);
  return withCache(`r2:${endpoint}:${bucket}`, ttlMs, force, async () => {
    const client = clientFactory
      ? clientFactory()
      : new S3Client({
          endpoint,
          region: clean(env.R2_REGION) || "auto",
          credentials: { accessKeyId, secretAccessKey },
          forcePathStyle: true,
          maxAttempts: 1,
        });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }), { abortSignal: controller.signal });
      return { ok: true, configured: true, detail: "reachable" };
    } catch (error) {
      return { ok: false, configured: true, detail: errorName(error) };
    } finally {
      clearTimeout(timer);
      client.destroy?.();
    }
  });
}

export async function probeCriticalDependencies(options = {}) {
  const [durableState, openrouter] = await Promise.all([
    probeDurableState(options),
    probeOpenRouter(options),
  ]);
  return { durableState, openrouter };
}

export function clearDependencyProbeCache() {
  cache.clear();
}
