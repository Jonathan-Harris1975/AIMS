// ============================================================
// 🧹 Logger Usage Normaliser
// ============================================================
// - Removes `log` from logger imports
// - Rewrites `log(...)` → `info(...)`
// - Relative imports only
// - Safe, idempotent, explicit
// ============================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === __filename;

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (!entry.name.endsWith(".js")) continue;

    const original = fs.readFileSync(fullPath, "utf8");
    let updated = original;

    updated = updated.replace(
      /import\s*\{([^}]+)\}\s*from\s*["'](.+\/logger\.js)["']/g,
      (match, imports, importPath) => {
        const cleaned = imports
          .split(",")
          .map((value) => value.trim())
          .filter((value) => value && value !== "log");

        if (cleaned.length === 0) return match;

        return `import { ${cleaned.join(", ")} } from "${importPath}"`;
      }
    );

    updated = updated.replace(/\blog\s*\(/g, "info(");

    if (updated !== original) {
      fs.writeFileSync(fullPath, updated, "utf8");
      console.log(`🧹 Fixed logger usage: ${path.relative(ROOT, fullPath)}`);
    }
  }
}

export function normaliseLoggerUsage(rootDir = ROOT) {
  console.log("🔍 Scanning repo for legacy logger usage...");
  walk(rootDir);
  console.log("✅ Logger usage normalisation complete.");
}

if (isEntrypoint) {
  normaliseLoggerUsage();
}
