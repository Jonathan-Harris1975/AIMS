// scripts/startupDump.js
import { ENV } from "./envBootstrap.js";

export function dumpConfig() {
  const redacted = {};
  for (const [k,v] of Object.entries(ENV)) {
    redacted[k] = k.includes("KEY") || k.includes("SECRET") ? "[REDACTED]" : v;
  }
  console.log("🔧 Runtime config:", redacted);
}
