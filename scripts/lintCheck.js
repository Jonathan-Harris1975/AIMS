import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skipDirectories = new Set([
  ".git",
  "node_modules",
  "coverage",
  "dist",
  "build",
  "playwright-report",
  "test-results",
]);
const textExtensions = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".py",
  ".sql",
  ".toml",
  ".yml",
  ".yaml",
]);
const javascriptExtensions = new Set([".js", ".mjs", ".cjs"]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (skipDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function checkJavaScriptSyntax(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--check", file], {
      cwd: root,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve(code === 0 ? null : stderr.trim() || "syntax check failed"));
  });
}

async function runSyntaxChecks(files, concurrency = 8) {
  const failures = [];
  let cursor = 0;

  async function worker() {
    while (cursor < files.length) {
      const index = cursor;
      cursor += 1;
      const file = files[index];
      const failure = await checkJavaScriptSyntax(file);
      if (failure) failures.push({ file, failure });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, () => worker()));
  return failures;
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

async function main() {
  const files = await walk(root);
  const textFiles = files.filter((file) => textExtensions.has(path.extname(file).toLowerCase()));
  const javascriptFiles = textFiles.filter((file) => javascriptExtensions.has(path.extname(file).toLowerCase()));
  const failures = [];

  const syntaxFailures = await runSyntaxChecks(javascriptFiles);
  for (const { file, failure } of syntaxFailures) {
    failures.push(`${relative(file)}: ${failure}`);
  }

  for (const file of textFiles) {
    const source = await readFile(file, "utf8");
    const rel = relative(file);
    const extension = path.extname(file).toLowerCase();
    const lines = source.split(/\r?\n/);

    if (extension !== ".md") {
      for (let index = 0; index < lines.length; index += 1) {
        if (/[ \t]+$/.test(lines[index])) {
          failures.push(`${rel}:${index + 1}: trailing whitespace`);
        }
      }
    }

    if (extension === ".json") {
      try {
        JSON.parse(source);
      } catch (error) {
        failures.push(`${rel}: invalid JSON (${error.message})`);
      }
    }
  }

  if (failures.length) {
    console.error("Lint failed:");
    for (const failure of failures) console.error(` - ${failure}`);
    process.exit(1);
  }

  console.log(`Lint passed: ${javascriptFiles.length} JavaScript modules parsed and ${textFiles.length} text files checked.`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
