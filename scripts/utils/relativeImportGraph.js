import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

export const PRODUCTION_ENTRY_MODULES = Object.freeze([
  "server.js",
  "routes/index.js",
  "services/script/routes/index.js",
  "services/tts/routes/tts.js",
  "services/podcast/index.js",
  "services/artwork/index.js",
  "services/outreach/routes/index.js",
  "services/blog/index.js",
  "services/rss-feed-creator/index.js",
  "services/blotato/index.js",
  "services/comms-hub/index.js",
]);

const IMPORT_PATTERN_SOURCE = String.raw`(?:import\s+(?:[^'"()]+?\s+from\s+)?|export\s+[^'"()]+?\s+from\s+|import\()(["'])(\.{1,2}\/[^'"()]+)\1`;

function resolveImportCandidates(fromFile, specifier) {
  const basePath = path.resolve(path.dirname(fromFile), specifier);
  if (path.extname(basePath)) return [basePath];
  return [`${basePath}.js`, `${basePath}.json`, path.join(basePath, "index.js")];
}

async function firstReadable(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.R_OK);
      return candidate;
    } catch {}
  }
  return null;
}

async function walkModule(projectRoot, entryRelativePath, visited) {
  const absolutePath = path.resolve(projectRoot, entryRelativePath);
  if (visited.has(absolutePath)) return;
  visited.add(absolutePath);

  await access(absolutePath, constants.R_OK);
  const source = await readFile(absolutePath, "utf8");
  const importPattern = new RegExp(IMPORT_PATTERN_SOURCE, "g");

  let match;
  while ((match = importPattern.exec(source)) !== null) {
    const specifier = match[2];
    const target = await firstReadable(resolveImportCandidates(absolutePath, specifier));
    if (!target) {
      throw new Error(
        `Missing relative import '${specifier}' referenced from ${path.relative(projectRoot, absolutePath)}`
      );
    }
    if (target.endsWith(".js")) {
      await walkModule(projectRoot, path.relative(projectRoot, target), visited);
    }
  }
}


export const SOURCE_AUDIT_EXCLUDED_DIRS = Object.freeze([
  ".git",
  ".github",
  "node_modules",
  "test",
  "coverage",
  "local-data",
]);

async function collectJavaScriptSourceFiles(root, relativeDir = ".", excluded = new Set(SOURCE_AUDIT_EXCLUDED_DIRS)) {
  const absoluteDir = path.resolve(root, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      if (excluded.has(entry.name)) continue;
      files.push(...(await collectJavaScriptSourceFiles(root, relativePath, excluded)));
      continue;
    }

    if (!entry.isFile()) continue;
    if (!/[.]m?js$/i.test(entry.name) && !/[.]cjs$/i.test(entry.name)) continue;
    if (/[.]test[.]js$/i.test(entry.name)) continue;
    files.push(path.resolve(root, relativePath));
  }

  return files;
}


export async function assertNoUnexpectedSourceControlCharacters(
  projectRoot,
  { excludedDirs = SOURCE_AUDIT_EXCLUDED_DIRS } = {}
) {
  const root = path.resolve(projectRoot);
  const files = await collectJavaScriptSourceFiles(root, ".", new Set(excludedDirs));
  const unexpected = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

  for (const absolutePath of files) {
    const source = await readFile(absolutePath, "utf8");
    const match = unexpected.exec(source);
    if (!match) continue;

    const prefix = source.slice(0, match.index);
    const line = prefix.split("\n").length;
    const codePoint = match[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
    throw new Error(
      `Unexpected control character U+${codePoint} in ${path.relative(root, absolutePath)} at line ${line}`
    );
  }

  return Object.freeze({ sourceModulesChecked: files.length });
}

export async function assertAllSourceRelativeImports(projectRoot, { excludedDirs = SOURCE_AUDIT_EXCLUDED_DIRS } = {}) {
  const root = path.resolve(projectRoot);
  const files = await collectJavaScriptSourceFiles(root, ".", new Set(excludedDirs));

  for (const absolutePath of files) {
    const source = await readFile(absolutePath, "utf8");
    const importPattern = new RegExp(IMPORT_PATTERN_SOURCE, "g");
    let match;
    while ((match = importPattern.exec(source)) !== null) {
      const specifier = match[2];
      const target = await firstReadable(resolveImportCandidates(absolutePath, specifier));
      if (!target) {
        throw new Error(
          `Missing relative import '${specifier}' referenced from ${path.relative(root, absolutePath)}`
        );
      }
    }
  }

  return Object.freeze({ sourceModulesChecked: files.length });
}

export async function assertRelativeImportGraph(
  projectRoot,
  entryRelativePaths = PRODUCTION_ENTRY_MODULES
) {
  const root = path.resolve(projectRoot);
  const entries = [...entryRelativePaths];
  const visited = new Set();

  for (const entry of entries) {
    await walkModule(root, entry, visited);
  }

  return Object.freeze({
    entryModulesChecked: entries.length,
    modulesChecked: visited.size,
  });
}

export default assertRelativeImportGraph;
