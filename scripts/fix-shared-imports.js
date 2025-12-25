import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".cache"
]);

const IMPORT_RE =
  /import\s+[^;]*?\s+from\s+["'](#shared\/(?!utils\/)[^"']+)["']/g;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(full);
      continue;
    }

    if (!full.endsWith(".js")) continue;

    let src = fs.readFileSync(full, "utf8");
    let changed = false;

    src = src.replace(IMPORT_RE, (m, spec) => {
      changed = true;
      return m.replace(spec, `#shared/utils/${spec.slice("#shared/".length)}`);
    });

    if (changed) {
      fs.writeFileSync(full, src);
      console.log("✔ fixed:", path.relative(ROOT, full));
    }
  }
}

console.log("🔧 Fixing #shared ESM imports...");
walk(ROOT);
console.log("✅ Done.");
