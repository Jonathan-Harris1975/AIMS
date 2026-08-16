import test from "node:test";
import assert from "node:assert/strict";
import { effectiveChatEnabled, getCommsHubReadiness, loadCommsHubConfig } from "../services/comms-hub/config.js";

test("CogniPal secret enables first-party chat even when a stale rollout flag says false", () => {
  const env = {
    COMMS_HUB_ENABLED: "false",
    COMMS_HUB_CHAT_ENABLED: "false",
    COMMS_HUB_COGINPAL_WEBHOOK_SECRET: "test-shared-secret",
  };
  assert.equal(effectiveChatEnabled(env), true);
  assert.equal(getCommsHubReadiness(env).channels.chat, true);
});

test("explicit force-disable remains the emergency kill switch", () => {
  const env = {
    COMMS_HUB_CHAT_ENABLED: "true",
    COMMS_HUB_COGINPAL_WEBHOOK_SECRET: "test-shared-secret",
    COMMS_HUB_CHAT_FORCE_DISABLED: "true",
  };
  assert.equal(effectiveChatEnabled(env), false);
});

test("first-party config does not require the legacy external CogniPal API", () => {
  const env = {
    COMMS_HUB_ENABLED: "true",
    COMMS_HUB_CHAT_ENABLED: "true",
    COMMS_HUB_COGINPAL_WEBHOOK_SECRET: "test-shared-secret",
    JOTFORM_API_KEY: "test-jotform",
    D1_UUID: "test-db",
    D1_API_KEY: "test-token",
    CLOUDFLARE_ACCOUNT_ID: "test-account",
    COMMS_HUB_D1_PROXY_URL: "https://example.test/query",
    COMMS_HUB_D1_PROXY_TOKEN: "proxy-token",
    R2_ENDPOINT: "https://test-account.r2.cloudflarestorage.com",
    R2_ACCESS_KEY_ID: "access",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_BUCKET_COMMS_HUB: "comms-hub",
  };
  const readiness = getCommsHubReadiness(env);
  assert.equal(readiness.missing.includes("COMMS_HUB_COGINPAL_API_KEY"), false);
  const config = loadCommsHubConfig(env);
  assert.equal(config.chatEnabled, true);
  assert.equal(config.coginPalApiBaseUrl, "");
});
