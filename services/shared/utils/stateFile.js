import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { debug, warn } from "../../../logger.js";

const BASE_STATE_DIR = path.resolve(
  process.env.APP_STATE_DIR ||
    path.join(process.env.APP_TMP_DIR || path.join(os.tmpdir(), "ai-management-suite"), "state")
);

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

export function getStateFilePath(filename) {
  return path.join(ensureStateDir(), filename);
}

export function readJsonState(filename, fallback) {
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
    return true;
  } catch (err) {
    warn("state.write.fail", { filePath, error: err?.message || String(err) });
    try {
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    } catch {}
    return false;
  }
}
