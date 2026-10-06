import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveAimsUiSecretSyncConfig,
  synchroniseAimsUiWorkerSecrets,
} from "../scripts/syncAimsUiWorkerSecrets.js";

function env(overrides = {}) {
  return {
    CLOUDFLARE_ACCOUNT_ID: "account-123",
    D1_API_KEY: "cloudflare-token",
    AIMS_API_KEY: "aims-api-key",
    COMMS_HUB_RBAC_DELEGATION_SECRET: "delegation-secret",
    COGNIPAL_WEBHOOK_SECRET: "cognipal-secret",
    ...overrides,
  };
}

test("secret sync resolves only the canonical AIMS-owned shared secrets", () => {
  assert.deepEqual(resolveAimsUiSecretSyncConfig(env()), {
    accountId: "account-123",
    apiToken: "cloudflare-token",
    secrets: {
      AIMS_API_KEY: "aims-api-key",
      COMMS_HUB_RBAC_DELEGATION_SECRET: "delegation-secret",
      COGNIPAL_WEBHOOK_SECRET: "cognipal-secret",
    },
  });
});

test("secret sync rejects missing and unresolved runtime values", () => {
  for (const bad of [
    { CLOUDFLARE_ACCOUNT_ID: "" },
    { D1_API_KEY: "" },
    { AIMS_API_KEY: "" },
    { COMMS_HUB_RBAC_DELEGATION_SECRET: "{{ secret.COMMS_HUB_RBAC_DELEGATION_SECRET }}" },
    { COGNIPAL_WEBHOOK_SECRET: "" },
  ]) {
    assert.throws(() => resolveAimsUiSecretSyncConfig(env(bad)));
  }
});

test("secret sync targets only aims-ui-gateway and never returns secret values", async () => {
  const config = resolveAimsUiSecretSyncConfig(env());
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({
      success: true,
      errors: [],
      messages: [],
      result: { name: JSON.parse(init.body).name, type: "secret_text" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await synchroniseAimsUiWorkerSecrets({ config, fetchImpl });

  assert.deepEqual(result, {
    worker: "aims-ui-gateway",
    synced: ["AIMS_API_KEY", "COMMS_HUB_RBAC_DELEGATION_SECRET", "COGNIPAL_WEBHOOK_SECRET"],
  });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.url === "https://api.cloudflare.com/client/v4/accounts/account-123/workers/scripts/aims-ui-gateway/secrets"));
  assert.ok(calls.every((call) => call.init.method === "PUT"));
  assert.ok(calls.every((call) => call.init.headers.Authorization === "Bearer cloudflare-token"));
  assert.deepEqual(calls.map((call) => call.body), [
    { name: "AIMS_API_KEY", text: "aims-api-key", type: "secret_text" },
    { name: "COMMS_HUB_RBAC_DELEGATION_SECRET", text: "delegation-secret", type: "secret_text" },
    { name: "COGNIPAL_WEBHOOK_SECRET", text: "cognipal-secret", type: "secret_text" },
  ]);
  assert.equal(JSON.stringify(result).includes("aims-api-key"), false);
  assert.equal(JSON.stringify(result).includes("delegation-secret"), false);
  assert.equal(JSON.stringify(result).includes("cognipal-secret"), false);
});

test("secret sync fails closed on a partial Cloudflare update", async () => {
  const config = resolveAimsUiSecretSyncConfig(env());
  let count = 0;
  const fetchImpl = async (_url, init) => {
    count += 1;
    const name = JSON.parse(init.body).name;
    if (count === 2) {
      return new Response(JSON.stringify({
        success: false,
        errors: [{ code: 10000, message: "permission denied" }],
        result: null,
      }), { status: 403, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      success: true,
      errors: [],
      result: { name, type: "secret_text" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  await assert.rejects(
    synchroniseAimsUiWorkerSecrets({ config, fetchImpl }),
    /COMMS_HUB_RBAC_DELEGATION_SECRET failed \(HTTP 403; codes: 10000\)/,
  );
  assert.equal(count, 2);
});
