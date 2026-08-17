import "../config/loadEnv.js";
import { runCommsHubMigrations } from "../services/comms-hub/migrations/runner.js";

async function main() {
  const statusOnly = process.argv.includes("--status");
  const result = await runCommsHubMigrations({ statusOnly });

  if (statusOnly) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  for (const version of result.appliedVersions || []) {
    console.log(`Applied ${version}.sql`);
  }
  console.log(JSON.stringify({ ok: result.ok, applied: result.applied, total: result.total }));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
