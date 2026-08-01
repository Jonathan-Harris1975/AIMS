import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { debug, warn } from "../../../logger.js";
import { getObjectAsText, putJson } from "./r2-client.js";
import { durableStateEnvHint, hasDurableStateEnv } from "./durableStateEnv.js";

const BASE_STATE_DIR = path.resolve(
  process.env.APP_STATE_DIR ||
    path.join(process.env.APP_TMP_DIR || path.join(os.tmpdir(), "ai-management-suite"), "state")
);
const REMOTE_STATE_PREFIX = String(process.env.STATE_REMOTE_PREFIX || "state")
  .replace(/^\/+/, "")
  .replace(/\/+$/, "");
const KNOWN_REMOTE_FILES = new Set([
  "job-store.json",
  "request-dedupe.json",
  "social-editorial-ledger.json",
  "professional-excellence.json",
]);
const remoteStateCache = new Map();

const remoteStateMode = String(process.env.STATE_BACKEND || "auto").trim().toLowerCase();
const hasRemoteStateEnv = hasDurableStateEnv(process.env);
const requireDurableState = parseBoolean(process.env.REQUIRE_DURABLE_STATE, false);
const explicitlyLocalState = ["local", "file", "filesystem"].includes(remoteStateMode);
const explicitlyRemoteState = remoteStateMode === "r2" || requireDurableState;
const remoteStateEnabled =
  hasRemoteStateEnv &&
  !explicitlyLocalState &&
  (remoteStateMode === "r2" || remoteStateMode === "auto" || requireDurableState);

let warnedRemoteStateDisabled = false;
let remoteWriteQueue = Promise.resolve();
let lastRemoteWriteError = null;

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalised = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalised)) return true;
  if (["0", "false", "no", "off"].includes(normalised)) return false;
  return fallback;
}

function cloneValue(value) {
  if (value === undefined) return undefined;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function ensureStateDir() {
  if (!fs.existsSync(BASE_STATE_DIR)) {
    fs.mkdirSync(BASE_STATE_DIR, { recursive: true });
    debug("state.dir.created", { BASE_STATE_DIR });
  }

  return BASE_STATE_DIR;
}

function isLikelyEphemeralStateDir(dirPath) {
  const resolved = path.resolve(dirPath);
  const tmpRoot = path.resolve(os.tmpdir());
  return resolved === tmpRoot || resolved.startsWith(`${tmpRoot}${path.sep}`);
}

function assertProductionSafeStateBackend() {
  const inProduction = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
  const allowEphemeralState = parseBoolean(process.env.ALLOW_EPHEMERAL_STATE, false);

  if (!inProduction || allowEphemeralState || remoteStateEnabled) {
    return;
  }

  if (explicitlyRemoteState) {
    throw new Error(`Production state backend is not durable. ${durableStateEnvHint()}`);
  }

  if (explicitlyLocalState) {
    const locationHint = isLikelyEphemeralStateDir(BASE_STATE_DIR)
      ? "The configured state directory resolves inside the container tmp filesystem."
      : "The configured state backend is local-only, which is unsafe on the target Koyeb deployment model.";

    throw new Error(
      `${locationHint} ${durableStateEnvHint()}`
    );
  }
}


function warnIfUsingLocalOnlyState() {
  if (warnedRemoteStateDisabled) return;
  warnedRemoteStateDisabled = true;

  const localOnly = !remoteStateEnabled;
  const inProduction = process.env.NODE_ENV === "production";

  if (!localOnly || !inProduction || !isLikelyEphemeralStateDir(BASE_STATE_DIR)) {
    return;
  }

  warn("state.persistence.local_only", {
    backend: remoteStateMode,
    stateDir: BASE_STATE_DIR,
    message:
      `State persistence is using local ephemeral storage. ${durableStateEnvHint()}`,
  });
}

function remoteStateKey(filename) {
  return REMOTE_STATE_PREFIX ? `${REMOTE_STATE_PREFIX}/${filename}` : filename;
}

function isMissingRemoteStateError(err) {
  const text = `${err?.name || ""} ${err?.code || ""} ${err?.message || ""}`.toLowerCase();
  return (
    text.includes("nosuchkey") ||
    text.includes("not found") ||
    text.includes("notfound") ||
    text.includes("the specified key does not exist") ||
    text.includes("unknown r2 bucket alias")
  );
}

assertProductionSafeStateBackend();

async function hydrateRemoteState() {
  if (!remoteStateEnabled) {
    warnIfUsingLocalOnlyState();
    return;
  }

  for (const filename of KNOWN_REMOTE_FILES) {
    const key = remoteStateKey(filename);

    try {
      const raw = await getObjectAsText("metaSystem", key);
      const trimmed = String(raw || "").trim();
      if (!trimmed) continue;

      remoteStateCache.set(filename, JSON.parse(trimmed));
      debug("state.remote.hydrated", { key });
    } catch (err) {
      if (isMissingRemoteStateError(err)) {
        debug("state.remote.missing", { key });
        continue;
      }

      warn("state.remote.hydrate.fail", {
        key,
        error: err?.message || String(err),
      });
    }
  }
}

let remoteStateHydration = Promise.resolve(false);

if (remoteStateEnabled) {
  remoteStateHydration = hydrateRemoteState().then(() => true);
  remoteStateHydration.catch((err) => {
    warn("state.remote.initial_hydrate.fail", {
      error: err?.message || String(err),
    });
  });
} else {
  warnIfUsingLocalOnlyState();
}


export async function waitForRemoteStateHydration() {
  return remoteStateHydration;
}

function queueRemoteWrite(filename, value) {
  if (!remoteStateEnabled) {
    warnIfUsingLocalOnlyState();
    return;
  }

  const key = remoteStateKey(filename);
  const snapshot = cloneValue(value);
  remoteStateCache.set(filename, snapshot);

  remoteWriteQueue = remoteWriteQueue
    .then(async () => {
      await putJson("metaSystem", key, snapshot);
      lastRemoteWriteError = null;
      debug("state.remote.write.complete", { key });
    })
    .catch((err) => {
      lastRemoteWriteError = err;
      warn("state.remote.write.fail", {
        key,
        error: err?.message || String(err),
      });
    });
}

export function getStateFilePath(filename) {
  return path.join(ensureStateDir(), filename);
}

export function readJsonState(filename, fallback) {
  if (remoteStateCache.has(filename)) {
    return cloneValue(remoteStateCache.get(filename));
  }

  const filePath = getStateFilePath(filename);

  try {
    if (!fs.existsSync(filePath)) {
      return cloneValue(fallback);
    }

    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return cloneValue(fallback);
    return JSON.parse(raw);
  } catch (err) {
    warn("state.read.fail", { filePath, error: err?.message || String(err) });
    return cloneValue(fallback);
  }
}

export function writeJsonState(filename, value) {
  const filePath = getStateFilePath(filename);
  const tempFilePath = `${filePath}.${process.pid}.tmp`;

  try {
    fs.writeFileSync(tempFilePath, JSON.stringify(value, null, 2));
    fs.renameSync(tempFilePath, filePath);
    queueRemoteWrite(filename, value);
    return true;
  } catch (err) {
    warn("state.write.fail", { filePath, error: err?.message || String(err) });
    try {
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    } catch {}
    queueRemoteWrite(filename, value);
    return remoteStateEnabled;
  }
}


export async function readJsonStateFresh(filename, fallback) {
  if (!remoteStateEnabled) {
    return readJsonState(filename, fallback);
  }

  const key = remoteStateKey(filename);

  try {
    const raw = await getObjectAsText("metaSystem", key);
    const trimmed = String(raw || "").trim();
    if (!trimmed) {
      remoteStateCache.delete(filename);
      return cloneValue(fallback);
    }

    const parsed = JSON.parse(trimmed);
    remoteStateCache.set(filename, parsed);
    return cloneValue(parsed);
  } catch (err) {
    if (isMissingRemoteStateError(err)) {
      remoteStateCache.delete(filename);
      return readJsonState(filename, fallback);
    }

    warn("state.remote.read_fresh.fail", {
      key,
      error: err?.message || String(err),
    });
    return readJsonState(filename, fallback);
  }
}

export async function flushStateWrites({ throwOnError = false } = {}) {
  await remoteWriteQueue;
  if (throwOnError && lastRemoteWriteError) {
    throw lastRemoteWriteError;
  }
  return { ok: !lastRemoteWriteError, error: lastRemoteWriteError ? lastRemoteWriteError?.message || String(lastRemoteWriteError) : null };
}
