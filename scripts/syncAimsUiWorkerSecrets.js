import path from "node:path";
import { fileURLToPath } from "node:url";

#!/usr/bin/env node

const API_BASE = "https://api.cloudflare.com/client/v4";
const TARGET_WORKER = "aims-ui-gateway";
const REQUEST_TIMEOUT_MS = 30_000;
const SHARED_SECRET_NAMES = Object.freeze([
  "AIMS_API_KEY",
  "COMMS_HUB_RBAC_DELEGATION_SECRET",
  "COGNIPAL_WEBHOOK_SECRET",
]);

function clean(value) {
  return String(value ?? "").trim();
}

function unresolvedSecretPlaceholder(value) {
  return /^\{\{\s*secret\.[^}]+\}\}$/i.test(clean(value));
}

export function resolveAimsUiSecretSyncConfig(env = process.env) {
  const accountId = clean(env.CLOUDFLARE_ACCOUNT_ID) || clean(env.CF_ACCOUNT_ID);
  const apiToken = clean(env.D1_API_KEY);
  if (!accountId || unresolvedSecretPlaceholder(accountId)) {
    throw new Error("AIMS-UI secret synchronisation requires the existing Koyeb Cloudflare account ID.");
  }
  if (!apiToken || unresolvedSecretPlaceholder(apiToken)) {
    throw new Error("AIMS-UI secret synchronisation requires the existing Koyeb D1_API_KEY Cloudflare token.");
  }

  const secrets = Object.fromEntries(SHARED_SECRET_NAMES.map((name) => {
    const value = clean(env[name]);
    if (!value || unresolvedSecretPlaceholder(value)) {
      throw new Error(`AIMS-UI secret synchronisation requires Koyeb runtime secret ${name}.`);
    }
    return [name, value];
  }));

  return Object.freeze({ accountId, apiToken, secrets });
}

function safeCloudflareError(payload) {
  return (Array.isArray(payload?.errors) ? payload.errors : [])
    .map((error) => error?.code)
    .filter((code) => Number.isSafeInteger(code))
    .slice(0, 5)
    .join(",") || "none";
}

export async function synchroniseAimsUiWorkerSecrets({
  config,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!config?.accountId || !config?.apiToken || !config?.secrets) {
    throw new Error("AIMS-UI secret synchronisation configuration is incomplete.");
  }

  const endpoint = `${API_BASE}/accounts/${encodeURIComponent(config.accountId)}/workers/scripts/${TARGET_WORKER}/secrets`;
  const synced = [];

  for (const name of SHARED_SECRET_NAMES) {
    const text = clean(config.secrets[name]);
    if (!text) throw new Error(`AIMS-UI shared secret ${name} is empty.`);

    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, text, type: "secret_text" }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: "error",
      });
    } catch {
      throw new Error(`Cloudflare secret update for ${name} failed or timed out; remote state must be verified before retrying.`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`Cloudflare secret update for ${name} returned invalid JSON (HTTP ${response.status}).`);
    }
    if (!response.ok || payload?.success !== true || payload?.result?.name !== name || payload?.result?.type !== "secret_text") {
      throw new Error(`Cloudflare secret update for ${name} failed (HTTP ${response.status}; codes: ${safeCloudflareError(payload)}).`);
    }
    synced.push(name);
  }

  return Object.freeze({ worker: TARGET_WORKER, synced: Object.freeze([...synced]) });
}

export async function main(env = process.env) {
  const config = resolveAimsUiSecretSyncConfig(env);
  console.log(`[aims-ui-secret-sync] Synchronising ${SHARED_SECRET_NAMES.length} AIMS-owned shared secrets to ${TARGET_WORKER}; values remain inside the Koyeb runtime.`);
  const result = await synchroniseAimsUiWorkerSecrets({ config });
  console.log(`[aims-ui-secret-sync] ${result.worker} shared-secret synchronisation completed: ${result.synced.join(", ")}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.env);
  } catch (error) {
    console.error(`[aims-ui-secret-sync] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
