import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deployWorker, parseWorkerConfig, resolveCloudflareWorkerDeployCredentials } from "../scripts/deployCommsHubDataPlaneWorker.js";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const source = await readFile(new URL("../workers/comms-hub-data-plane/wrangler.toml", import.meta.url), "utf8");
const config = parseWorkerConfig(source);
const credentials = { accountId: "test-account", apiToken: "test-private-token" };
const secret = { type: "secret_text", name: "COMMS_HUB_D1_PROXY_TOKEN" };
const otherSecret = { type: "secret_text", name: "OTHER_EXISTING_SECRET" };
const database = { type: "d1", name: "COMMS_HUB_DB", id: config.d1_databases.database_id };
const settings = { bindings: [secret, otherSecret, database], compatibility_date: config.compatibility_date, observability: config.observability };
const response = (result, overrides = {}) => new Response(JSON.stringify({ success: true, result, ...overrides }), { status: 200 });

function transport(override = () => undefined) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      const changed = await override(url, options, calls.length);
      if (changed !== undefined) return changed;
      if (url.endsWith("/settings")) return response(settings);
      if (url.endsWith("/subdomain")) {
        return response({ enabled: true, previews_enabled: options.method === "POST" ? config.preview_urls : true });
      }
      assert.equal(options.method, "PUT");
      return response({ id: config.name });
    },
  };
}

test("canonical module deploys without npm/npx and preserves secret, D1 and subdomain settings", async () => {
  const mock = transport();
  const result = await deployWorker({ config, source: "export default {};", credentials, fetchImpl: mock.fetchImpl });
  assert.deepEqual(result, { worker: config.name, verified: true });
  assert.deepEqual(mock.calls.map((call) => call.method), ["GET", "GET", "PUT", "POST", "GET"]);
  const upload = mock.calls[2];
  assert.equal(upload.url, `https://api.cloudflare.com/client/v4/accounts/test-account/workers/scripts/${config.name}`);
  assert.equal(upload.headers.Authorization, `Bearer ${credentials.apiToken}`);
  assert.equal(upload.headers["Content-Type"], undefined, "fetch must generate the multipart boundary");
  const metadata = JSON.parse(await upload.body.get("metadata").text());
  assert.deepEqual(metadata, {
    main_module: "worker.js", compatibility_date: config.compatibility_date,
    observability: { enabled: true }, bindings: [database], keep_bindings: ["secret_text"],
  });
  assert.equal(upload.body.get("worker.js").type, "application/javascript+module");
  assert.equal(await upload.body.get("worker.js").text(), "export default {};");
  assert.deepEqual(JSON.parse(mock.calls[3].body), { enabled: true, previews_enabled: false });
  for (const call of mock.calls) {
    assert.equal(call.redirect, "error");
    assert.ok(call.signal instanceof AbortSignal);
  }
});

test("a disabled workers.dev endpoint is preserved instead of enabled by upload", async () => {
  const mock = transport((url, options) => url.endsWith("/subdomain")
    ? response({ enabled: false, previews_enabled: options.method === "POST" ? config.preview_urls : true }) : undefined);
  await deployWorker({ config, source: "export default {};", credentials, fetchImpl: mock.fetchImpl });
  assert.equal(JSON.parse(mock.calls[3].body).enabled, false);
});

test("configuration check runs with an empty PATH and no credential or network dependency", () => {
  const result = spawnSync(process.execPath, ["scripts/deployCommsHubDataPlaneWorker.js", "--check"], {
    cwd: repoRoot, env: { PATH: "" }, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no network calls made/);
});

test("configuration rejects unsupported sections, keys, duplicate bindings and wrong module paths", () => {
  for (const candidate of [
    `${source}\n[vars]\nVALUE = "ignored"`,
    source.replace('preview_urls = false', 'preview_urls = false\nworkers_dev = true'),
    `${source}\n[[d1_databases]]\nbinding = "OTHER"`,
    source.replace('main = "worker.js"', 'main = "../unexpected.js"'),
    source.replace('enabled = true', 'enabled = true\nenabled = false'),
    source.replace(/database_id = "[^"]+"/, 'database_id = "invalid"'),
  ]) assert.throws(() => parseWorkerConfig(candidate));
});

test("credentials retain legacy account alias and reject missing or unresolved values", () => {
  assert.deepEqual(resolveCloudflareWorkerDeployCredentials({ CF_ACCOUNT_ID: " account ", D1_API_KEY: " token " }), {
    accountId: "account", apiToken: "token",
  });
  for (const env of [{}, { CF_ACCOUNT_ID: "a" }, { CF_ACCOUNT_ID: "{{ secret.CF_ACCOUNT_ID }}", D1_API_KEY: "token" },
    { CF_ACCOUNT_ID: "a", D1_API_KEY: "{{ secret.D1_API_KEY }}" }]) {
    assert.throws(() => resolveCloudflareWorkerDeployCredentials(env));
  }
});

test("missing required secret or unexpected binding prevents all upload writes", async () => {
  for (const bindings of [[database], [secret, database, { type: "kv_namespace", name: "UNSUPPORTED" }]]) {
    const mock = transport((url) => url.endsWith("/settings") ? response({ bindings }) : undefined);
    await assert.rejects(deployWorker({ config, source: "export default {};", credentials, fetchImpl: mock.fetchImpl }));
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].method, "GET");
  }
});

test("Cloudflare HTTP rejection and API failure stay failures without exposing provider text", async () => {
  for (const rejection of [
    new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: credentials.apiToken }] }), { status: 403 }),
    response(null, { success: false, errors: [{ code: 10000, message: credentials.apiToken }] }),
  ]) {
    const mock = transport(() => rejection);
    await assert.rejects(deployWorker({ config, source: "export default {};", credentials, fetchImpl: mock.fetchImpl }), (error) => {
      assert.match(error.message, /Cloudflare GET failed/);
      assert.ok(!error.message.includes(credentials.apiToken));
      return true;
    });
    assert.equal(mock.calls.length, 1);
  }
});

test("malformed provider JSON fails closed", async () => {
  const mock = transport(() => new Response("not json"));
  await assert.rejects(deployWorker({ config, source: "export default {};", credentials, fetchImpl: mock.fetchImpl }), /invalid JSON/);
  assert.equal(mock.calls.length, 1);
});

test("an ambiguous upload timeout is never retried or claimed as deployment success", async () => {
  const mock = transport((_url, options) => {
    if (options.method === "PUT") throw new Error(`timeout with ${credentials.apiToken}`);
  });
  await assert.rejects(deployWorker({ config, source: "export default {};", credentials, fetchImpl: mock.fetchImpl }), (error) => {
    assert.match(error.message, /verify remote state before retrying/);
    assert.ok(!error.message.includes(credentials.apiToken));
    return true;
  });
  assert.equal(mock.calls.filter((call) => call.method === "PUT").length, 1);
  assert.equal(mock.calls.length, 3);
});

test("post-upload secret loss, wrong database or settings drift cannot produce success", async () => {
  for (const deployed of [
    { ...settings, bindings: [database] },
    { ...settings, bindings: [secret, { ...database, id: "wrong-database" }] },
    { ...settings, compatibility_date: "2020-01-01" },
    { ...settings, observability: { enabled: false } },
  ]) {
    const mock = transport((url, _options, count) => count === 5 && url.endsWith("/settings") ? response(deployed) : undefined);
    await assert.rejects(deployWorker({ config, source: "export default {};", credentials, fetchImpl: mock.fetchImpl }));
    assert.equal(mock.calls.length, 5);
  }
});

test("invalid subdomain response or ignored preview settings fails verification", async () => {
  for (const mode of ["invalid", "ignored"]) {
    const mock = transport((url, options) => {
      if (!url.endsWith("/subdomain")) return undefined;
      if (mode === "invalid") return response({});
      if (options.method === "POST") return response({ enabled: true, previews_enabled: true });
    });
    await assert.rejects(deployWorker({ config, source: "export default {};", credentials, fetchImpl: mock.fetchImpl }), /subdomain settings/);
  }
});
