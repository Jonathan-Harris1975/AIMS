#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export class KoyebScalingVerificationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "KoyebScalingVerificationError";
    this.code = code;
  }
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function serviceObject(payload) {
  const root = asObject(payload);
  return asObject(root?.service) || root;
}

export function parseKoyebScaling({ service: servicePayload, deployment: deploymentPayload, manualScaling }) {
  const service = serviceObject(servicePayload);
  const deployment = asObject(deploymentPayload?.deployment) || asObject(deploymentPayload);
  const serviceId = String(service?.id || "").trim();
  const activeDeploymentId = String(service?.active_deployment_id || "").trim();
  if (!serviceId) {
    throw new KoyebScalingVerificationError("service_response_invalid", "Koyeb service response has no verifiable service ID.");
  }
  if (!activeDeploymentId) {
    throw new KoyebScalingVerificationError("active_deployment_missing", "Koyeb service has no verifiable active deployment.");
  }
  if (String(deployment?.id || "").trim() !== activeDeploymentId || String(deployment?.service_id || "").trim() !== serviceId) {
    throw new KoyebScalingVerificationError("deployment_identity_mismatch", "Koyeb active deployment does not belong to the selected service.");
  }

  // The service endpoint contains identity and deployment IDs; scaling lives
  // on the active deployment. Manual scaling is returned by a separate API.
  const raw = asObject(deployment.definition)?.scalings;
  if (!Array.isArray(raw) || !raw.length) {
    throw new KoyebScalingVerificationError("scaling_configuration_missing", "Koyeb active deployment has no definition.scalings.");
  }

  const scalings = raw.map((entry, index) => {
    const item = asObject(entry);
    const minimum = item?.min;
    if (!Number.isInteger(minimum) || minimum < 0) {
      throw new KoyebScalingVerificationError("scaling_minimum_invalid", `Koyeb scaling entry ${index + 1} has no valid minimum instance count.`);
    }
    return {
      minimum,
      scopes: Array.isArray(item.scopes) ? item.scopes.map((scope) => String(scope)).filter(Boolean) : [],
    };
  });

  const manual = asObject(manualScaling);
  const manualRaw = manual?.scalings;
  if (!manual || (manualRaw === undefined && Object.keys(manual).length > 0) ||
      (manualRaw !== undefined && !Array.isArray(manualRaw))) {
    throw new KoyebScalingVerificationError("manual_scaling_invalid", "Koyeb manual scaling response is unreadable.");
  }
  const manualScalings = (manualRaw || []).map((entry, index) => {
    const item = asObject(entry);
    const instances = item?.instances;
    if (!Number.isInteger(instances) || instances < 0) {
      throw new KoyebScalingVerificationError("manual_scaling_invalid", `Koyeb manual scaling entry ${index + 1} has no valid instance count.`);
    }
    return {
      instances,
      scopes: Array.isArray(item.scopes) ? item.scopes.map((scope) => String(scope)).filter(Boolean) : [],
    };
  });

  return {
    serviceId,
    deploymentId: activeDeploymentId,
    serviceName: String(service?.name || "").trim(),
    appName: String(service?.app?.name || service?.app_name || "").trim(),
    scalings,
    manualScalings,
    minimum: Math.min(...scalings.map((entry) => entry.minimum), ...manualScalings.map((entry) => entry.instances)),
  };
}

export function serviceIdentityMatches(parsed, expectedService) {
  const expected = String(expectedService || "").trim();
  if (!expected) return false;
  if (parsed.serviceId && expected === parsed.serviceId) return true;
  if (parsed.serviceName && expected === parsed.serviceName) return true;
  const slash = expected.lastIndexOf("/");
  if (slash > 0) {
    const expectedApp = expected.slice(0, slash);
    const expectedName = expected.slice(slash + 1);
    return parsed.serviceName === expectedName && parsed.appName === expectedApp;
  }
  return false;
}

export function verifyKoyebServicePayload(payload, expectedService) {
  const parsed = parseKoyebScaling(payload);
  if (!serviceIdentityMatches(parsed, expectedService)) {
    throw new KoyebScalingVerificationError("service_identity_mismatch", "Koyeb returned a service that does not match KOYEB_SERVICE.");
  }
  if (parsed.minimum < 1) {
    throw new KoyebScalingVerificationError("minimum_instances_non_compliant", "Production Koyeb scaling permits fewer than one running instance.");
  }
  return parsed;
}

function queryKoyebJson(args, token, label) {
  const result = spawnSync(
    "koyeb",
    [...args, "--token", token, "--output", "json", "--full"],
    { encoding: "utf8", timeout: 45_000, maxBuffer: 4 * 1024 * 1024 }
  );
  if (result.error) {
    const code = result.error.code === "ETIMEDOUT" ? "koyeb_query_timeout" : "koyeb_cli_unavailable";
    throw new KoyebScalingVerificationError(code, `Unable to execute the Koyeb ${label} query.`);
  }
  if (result.status !== 0) {
    throw new KoyebScalingVerificationError("koyeb_api_or_auth_failure", `Koyeb ${label} query failed with exit code ${result.status}.`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new KoyebScalingVerificationError("koyeb_response_invalid_json", `Koyeb ${label} query returned invalid JSON.`);
  }
}

export function runCli(env = process.env) {
  const service = String(env.KOYEB_SERVICE || "").trim();
  const token = String(env.KOYEB_TOKEN || "").trim();
  if (!service || !token) {
    console.error("Koyeb minimum-instance verification requires KOYEB_SERVICE and KOYEB_TOKEN.");
    return 2;
  }

  try {
    const servicePayload = queryKoyebJson(["services", "get", service], token, "service");
    const activeDeploymentId = String(serviceObject(servicePayload)?.active_deployment_id || "").trim();
    if (!activeDeploymentId) {
      throw new KoyebScalingVerificationError("active_deployment_missing", "Koyeb service has no verifiable active deployment.");
    }
    const deploymentPayload = queryKoyebJson(["deployments", "get", activeDeploymentId], token, "active deployment");
    const manualScaling = queryKoyebJson(["services", "scale", "get", service], token, "manual scaling");
    const verified = verifyKoyebServicePayload({ service: servicePayload, deployment: deploymentPayload, manualScaling }, service);
    const scopeSummary = verified.scalings.map((entry) => entry.scopes.join(",") || "default").join(";");
    const summary = [
      `min=${verified.minimum}`,
      `deployment=${verified.deploymentId}`,
      `scopes=${scopeSummary}`,
      `manual overrides=${verified.manualScalings.length}`,
    ].join("; ");
    console.log(`Koyeb minimum-instance gate passed for ${verified.serviceName || service}: ${summary}.`);
    return 0;
  } catch (error) {
    const code = error?.code || "verification_failed";
    const queryFailure = new Set(["koyeb_query_timeout", "koyeb_cli_unavailable", "koyeb_api_or_auth_failure", "koyeb_response_invalid_json"]);
    const exitCode = code === "minimum_instances_non_compliant" ? 5 : queryFailure.has(code) ? 3 : 4;
    console.error(`Koyeb minimum-instance gate failed [${code}]: ${error?.message || "verification failed"}`);
    return exitCode;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) process.exitCode = runCli();
