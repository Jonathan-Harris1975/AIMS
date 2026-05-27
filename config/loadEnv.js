import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ENV_PATH = path.join(projectRoot, "config", "production.defaults.env");
const LOCAL_ENV_PATH = path.join(projectRoot, ".env");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  return dotenv.parse(readFileSync(filePath, "utf8"));
}

export function loadEnv({ env = process.env } = {}) {
  const defaults = parseEnvFile(DEFAULT_ENV_PATH);
  const local = parseEnvFile(LOCAL_ENV_PATH);
  const merged = { ...defaults, ...local };

  for (const [key, value] of Object.entries(merged)) {
    if (env[key] === undefined) {
      env[key] = value;
    }
  }

  return {
    defaultEnvPath: DEFAULT_ENV_PATH,
    localEnvPath: LOCAL_ENV_PATH,
    defaultsLoaded: Object.keys(defaults).length,
    localLoaded: Object.keys(local).length,
  };
}

loadEnv();
