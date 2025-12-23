// deployment-check.js
import { ENV } from "./scripts/envBootstrap.js";

const required = Object.entries(ENV)
  .filter(([_, v]) => v === undefined)
  .map(([k]) => k);

if (required.length) {
  console.error("❌ Missing required ENV variables:");
  required.forEach((k) => console.error(`  - ${k}`));
  process.exit(1);
}

console.log("✅ Environment validation passed");
