import fs from "fs";
import path from "path";

export function loadKeywordsFromFile(filePath) {
  const full = path.resolve(process.cwd(), filePath);
  const raw = fs.readFileSync(full, "utf8");
  return raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
}
