#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WRANGLER_VERSION = "4.127.1";
const WORKER_NAME = "aims-comms-hub-data-plane";

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

export function main(env = process.env) {
  const { accountId, apiToken } = resolveCloudflareWorkerDeployCredentials(env);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const workerDirectory = path.join(root, "workers", "comms-hub-data-plane");

  console.log(
    `[comms-hub-data-plane] Deploying ${WORKER_NAME} with Wrangler ${WRANGLER_VERSION} using existing Koyeb Cloudflare credentials.`
  );

  const result = spawnSync(
    "npx",
    ["--yes", `wrangler@${WRANGLER_VERSION}`, "deploy"],
    {
      cwd: workerDirectory,
      env: {
        ...env,
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_API_TOKEN: apiToken,
      },
      stdio: "inherit",
      shell: false,
    }
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Wrangler deployment failed with exit code ${result.status ?? "unknown"}.`);
  }

  console.log(`[comms-hub-data-plane] ${WORKER_NAME} deployment completed.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[comms-hub-data-plane] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
