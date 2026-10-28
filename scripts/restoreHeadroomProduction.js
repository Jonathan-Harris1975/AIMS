import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function cli(args, { json = true } = {}) {
  const result = spawnSync("koyeb", [...args, ...(json ? ["--output", "json", "--full"] : [])], {
    encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error("Koyeb Headroom configuration operation failed; provider output withheld");
  if (!json) return null;
  try { return JSON.parse(result.stdout); } catch { throw new Error("Koyeb Headroom metadata was not valid JSON"); }
}

export function headroomCompanion(servicePayload, listPayload, deploymentPayload) {
  const service = servicePayload?.service || servicePayload;
  const app = service?.app_id || service?.app?.id;
  if (!service?.id || !app) throw new Error("AIMS service identity/app could not be verified");
  const rows = Array.isArray(listPayload) ? listPayload : listPayload?.services;
  if (!Array.isArray(rows)) throw new Error("Headroom service inventory could not be verified");
  const matches = rows.filter(row => row.name === "headroom" && (!row.app_id || row.app_id === app));
  if (matches.length !== 1) throw new Error("Exactly one Headroom companion is required in the AIMS app");
  const companion = matches[0];
  const deployment = deploymentPayload?.deployment || deploymentPayload;
  if (!deployment || deployment.service_id !== companion.id || String(deployment.status).toLowerCase() !== "healthy") {
    throw new Error("Headroom companion is not healthy; AIMS configuration was not changed");
  }
  if (deployment.id !== (companion.latest_deployment_id || companion.active_deployment_id)) throw new Error("Headroom deployment identity mismatch");
  return { service, companion, deployment };
}

export function restoreHeadroomProduction({ env = process.env, run = cli } = {}) {
  if (!env.KOYEB_SERVICE || !env.KOYEB_TOKEN) throw new Error("Koyeb service/token configuration is required");
  const payload = run(["services", "get", env.KOYEB_SERVICE]);
  const service = payload?.service || payload;
  const app = service?.app_id || service?.app?.id;
  if (!app) throw new Error("AIMS app identity could not be verified");
  const list = run(["services", "list", "--app", app, "--name", "headroom"]);
  const rows = Array.isArray(list) ? list : list?.services;
  const companion = rows?.find(row => row.name === "headroom" && (!row.app_id || row.app_id === app));
  if (!companion) throw new Error("Headroom companion is missing from the AIMS app; deploy headroom/Dockerfile as a private service");
  const id = companion.latest_deployment_id || companion.active_deployment_id;
  if (!id) throw new Error("Headroom companion has no deployment");
  const deployment = run(["deployments", "get", id]);
  headroomCompanion(payload, list, deployment);
  run(["services", "update", companion.id, "--min-scale", "1", "--deep-sleep-delay", "0", "--light-sleep-delay", "0", "--env", "HEADROOM_BEACON=off", "--env", "DO_NOT_TRACK=1"], { json: false });
  run(["services", "update", service.id, "--env", "HEADROOM_ENABLED=true", "--env", "HEADROOM_BASE_URL=http://headroom:8787",
    "--env", "HEADROOM_PROXY_TOKEN={{secret.HEADROOM_PROXY_TOKEN}}"], { json: false });
  return { event: "headroom.production.configured", enabled: true, companionHealthy: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(restoreHeadroomProduction())); }
  catch (error) { console.error(JSON.stringify({ event: "headroom.production.restore_failed", error: error.message })); process.exitCode = 1; }
}
