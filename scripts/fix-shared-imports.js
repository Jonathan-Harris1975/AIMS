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

// Match:
//   "#shared/foo"
//   "#shared/foo.js"
// BUT NOT:
//   "#shared/utils/foo"
const BAD_IMPORT =
  /(["'])#shared\/(?!utils\/)([^"'\/]+(?:\/[^"'\/]+)*)\1/g;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(full);
      continue;
    }

    if (!full.endsWith(".js")) continue;

    const src = fs.readFileSync(full, "utf8");
    if (!BAD_IMPORT.test(src)) continue;

    const fixed = src.replace(
      BAD_IMPORT,
      (_m, q, file) => `${q}#shared/utils/${file}${q}`
    );

    fs.writeFileSync(full, fixed);
    console.log("✔ fixed:", path.relative(ROOT, full));
  }
}

console.log("🔧 Normalising #shared imports...");
walk(ROOT);
console.log("✅ Done.");
