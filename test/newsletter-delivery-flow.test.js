import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Load the production campaign module with its external adapters replaced by
// inert bindings. Each test injects every provider/storage dependency through
// deliverNewsletterIssue's second argument, so this exercises the real control
// flow without requiring network packages in the test environment.
const tempDir = await mkdtemp(join(tmpdir(), "aims-newsletter-delivery-"));
const campaignSourcePath = new URL("../services/newsletter/brevo/campaign.js", import.meta.url);
let campaignSource = await readFile(campaignSourcePath, "utf8");
campaignSource = campaignSource
  .replace(/^import \{ info, warn \} from .*?;\n/m, "")
  .replace(/^import \{ getObjectAsText \} from .*?;\n/m, "")
  .replace(/^import \{ readCampaignDelivery, recordCampaignDelivery \} from .*?;\n/m, "")
  .replace(/^import \{ ensureList \} from .*?;\n/m, "")
  .replace(/^import \{ ensureSender, inspectSender \} from .*?;\n/m, "")
  .replace(/^import \{[\s\S]*?\} from "\.\/client\.js";\n/m, "");
const adapterStubs = `
const info = () => {};
const warn = () => {};
const unavailable = async () => { throw new Error("uninjected test adapter"); };
const getObjectAsText = unavailable;
const readCampaignDelivery = unavailable;
const recordCampaignDelivery = unavailable;
const ensureList = unavailable;
const ensureSender = unavailable;
const inspectSender = unavailable;
const createCampaign = unavailable;
const deleteCampaign = unavailable;
const sendCampaignNow = unavailable;
const getCampaign = unavailable;
`;
const campaignTestPath = join(tempDir, "campaign-under-test.mjs");
await writeFile(campaignTestPath, `${adapterStubs}\n${campaignSource}`, "utf8");
const { deliverNewsletterIssue } = await import(`${pathToFileURL(campaignTestPath).href}?v=${Date.now()}`);
test.after(async () => { await rm(tempDir, { recursive: true, force: true }); });

const profile = Object.freeze({
  id: "ai-edge",
  displayName: "AI Edge",
  brevo: Object.freeze({
    listId: null,
    listName: "AI Edge",
    folderName: "AI Edge",
    fromName: "Jonathan Harris — AI Edge",
    fromEmail: "newsletter@example.com",
    replyTo: "newsletter@example.com",
  }),
  storage: Object.freeze({ htmlBucketKey: "blog" }),
});

const buildResult = Object.freeze({
  ok: true,
  newsletter: Object.freeze({
    subject: "AI Edge test issue",
    previewText: "A production delivery test",
  }),
  storage: Object.freeze({ prefix: "newsletter/ai-edge/2026-08-05/session-1" }),
  emailHtml: "<html><body><h1>AI Edge</h1><p>Test issue content.</p></body></html>",
});

function baseDependencies(overrides = {}) {
  const writes = [];
  return {
    writes,
    deps: {
      readCampaignDelivery: async () => ({ delivery: null }),
      recordCampaignDelivery: async (payload) => {
        writes.push(payload);
        return { delivery: payload };
      },
      ensureSender: async () => ({ ok: true, exists: true, verified: true, senderId: 17, email: profile.brevo.fromEmail }),
      ensureList: async () => ({ ok: true, listId: 23, name: "AI Edge", totalSubscribers: 42, uniqueSubscribers: 42 }),
      createCampaign: async () => ({ ok: true, data: { id: 101 } }),
      deleteCampaign: async () => ({ ok: true }),
      sendCampaignNow: async () => ({ ok: true }),
      getCampaign: async () => ({ ok: true, data: { id: 101, status: "queued" } }),
      sleep: async () => {},
      ...overrides,
    },
  };
}

test("newsletter creates, records, sends and verifies one Brevo campaign", async () => {
  const calls = { create: 0, send: 0 };
  let createdPayload = null;
  const { writes, deps } = baseDependencies({
    createCampaign: async (payload) => {
      calls.create += 1;
      createdPayload = payload;
      return { ok: true, data: { id: 101 } };
    },
    sendCampaignNow: async (campaignId) => {
      calls.send += 1;
      assert.equal(campaignId, 101);
      return { ok: true };
    },
  });

  const result = await deliverNewsletterIssue(
    { profile, sessionId: "session-1", buildResult },
    deps,
  );

  assert.equal(result.ok, true);
  assert.equal(result.campaignId, 101);
  assert.equal(result.campaignStatus, "queued");
  assert.equal(calls.create, 1);
  assert.equal(calls.send, 1);
  assert.deepEqual(createdPayload.sender, { id: 17 });
  assert.deepEqual(createdPayload.recipients, { listIds: [23] });
  assert.match(createdPayload.htmlContent, /AI Edge/);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].status, "created");
  assert.equal(writes[0].campaignStatus, "draft");
  assert.equal(writes[1].status, "dispatched");
  assert.equal(writes[1].campaignStatus, "queued");
});

test("newsletter retry resumes the recorded draft instead of creating another campaign", async () => {
  const calls = { create: 0, send: 0 };
  const { writes, deps } = baseDependencies({
    readCampaignDelivery: async () => ({
      delivery: {
        campaignId: 77,
        listId: 23,
        status: "created",
        campaignStatus: "draft",
        createdAt: "2026-08-05T09:00:00.000Z",
        sentAt: null,
      },
    }),
    createCampaign: async () => {
      calls.create += 1;
      return { ok: true, data: { id: 999 } };
    },
    getCampaign: async (campaignId) => {
      assert.equal(campaignId, 77);
      return { ok: true, data: { id: 77, status: calls.send ? "queued" : "draft" } };
    },
    sendCampaignNow: async (campaignId) => {
      calls.send += 1;
      assert.equal(campaignId, 77);
      return { ok: true };
    },
  });

  const result = await deliverNewsletterIssue(
    { profile, sessionId: "session-1", buildResult },
    deps,
  );

  assert.equal(result.ok, true);
  assert.equal(result.campaignId, 77);
  assert.equal(result.resumed, true);
  assert.equal(calls.create, 0);
  assert.equal(calls.send, 1);
  assert.equal(writes.at(-1).status, "dispatched");
});

test("newsletter retry returns an already dispatched campaign without sending again", async () => {
  const calls = { create: 0, send: 0, get: 0 };
  const { deps } = baseDependencies({
    readCampaignDelivery: async () => ({
      delivery: {
        campaignId: 88,
        listId: 23,
        status: "dispatched",
        campaignStatus: "sent",
        sentAt: "2026-08-05T09:30:00.000Z",
      },
    }),
    createCampaign: async () => {
      calls.create += 1;
      return { ok: true, data: { id: 999 } };
    },
    sendCampaignNow: async () => {
      calls.send += 1;
      return { ok: true };
    },
    getCampaign: async () => {
      calls.get += 1;
      return { ok: true, data: { id: 88, status: "sent" } };
    },
  });

  const result = await deliverNewsletterIssue(
    { profile, sessionId: "session-1", buildResult },
    deps,
  );

  assert.equal(result.ok, true);
  assert.equal(result.campaignId, 88);
  assert.equal(result.alreadyDispatched, true);
  assert.equal(calls.create, 0);
  assert.equal(calls.send, 0);
  assert.equal(calls.get, 0);
});

test("newsletter never sends when the campaign idempotency record cannot be stored", async () => {
  const calls = { send: 0, deleted: 0 };
  const { deps } = baseDependencies({
    recordCampaignDelivery: async () => {
      throw new Error("R2 write unavailable");
    },
    sendCampaignNow: async () => {
      calls.send += 1;
      return { ok: true };
    },
    deleteCampaign: async (campaignId) => {
      calls.deleted += 1;
      assert.equal(campaignId, 101);
      return { ok: true };
    },
  });

  const result = await deliverNewsletterIssue(
    { profile, sessionId: "session-1", buildResult },
    deps,
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, "campaign_state_write_failed");
  assert.equal(result.campaignDeleted, true);
  assert.equal(calls.send, 0);
  assert.equal(calls.deleted, 1);
});
