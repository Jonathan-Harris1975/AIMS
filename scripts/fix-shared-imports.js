import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const TARGET_EXT = ".js";

// what we are fixing
const FROM = /(["'])#shared\/(?!utils\/)/g;
const TO = `$1#shared/utils/`;

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (
        e.name === "node_modules" ||
        e.name === ".git" ||
        e.name === "dist" ||
        e.name === "build"
      ) continue;
      walk(p);
    } else if (e.isFile() && p.endsWith(TARGET_EXT)) {
      const src = fs.readFileSync(p, "utf8");
      if (FROM.test(src)) {
        const next = src.replace(FROM, TO);
        fs.writeFileSync(p, next);
        console.log("✔ fixed:", path.relative(ROOT, p));
      }
    }
  }
}

walk(ROOT);
console.log("Done.");
