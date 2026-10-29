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

export const SHARED_HEADROOM = Object.freeze({
  serviceId: "fafd45aa-a95f-4356-9faf-24b42c6dd847",
  baseUrl: "https://liable-loreen-jonathanharris-57884580.koyeb.app",
});

export function sharedHeadroomServices(aimsPayload, hivePayload, deploymentPayload, expectedHiveId) {
  const aims = aimsPayload?.service || aimsPayload;
  const hive = hivePayload?.service || hivePayload;
  const deployment = deploymentPayload?.deployment || deploymentPayload;
  if (!aims?.id || !hive?.id || aims.id === hive.id || hive.id !== expectedHiveId) throw new Error("AIMS/HIVE service identities could not be verified");
  if (!deployment || deployment.service_id !== hive.id || String(deployment.status).toLowerCase() !== "healthy") {
    throw new Error("Shared HIVE Headroom service is not healthy; AIMS wiring was not changed");
  }
  if (deployment.id !== (hive.latest_deployment_id || hive.active_deployment_id)) throw new Error("HIVE deployment identity mismatch");
  return { aims, hive };
}

export function restoreHeadroomProduction({ env = process.env, run = cli } = {}) {
  if (!env.KOYEB_SERVICE || !env.KOYEB_TOKEN) throw new Error("Koyeb service/token configuration is required");
  if (Boolean(env.HEADROOM_HIVE_SERVICE) !== Boolean(env.HEADROOM_HIVE_BASE_URL)) {
    throw new Error("A custom HIVE compression target requires both HEADROOM_HIVE_SERVICE and HEADROOM_HIVE_BASE_URL");
  }
  const expectedHiveId = env.HEADROOM_HIVE_SERVICE || SHARED_HEADROOM.serviceId;
  const baseUrl = new URL(env.HEADROOM_HIVE_BASE_URL || SHARED_HEADROOM.baseUrl);
  if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash || baseUrl.pathname !== "/") {
    throw new Error("HIVE compression target must be an HTTPS origin without credentials, query or path");
  }
  const aimsPayload = run(["services", "get", env.KOYEB_SERVICE]);
  const hivePayload = run(["services", "get", expectedHiveId]);
  const hive = hivePayload?.service || hivePayload;
  const id = hive?.latest_deployment_id || hive?.active_deployment_id;
  if (!id) throw new Error("HIVE has no deployed Headroom endpoint");
  const deployment = run(["deployments", "get", id]);
  const services = sharedHeadroomServices(aimsPayload, hivePayload, deployment, expectedHiveId);
  run(["services", "update", services.hive.id, "--min-scale", "1", "--env", "HEADROOM_ENABLED=true",
    "--env", "HEADROOM_BEACON=off", "--env", "DO_NOT_TRACK=1"], { json: false });
  run(["services", "update", services.aims.id, "--env", "HEADROOM_ENABLED=true", "--env", `HEADROOM_BASE_URL=${baseUrl.origin}`,
    "--env", "HEADROOM_PROXY_TOKEN={{secret.AIMS_API_KEY}}"], { json: false });
  return { event: "headroom.production.configured", enabled: true, mode: "shared-hive-inline", additionalComputeService: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(restoreHeadroomProduction())); }
  catch (error) { console.error(JSON.stringify({ event: "headroom.production.restore_failed", error: error.message })); process.exitCode = 1; }
}
