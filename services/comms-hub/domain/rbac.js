import { createHmac, timingSafeEqual } from "node:crypto";
import { CommsHubError } from "../errors.js";

export const COMMS_HUB_ROLES = Object.freeze(["admin", "reviewer", "operator", "read_only"]);

const PERMISSIONS = Object.freeze({
  read_queue: ["admin", "reviewer", "operator", "read_only"],
  read_conversation: ["admin", "reviewer", "operator", "read_only"],
  read_audit: ["admin", "reviewer", "operator", "read_only"],
  read_metrics: ["admin", "reviewer", "operator", "read_only"],
  read_notifications: ["admin", "reviewer", "operator", "read_only"],
  update_status: ["admin", "reviewer", "operator"],
  assign: ["admin", "reviewer", "operator"],
  tag: ["admin", "reviewer", "operator"],
  note: ["admin", "reviewer", "operator"],
  use_saved_reply: ["admin", "reviewer", "operator"],
  manage_saved_reply: ["admin", "reviewer"],
  send_reply: ["admin", "reviewer", "operator"],
  decide_approval: ["admin", "reviewer"],
  manage_identity: ["admin", "reviewer"],
  manage_workflows: ["admin", "reviewer"],
  manage_rules: ["admin", "reviewer"],
  manage_sla: ["admin", "reviewer"],
  manage_autonomy: ["admin", "reviewer"],
  manage_escalations: ["admin", "reviewer", "operator"],
  manage_attachments: ["admin", "reviewer", "operator"],
  replay_quarantine: ["admin", "reviewer"],
  manage_retention: ["admin"],
  manage_credentials: ["admin"],
  run_backups: ["admin"],
  bulk_actions: ["admin", "reviewer", "operator"],
  human_takeover: ["admin", "reviewer", "operator"],
});

function text(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function requestPath(req) {
  return String(req?.originalUrl || req?.url || "").split("?")[0];
}

export function delegatedIdentitySignature({ method, path, timestamp, actor, role }, secret) {
  return createHmac("sha256", secret)
    .update([String(method || "GET").toUpperCase(), path, timestamp, actor, role].join("\n"))
    .digest("hex");
}

export function resolveCommsIdentity(req, config, { now = Date.now() } = {}) {
  const actor = text(req?.get?.("x-comms-hub-actor") || req?.headers?.["x-comms-hub-actor"], 200);
  const role = text(req?.get?.("x-comms-hub-role") || req?.headers?.["x-comms-hub-role"], 50).toLowerCase();
  const timestamp = text(req?.get?.("x-comms-hub-timestamp") || req?.headers?.["x-comms-hub-timestamp"], 50);
  const signature = text(req?.get?.("x-comms-hub-signature") || req?.headers?.["x-comms-hub-signature"], 200).toLowerCase();

  if (actor || role || timestamp || signature) {
    if (!actor || !COMMS_HUB_ROLES.includes(role) || !/^\d{10,13}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature)) {
      throw new CommsHubError(401, "comms_hub_delegated_identity_invalid", "Delegated Comms Hub identity headers are incomplete or invalid.", {
        publicMessage: "Operator identity could not be verified.",
      });
    }
    const timestampMs = timestamp.length === 10 ? Number(timestamp) * 1000 : Number(timestamp);
    if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > config.rbacSignatureMaxAgeMs) {
      throw new CommsHubError(401, "comms_hub_delegated_identity_expired", "Delegated Comms Hub identity signature is outside the allowed time window.", {
        publicMessage: "Operator identity has expired.",
      });
    }
    if (!config.rbacDelegationSecret) {
      throw new CommsHubError(503, "comms_hub_rbac_delegation_unconfigured", "COMMS_HUB_RBAC_DELEGATION_SECRET is not configured.", {
        publicMessage: "Operator identity verification is not configured.",
      });
    }
    const expected = delegatedIdentitySignature({
      method: req.method,
      path: requestPath(req),
      timestamp,
      actor,
      role,
    }, config.rbacDelegationSecret);
    if (!safeEqual(expected, signature)) {
      throw new CommsHubError(401, "comms_hub_delegated_identity_signature_invalid", "Delegated Comms Hub identity signature is invalid.", {
        publicMessage: "Operator identity could not be verified.",
      });
    }
    return Object.freeze({ actor, role, strategy: "delegated-hmac" });
  }

  const fallbackRole = COMMS_HUB_ROLES.includes(config.suiteRole) ? config.suiteRole : "admin";
  const fallbackActor = text(
    req?.user?.email
      || req?.user?.id
      || req?.aimsAuth?.subject
      || req?.aimsAuth?.strategy
      || "authenticated-aims-user",
    200
  );
  return Object.freeze({ actor: fallbackActor, role: fallbackRole, strategy: req?.aimsAuth?.strategy || "suite" });
}

export function roleAllows(role, permission) {
  return Boolean(PERMISSIONS[permission]?.includes(role));
}

export function requireCommsPermission(req, config, permission) {
  const identity = req.commsIdentity || resolveCommsIdentity(req, config);
  if (!roleAllows(identity.role, permission)) {
    throw new CommsHubError(403, "comms_hub_permission_denied", `Role '${identity.role}' cannot perform '${permission}'.`, {
      publicMessage: "You do not have permission to perform this action.",
    });
  }
  req.commsIdentity = identity;
  return identity;
}

export function attachCommsIdentity(configProvider) {
  return (req, _res, next) => {
    try {
      req.commsIdentity = resolveCommsIdentity(req, configProvider());
      next();
    } catch (error) {
      next(error);
    }
  };
}

export default requireCommsPermission;
