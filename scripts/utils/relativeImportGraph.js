import { access, readFile } from "node:fs/promises";
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
