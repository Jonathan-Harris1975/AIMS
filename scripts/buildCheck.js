import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateEnvFile } from "./koyebEnvDoctor.js";
import {
  assertAllSourceRelativeImports,
  assertNoUnexpectedSourceControlCharacters,
  assertRelativeImportGraph,
} from "./utils/relativeImportGraph.js";

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

  let lockJson;
  try {
    lockJson = JSON.parse(raw);
  } catch {
    throw new Error("package-lock.json is not valid JSON");
  }

  const allowedHost = "registry.npmjs.org";
  const resolvedUrls = [];

  if (lockJson && typeof lockJson === "object") {
    if (lockJson.packages && typeof lockJson.packages === "object") {
      for (const pkg of Object.values(lockJson.packages)) {
        if (pkg && typeof pkg === "object" && typeof pkg.resolved === "string") {
          resolvedUrls.push(pkg.resolved);
        }
      }
    }

    if (lockJson.dependencies && typeof lockJson.dependencies === "object") {
      const stack = [lockJson.dependencies];
      while (stack.length) {
        const deps = stack.pop();
        for (const dep of Object.values(deps)) {
          if (!dep || typeof dep !== "object") continue;
          if (typeof dep.resolved === "string") {
            resolvedUrls.push(dep.resolved);
          }
          if (dep.dependencies && typeof dep.dependencies === "object") {
            stack.push(dep.dependencies);
          }
        }
      }
    }
  }

  let foundPublicRegistry = false;
  for (const resolved of resolvedUrls) {
    let parsed;
    try {
      parsed = new URL(resolved);
    } catch {
      continue;
    }

    if (parsed.protocol === "https:" && parsed.hostname === allowedHost) {
      foundPublicRegistry = true;
      continue;
    }

    throw new Error(`package-lock.json contains non-public resolved URL: ${resolved}`);
  }

  if (!foundPublicRegistry) {
    throw new Error(`package-lock.json does not reference ${npmRegistry}`);
  }
}

async function assertCloudflareWorkerConfig() {
  await assertFile("workers/comms-hub-data-plane/worker.js");
  await assertFile("workers/comms-hub-data-plane/wrangler.toml");

  const legacyRedirect = path.join(projectRoot, ".wrangler", "deploy", "config.json");
  try {
    await readFile(legacyRedirect, "utf8");
    throw new Error(
      ".wrangler/deploy/config.json must not exist: Cloudflare deploys from workers/comms-hub-data-plane, where wrangler.toml is already the canonical configuration"
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function assertKoyebBuildCommandsAreRuntimeEnvIsolated() {
  const dockerfile = await readFile(path.join(projectRoot, "Dockerfile"), "utf8");
  const nixpacks = await readFile(path.join(projectRoot, "nixpacks.toml"), "utf8");
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  const pinnedNodeVersion = String(packageJson.engines?.node || "").trim();
  const nodeImage = dockerfile.match(/^FROM\s+node:([^@\s]+)@sha256:[0-9a-f]{64}\s+AS\s+runtime\s*$/m);

  if (!pinnedNodeVersion) {
    throw new Error("package.json must pin engines.node before validating the production image");
  }

  if (!nodeImage) {
    throw new Error("Dockerfile runtime must use a digest-pinned node image");
  }

  if (!nodeImage[1].startsWith(`${pinnedNodeVersion}-`)) {
    throw new Error(
      `Dockerfile Node image (${nodeImage[1]}) must match package.json engines.node (${pinnedNodeVersion})`
    );
  }

  if (!dockerfile.includes("npm ci") || !dockerfile.includes("--ignore-scripts")) {
    throw new Error("Dockerfile dependency installation must use npm ci with lifecycle scripts disabled");
  }

  if (!dockerfile.includes("--kill-after=")) {
    throw new Error("Dockerfile package/network timeouts must include a hard --kill-after deadline");
  }

  const dockerBuildValidationIsolated = /env -i[\s\S]{0,500}npm run build/.test(dockerfile);
  if (!dockerBuildValidationIsolated) {
    throw new Error("Dockerfile source validation must run under env -i so runtime Koyeb env vars cannot poison image builds");
  }

  if (!nixpacks.includes("npm ci --omit=dev --ignore-scripts")) {
    throw new Error("nixpacks.toml dependency installation must disable lifecycle scripts");
  }

  if (!/env -i[^\n]*npm run build/.test(nixpacks)) {
    throw new Error("nixpacks.toml source validation must isolate runtime env with env -i");
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
  await assertCloudflareWorkerConfig();
  await assertKoyebBuildCommandsAreRuntimeEnvIsolated();
  await assertKoyebEnvFilesArePasteSafe();
  await assertProductionDefaultsAreSafe();
  const controlAudit = await assertNoUnexpectedSourceControlCharacters(projectRoot);
  const sourceAudit = await assertAllSourceRelativeImports(projectRoot);
  const moduleGraph = await assertRelativeImportGraph(projectRoot);
  console.log(`✅ Source control-character audit passed (${controlAudit.sourceModulesChecked} modules)`);
  console.log(`✅ Full source relative-import audit passed (${sourceAudit.sourceModulesChecked} modules)`);
  console.log(`✅ Production relative import graph passed (${moduleGraph.modulesChecked} modules)`);
  console.log("✅ Build check passed");
}

main().catch((err) => {
  console.error("❌ Build check failed");
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
