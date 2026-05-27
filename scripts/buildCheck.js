import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateEnvObject } from "./koyebEnvDoctor.js";

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

function assertBuildEnvironment() {
  const errors = validateEnvObject(process.env);
  if (errors.length) {
    const formatted = errors
      .map((err) => `${err.key || "process.env"}: ${err.message}`)
      .join("\n");
    throw new Error(`Blocking build environment issue(s):\n${formatted}`);
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
  assertBuildEnvironment();
  console.log("✅ Build check passed");
}

main().catch((err) => {
  console.error("❌ Build check failed");
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
