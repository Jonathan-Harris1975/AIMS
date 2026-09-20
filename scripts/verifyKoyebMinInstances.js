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

export function parseKoyebScaling(payload) {
  const service = serviceObject(payload);
  const definition = asObject(service?.definition);
  const raw = definition?.scalings;
  const scalings = Array.isArray(raw) ? raw : asObject(raw) ? [raw] : [];
  if (!scalings.length) {
    throw new KoyebScalingVerificationError("scaling_configuration_missing", "Koyeb service JSON does not contain definition.scalings.");
  }

  const parsed = scalings.map((entry, index) => {
    const item = asObject(entry);
    const minimum = Number(item?.min);
    if (!Number.isInteger(minimum) || minimum < 0) {
      throw new KoyebScalingVerificationError("scaling_minimum_invalid", `Koyeb scaling entry ${index + 1} has no valid minimum instance count.`);
    }
    return {
      minimum,
      scopes: Array.isArray(item.scopes) ? item.scopes.map((scope) => String(scope)).filter(Boolean) : [],
    };
  });

  return {
    serviceId: String(service?.id || "").trim(),
    serviceName: String(service?.name || definition?.name || "").trim(),
    appName: String(service?.app?.name || service?.app_name || "").trim(),
    scalings: parsed,
    minimum: Math.min(...parsed.map((entry) => entry.minimum)),
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
    if (parsed.serviceName !== expectedName) return false;
    return !parsed.appName || parsed.appName === expectedApp;
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

function queryService({ service, token }) {
  const result = spawnSync(
    "koyeb",
    ["services", "get", service, "--token", token, "--output", "json", "--full"],
    { encoding: "utf8", timeout: 45_000, maxBuffer: 4 * 1024 * 1024 }
  );
  if (result.error) {
    const code = result.error.code === "ETIMEDOUT" ? "koyeb_query_timeout" : "koyeb_cli_unavailable";
    throw new KoyebScalingVerificationError(code, "Unable to execute the Koyeb service query.");
  }
  if (result.status !== 0) {
    throw new KoyebScalingVerificationError("koyeb_api_or_auth_failure", `Koyeb service query failed with exit code ${result.status}.`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new KoyebScalingVerificationError("koyeb_response_invalid_json", "Koyeb service query returned invalid JSON.");
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
    const payload = queryService({ service, token });
    const verified = verifyKoyebServicePayload(payload, service);
    const scopeSummary = verified.scalings.map((entry) => entry.scopes.join(",") || "default").join(";");
    console.log(`Koyeb minimum-instance gate passed for ${verified.serviceName || service}: min=${verified.minimum}; scopes=${scopeSummary}.`);
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
