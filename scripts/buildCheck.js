import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateEnvFile } from "./koyebEnvDoctor.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmRegistry = "https://registry.npmjs.org/";

async function assertFile(relativePath) {
  await access(path.join(projectRoot, relativePath), constants.R_OK);
}

async function assertPublicRegistryLockfile() {
  const lockPath = path.join(projectRoot, "package-lock.json");
  const raw = await readFile(lockPath, "utf8");
  const forbidden = [
    "packages.ace-research.openai.org",
    "artifactory",
    "localhost",
    "127.0.0.1",
  ];

  for (const token of forbidden) {
    if (raw.includes(token)) {
      throw new Error(`package-lock.json contains non-public registry token: ${token}`);
    }
  }

  if (!raw.includes(npmRegistry)) {
    throw new Error(`package-lock.json does not reference ${npmRegistry}`);
  }
}

async function assertKoyebBuildCommandsAreRuntimeEnvIsolated() {
  const dockerfile = await readFile(path.join(projectRoot, "Dockerfile"), "utf8");
  const nixpacks = await readFile(path.join(projectRoot, "nixpacks.toml"), "utf8");

  const dockerSanitisedBuildCommands = (dockerfile.match(/RUN env -i/g) || []).length;
  if (dockerSanitisedBuildCommands < 2) {
    throw new Error("Dockerfile build commands must run under env -i so runtime Koyeb env vars cannot poison image builds");
  }

  if (!dockerfile.includes("npm run build")) {
    throw new Error("Dockerfile must run npm run build during image construction");
  }

  if (!nixpacks.includes("env -i") || !nixpacks.includes("npm run build")) {
    throw new Error("nixpacks.toml fallback build commands must isolate runtime env with env -i");
  }
}

async function assertKoyebEnvFilesArePasteSafe() {
  const envDir = path.join(projectRoot, "koyeb-env");
  let files = [];

  try {
    files = await readdir(envDir);
  } catch {
    return;
  }

  const envFiles = files
    .filter((file) => /\.(env|txt)$/i.test(file))
    .filter((file) => !/\.cli-env\.txt$/i.test(file))
    .sort();

  const failures = [];
  for (const file of envFiles) {
    const result = await validateEnvFile(path.join(envDir, file));
    for (const error of result.errors) {
      const location = error.line ? `line ${error.line}` : "process.env";
      const key = error.key ? ` ${error.key}` : "";
      failures.push(`${file} ${location}${key}: ${error.message}`);
    }
  }

  if (failures.length) {
    throw new Error(
      `Koyeb env paste files are not production-safe:\n${failures.map((item) => ` - ${item}`).join("\n")}`
    );
  }
}


async function assertProductionDefaultsAreSafe() {
  const defaultsPath = path.join(projectRoot, "config", "production.defaults.env");
  const raw = await readFile(defaultsPath, "utf8");

  if (/\{\{\s*secret\./i.test(raw)) {
    throw new Error("config/production.defaults.env must not contain Koyeb secret references; keep secrets in koyeb-env/aims.secrets-only.txt");
  }

  const result = await validateEnvFile(defaultsPath);
  if (result.errors.length) {
    throw new Error(
      `config/production.defaults.env is not production-safe:\n${result.errors
        .map((error) => {
          const location = error.line ? `line ${error.line}` : "process.env";
          const key = error.key ? ` ${error.key}` : "";
          return ` - ${location}${key}: ${error.message}`;
        })
        .join("\n")}`
    );
  }
}

async function main() {
  await Promise.all([
    assertFile("server.js"),
    assertFile("scripts/bootstrap.js"),
    assertFile("routes/index.js"),
    assertFile("Dockerfile"),
    assertFile("package-lock.json"),
    assertFile("config/loadEnv.js"),
    assertFile("config/production.defaults.env"),
  ]);

  await assertPublicRegistryLockfile();
  await assertKoyebBuildCommandsAreRuntimeEnvIsolated();
  await assertKoyebEnvFilesArePasteSafe();
  await assertProductionDefaultsAreSafe();
  console.log("✅ Build check passed");
}

main().catch((err) => {
  console.error("❌ Build check failed");
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
