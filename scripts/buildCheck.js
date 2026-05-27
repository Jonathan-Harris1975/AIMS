import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { validateEnvFile } from "./koyebEnvDoctor.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmRegistry = "https://registry.npmjs.org/";
const koyebEnvFiles = [
  "koyeb-env/aims.bulk-env.canonical.txt",
  "koyeb-env/aims.bulk-env.safe-no-google-private-key.txt",
  "koyeb-env/rams.bulk-env.canonical.txt",
  "koyeb-env/blotato-state-corrected.env",
  "koyeb-env/blotato-state-with-api-key.env",
];

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


async function assertKoyebEnvFilesAreValid() {
  const failures = [];

  for (const relativePath of koyebEnvFiles) {
    const absolutePath = path.join(projectRoot, relativePath);

    try {
      await access(absolutePath, constants.R_OK);
    } catch {
      continue;
    }

    const result = await validateEnvFile(absolutePath);
    if (result.errors.length) {
      failures.push(
        `${relativePath}: ${result.errors
          .map((err) => `line ${err.line || "?"}${err.key ? ` ${err.key}` : ""} ${err.message}`)
          .join("; ")}`
      );
    }
  }

  if (failures.length) {
    throw new Error(`Koyeb env file validation failed: ${failures.join(" | ")}`);
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

async function main() {
  await Promise.all([
    assertFile("server.js"),
    assertFile("scripts/bootstrap.js"),
    assertFile("routes/index.js"),
    assertFile("Dockerfile"),
    assertFile("package-lock.json"),
  ]);

  await assertPublicRegistryLockfile();
  await assertKoyebEnvFilesAreValid();
  await assertKoyebBuildCommandsAreRuntimeEnvIsolated();
  console.log("✅ Build check passed");
}

main().catch((err) => {
  console.error("❌ Build check failed");
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
