import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policy = JSON.parse(fs.readFileSync(path.join(root, "config/r2-access-policy.json"), "utf8"));
const r2Client = fs.readFileSync(path.join(root, "services/shared/utils/r2-client.js"), "utf8");
const envFiles = [".env.example", "env.template", "config/production.defaults.env", "services/comms-hub/env.template"]
  .map((file) => [file, fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), "utf8") : ""]);

const failures = [];
for (const entry of policy.buckets) {
  if (entry.access === "private") {
    for (const alias of entry.aliases || []) {
      if (!r2Client.includes(`"${alias}"`)) failures.push(`${entry.bucket}: missing authenticated alias ${alias}`);
    }
    if (entry.publicBaseEnv && !entry.compatibilityPublicUrl) {
      for (const [file, text] of envFiles) {
        const match = text.match(new RegExp(`^${entry.publicBaseEnv}=(.*)$`, "m"));
        if (match && match[1].trim()) failures.push(`${entry.bucket}: ${entry.publicBaseEnv} must be blank in ${file}`);
      }
    }
  }
}

if (!r2Client.includes("PRIVATE_READY_BUCKET_ALIASES")) failures.push("r2-client: private-ready alias registry missing");
if (!r2Client.includes("getObjectAsBuffer")) failures.push("r2-client: authenticated binary read helper missing");
if (!r2Client.includes("uploadPrivateBuffer")) failures.push("r2-client: private write helper missing");

if (failures.length) {
  console.error("R2 access policy check failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log(`R2 access policy OK: ${policy.buckets.length} buckets classified; target-private public URLs are blank/enforced.`);
