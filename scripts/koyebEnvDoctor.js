#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

const SECRET_REF_PATTERN = /^\{\{\s*secret\.([A-Za-z0-9_]+)\s*\}\}$/;
const ANY_TEMPLATE_PATTERN = /\{\{([^}]*)\}\}/g;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PORTABLE_SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const BUILD_SENSITIVE_EXACT = new Set([
  "HOME",
  "PATH",
  "SHELL",
  "USER",
  "PWD",
  "OLDPWD",
  "CI",
  "NODE_OPTIONS",
]);
const BUILD_SENSITIVE_PREFIXES = [
  "KOYEB_",
  "NIXPACKS_",
  "NPM_CONFIG_",
  "npm_config_",
  "YARN_",
  "PNPM_",
  "DOCKER_",
];
const MULTILINE_SECRET_KEYS = new Set([
  "GOOGLE_PRIVATE_KEY",
]);

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function parseArgs(argv) {
  const args = {
    file: undefined,
    live: false,
    failOnWarnings: false,
    strictSecretNames: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--live") args.live = true;
    else if (arg === "--fail-on-warnings") args.failOnWarnings = true;
    else if (arg === "--strict-secret-names") args.strictSecretNames = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!args.file) {
      args.file = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/koyebEnvDoctor.js <env-file>
  node scripts/koyebEnvDoctor.js --live

Checks Koyeb bulk env files or the current process environment for deployment blockers.
It never prints secret values.`);
}

function splitEnvLine(line, lineNumber) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const equalsIndex = trimmed.indexOf("=");
  if (equalsIndex <= 0) {
    return {
      lineNumber,
      key: trimmed,
      value: "",
      malformed: true,
    };
  }

  return {
    lineNumber,
    key: trimmed.slice(0, equalsIndex).trim(),
    value: trimmed.slice(equalsIndex + 1).trim(),
    malformed: false,
  };
}

async function readEnvFile(filePath) {
  const raw = await readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line, index) => splitEnvLine(line, index + 1))
    .filter(Boolean);
}

function readLiveEnv() {
  return Object.entries(process.env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value], index) => ({
      lineNumber: index + 1,
      key,
      value: String(value || ""),
      malformed: false,
    }));
}

function addIssue(issues, severity, key, message, detail = {}) {
  issues.push({ severity, key, message, ...detail });
}

function containsRawNewline(value) {
  return /[\r\n]/.test(String(value || ""));
}

function isBuildSensitiveKey(key) {
  return BUILD_SENSITIVE_EXACT.has(key) || BUILD_SENSITIVE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function validateEntries(entries, { strictSecretNames = false } = {}) {
  const issues = [];
  const seen = new Map();
  const secretRefs = new Set();

  for (const entry of entries) {
    const { key, value, lineNumber, malformed } = entry;

    if (malformed) {
      addIssue(issues, "error", key, "Line is not KEY=VALUE format", { lineNumber });
      continue;
    }

    if (!ENV_NAME_PATTERN.test(key)) {
      addIssue(issues, "error", key, "Environment variable name is not shell-safe", { lineNumber });
    }

    if (seen.has(key)) {
      addIssue(issues, "error", key, "Duplicate environment variable; Koyeb bulk edits should have one final value per key", {
        lineNumber,
        firstLine: seen.get(key),
      });
    } else {
      seen.set(key, lineNumber);
    }

    if (containsRawNewline(value)) {
      addIssue(issues, "error", key, "Value contains a raw newline; use a Koyeb Secret or escaped \\n instead", { lineNumber });
    }

    if (MULTILINE_SECRET_KEYS.has(key) && /BEGIN [A-Z ]*PRIVATE KEY/.test(value) && !value.includes("\\n")) {
      addIssue(issues, "error", key, "Private key appears to be raw multi-line material; store it as escaped \\n text in the Secret", { lineNumber });
    }

    if (isBuildSensitiveKey(key)) {
      addIssue(issues, "warning", key, "Build/platform-sensitive variable; keep only if intentionally required", { lineNumber });
    }

    let match;
    while ((match = ANY_TEMPLATE_PATTERN.exec(value)) !== null) {
      const ref = match[0];
      const inner = match[1].trim();
      const secretMatch = ref.match(SECRET_REF_PATTERN);

      if (!secretMatch) {
        addIssue(issues, "error", key, `Unsupported Koyeb interpolation reference: ${ref}`, { lineNumber });
        continue;
      }

      const secretName = secretMatch[1];
      secretRefs.add(secretName);

      if (!PORTABLE_SECRET_NAME_PATTERN.test(secretName)) {
        const severity = strictSecretNames ? "error" : "warning";
        addIssue(issues, severity, key, `Secret name '${secretName}' is not uppercase underscore style`, { lineNumber });
      }

      if (inner !== `secret.${secretName}` || ref !== `{{ secret.${secretName} }}`) {
        addIssue(issues, "warning", key, `Non-canonical secret syntax; prefer '{{ secret.${secretName} }}'`, { lineNumber });
      }
    }
  }

  return {
    issues,
    total: entries.length,
    uniqueKeys: seen.size,
    secretRefs: [...secretRefs].sort(),
  };
}

function summarise(result) {
  const errors = result.issues.filter((issue) => issue.severity === "error");
  const warnings = result.issues.filter((issue) => issue.severity === "warning");

  console.log("Koyeb env doctor");
  console.log(`- variables: ${result.total}`);
  console.log(`- unique keys: ${result.uniqueKeys}`);
  console.log(`- secret references: ${result.secretRefs.length}`);
  console.log(`- errors: ${errors.length}`);
  console.log(`- warnings: ${warnings.length}`);

  for (const issue of result.issues) {
    const location = issue.lineNumber ? `line ${issue.lineNumber}` : "live env";
    console.log(`${issue.severity.toUpperCase()}: ${issue.key} (${location}) - ${issue.message}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const entries = args.live ? readLiveEnv() : await readEnvFile(path.resolve(args.file || "koyeb-env/aims.bulk-env.canonical.txt"));
  const result = validateEntries(entries, {
    strictSecretNames: args.strictSecretNames || isTruthy(process.env.KOYEB_ENV_STRICT_SECRET_NAMES),
  });

  summarise(result);

  const hasErrors = result.issues.some((issue) => issue.severity === "error");
  const hasWarnings = result.issues.some((issue) => issue.severity === "warning");
  if (hasErrors || (args.failOnWarnings && hasWarnings)) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Koyeb env doctor failed");
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
