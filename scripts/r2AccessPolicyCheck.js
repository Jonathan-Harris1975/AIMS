import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const policy = JSON.parse(fs.readFileSync(path.join(root, "config/r2-access-policy.json"), "utf8"));
const envFiles = [".env.example", "env.template", "config/production.defaults.env"];
const parse = (raw) => Object.fromEntries(String(raw).split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && line.includes("=")).map((line) => { const i=line.indexOf("="); return [line.slice(0,i), line.slice(i+1)]; }));
let failed = false;
for (const rel of envFiles) {
  const env = parse(fs.readFileSync(path.join(root, rel), "utf8"));
  for (const item of policy.buckets) {
    if (item.access !== "private" || !item.publicBaseEnv) continue;
    if (String(env[item.publicBaseEnv] || "").trim()) {
      failed = true;
      console.error(`Private R2 bucket ${item.bucket} must not expose ${item.publicBaseEnv} in ${rel}`);
    }
  }
}
if (failed) process.exit(1);
console.log("R2 access policy check passed.");
