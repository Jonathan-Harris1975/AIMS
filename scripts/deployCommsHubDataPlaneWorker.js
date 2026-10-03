#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKER_NAME = "aims-comms-hub-data-plane";
const API_BASE = "https://api.cloudflare.com/client/v4";
const REQUEST_TIMEOUT_MS = 60_000;

function clean(value) {
  return String(value ?? "").trim();
}

function unresolvedSecretPlaceholder(value) {
  return /^\{\{\s*secret\.[^}]+\}\}$/i.test(clean(value));
}

export function resolveCloudflareWorkerDeployCredentials(env = process.env) {
  const accountId = clean(env.CLOUDFLARE_ACCOUNT_ID) || clean(env.CF_ACCOUNT_ID);
  const apiToken = clean(env.D1_API_KEY);

  if (!accountId || unresolvedSecretPlaceholder(accountId)) {
    throw new Error(
      "Cloudflare Worker deployment requires the existing Koyeb CLOUDFLARE_ACCOUNT_ID or CF_ACCOUNT_ID value."
    );
  }
  if (!apiToken || unresolvedSecretPlaceholder(apiToken)) {
    throw new Error(
      "Cloudflare Worker deployment requires the existing Koyeb D1_API_KEY value."
    );
  }

  return { accountId, apiToken };
}

// Deliberately supports only this Worker's scalar TOML configuration. Reject
// new sections/options rather than silently deploying a partial configuration.
export function parseWorkerConfig(source) {
  const config = {};
  const allowed = {
    "": new Set(["name", "main", "compatibility_date", "preview_urls"]),
    observability: new Set(["enabled"]),
    d1_databases: new Set(["binding", "database_name", "database_id"]),
  };
  let section = "";
  const sections = new Set();
  for (const raw of String(source).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "[observability]" || line === "[[d1_databases]]") {
      section = line === "[observability]" ? "observability" : "d1_databases";
      if (sections.has(section)) throw new Error("Duplicate Worker configuration section.");
      sections.add(section);
      config[section] = {};
      continue;
    }
    const match = line.match(/^([a-z_]+)\s*=\s*("(?:[^"\\]|\\.)*"|true|false)\s*(?:#.*)?$/);
    if (!match || !allowed[section]?.has(match[1])) throw new Error("Unsupported Worker configuration; deployment stopped.");
    const target = section ? config[section] : config;
    if (Object.hasOwn(target, match[1])) throw new Error("Duplicate Worker configuration option.");
    target[match[1]] = JSON.parse(match[2]);
  }
  const database = config.d1_databases;
  if (config.name !== WORKER_NAME || config.main !== "worker.js"
    || typeof config.compatibility_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(config.compatibility_date)
    || typeof config.preview_urls !== "boolean" || typeof config.observability?.enabled !== "boolean"
    || database?.binding !== "COMMS_HUB_DB" || typeof database?.database_name !== "string" || !database.database_name
    || typeof database?.database_id !== "string" || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(database.database_id)) {
    throw new Error("Invalid or incomplete Comms Hub Worker configuration.");
  }
  return config;
}

export function workerUploadMetadata(config) {
  return {
    main_module: config.main,
    compatibility_date: config.compatibility_date,
    observability: config.observability,
    bindings: [{ type: "d1", name: config.d1_databases.binding, id: config.d1_databases.database_id }],
    keep_bindings: ["secret_text"],
  };
}

function assertBindings(settings, config, { deployed = false } = {}) {
  const bindings = settings?.bindings;
  if (!Array.isArray(bindings)
    || !bindings.some((binding) => binding.type === "secret_text" && binding.name === "COMMS_HUB_D1_PROXY_TOKEN")) {
    throw new Error("Worker COMMS_HUB_D1_PROXY_TOKEN secret binding is missing; deployment cannot be verified.");
  }
  // A new binding type needs explicit support so upload cannot discard it.
  if (bindings.some((binding) => binding.type !== "secret_text"
    && !(binding.type === "d1" && binding.name === config.d1_databases.binding))) {
    throw new Error("Unexpected Worker binding; deployment stopped to preserve existing configuration.");
  }
  if (deployed && (!bindings.some((binding) => binding.type === "d1"
    && binding.name === config.d1_databases.binding && binding.id === config.d1_databases.database_id)
    || settings.compatibility_date !== config.compatibility_date
    || settings.observability?.enabled !== config.observability.enabled)) {
    throw new Error("Deployed Worker settings do not match the canonical configuration.");
  }
}

export async function deployWorker({ config, source, credentials, fetchImpl = globalThis.fetch }) {
  const scriptUrl = `${API_BASE}/accounts/${encodeURIComponent(credentials.accountId)}/workers/scripts/${config.name}`;
  async function api(url, { method = "GET", body, json = false } = {}) {
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: { Authorization: `Bearer ${credentials.apiToken}`, ...(json ? { "Content-Type": "application/json" } : {}) },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: "error",
      });
    } catch {
      // Provider exception text can contain credentials or request content.
      // Never blindly retry a write with an uncertain provider outcome.
      throw new Error(`Cloudflare ${method} request failed or timed out; verify remote state before retrying.`);
    }
    let payload;
    try { payload = await response.json(); } catch { throw new Error(`Cloudflare ${method} returned invalid JSON (HTTP ${response.status}).`); }
    if (!response.ok || payload?.success !== true || !payload.result || (payload.errors?.length || 0) > 0) {
      const codes = (Array.isArray(payload?.errors) ? payload.errors : [])
        .map((error) => error.code).filter((code) => Number.isSafeInteger(code)).slice(0, 5);
      throw new Error(`Cloudflare ${method} failed (HTTP ${response.status}; codes: ${codes.join(",") || "none"}).`);
    }
    return payload.result;
  }

  assertBindings(await api(`${scriptUrl}/settings`), config);
  const subdomain = await api(`${scriptUrl}/subdomain`);
  if (typeof subdomain.enabled !== "boolean" || typeof subdomain.previews_enabled !== "boolean") {
    throw new Error("Worker subdomain settings are invalid; deployment stopped.");
  }
  const upload = new FormData();
  upload.set("metadata", new Blob([JSON.stringify(workerUploadMetadata(config))], { type: "application/json" }), "metadata.json");
  upload.set(config.main, new Blob([source], { type: "application/javascript+module" }), config.main);
  const result = await api(scriptUrl, { method: "PUT", body: upload });
  if (typeof result.id !== "string" || !result.id) throw new Error("Cloudflare upload returned no Worker identifier.");
  const updatedSubdomain = await api(`${scriptUrl}/subdomain`, {
    method: "POST", json: true,
    body: JSON.stringify({ enabled: subdomain.enabled, previews_enabled: config.preview_urls }),
  });
  if (updatedSubdomain.enabled !== subdomain.enabled || updatedSubdomain.previews_enabled !== config.preview_urls) {
    throw new Error("Worker subdomain settings were not preserved.");
  }
  assertBindings(await api(`${scriptUrl}/settings`), config, { deployed: true });
  return { worker: config.name, verified: true };
}

export async function main(env = process.env, { checkOnly = false } = {}) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const workerDirectory = path.join(root, "workers", "comms-hub-data-plane");
  const config = parseWorkerConfig(await readFile(path.join(workerDirectory, "wrangler.toml"), "utf8"));
  const source = await readFile(path.join(workerDirectory, config.main), "utf8");
  // This Worker is one unbundled module. A future module graph needs a bundler.
  if (/^\s*(?:import\b|export\s+.*\sfrom\s+["'])|\bimport\s*\(/m.test(source)) {
    throw new Error("Worker imports require bundling; direct single-module deployment stopped.");
  }
  if (checkOnly) {
    console.log("[comms-hub-data-plane] Canonical single-module upload configuration is valid; no network calls made.");
    return;
  }
  const credentials = resolveCloudflareWorkerDeployCredentials(env);

  console.log(
    `[comms-hub-data-plane] Deploying ${WORKER_NAME} through the Cloudflare API using existing Koyeb credentials.`
  );

  await deployWorker({ config, source, credentials });

  console.log(`[comms-hub-data-plane] ${WORKER_NAME} deployment completed.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.env, { checkOnly: process.argv.includes("--check") });
  } catch (error) {
    console.error(`[comms-hub-data-plane] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
