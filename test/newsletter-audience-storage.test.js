import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const tempDir = await mkdtemp(join(tmpdir(), "aims-newsletter-state-"));
test.after(async () => { await rm(tempDir, { recursive: true, force: true }); });

async function loadWithStubs(sourcePath, fileName, stubs) {
  const source = (await readFile(new URL(sourcePath, import.meta.url), "utf8"))
    .replace(/^import .* from .*;\n/gm, "");
  const target = join(tempDir, fileName);
  await writeFile(target, `${stubs}\n${source}`, "utf8");
  return import(pathToFileURL(target).href);
}

const audience = await loadWithStubs("../services/newsletter/brevo/audience.js", "audience.mjs", `
const info = () => {};
const warn = () => {};
const unavailable = async () => { throw new Error("unexpected adapter call"); };
const getFolders = unavailable;
const createFolder = unavailable;
const getLists = (options) => globalThis.__newsletterListLookup(options);
const getList = (id) => globalThis.__newsletterGetList(id);
const getContactsFromList = (id, options) => globalThis.__newsletterGetContacts(id, options);
const createList = unavailable;
const addContactsToList = unavailable;
`);

const storage = await loadWithStubs("../services/newsletter/engine/storage.js", "storage.mjs", `
const unavailable = async () => { throw new Error("unexpected adapter call"); };
const uploadText = unavailable;
const putJson = unavailable;
const listKeys = unavailable;
const getObjectAsText = unavailable;
`);

const profile = { storage: { htmlBucketKey: "blog", keyPrefix: "newsletter/ai-edge" } };
const record = { profile, sessionId: "issue-1", date: new Date("2026-09-29T09:00:00Z") };

test("a zero Brevo list counter is checked against real, eligible contacts", async () => {
  let requested = null;
  const result = await audience.inspectList(23, {
    loadList: async () => ({ ok: true, data: { id: 23, name: "AI Edge", totalSubscribers: 0, uniqueSubscribers: 3 } }),
    loadContacts: async (_id, options) => {
      requested = options;
      return { ok: true, data: { count: 3, contacts: [
        { email: "blocked@example.com", emailBlacklisted: true },
        { email: "unsubscribed@example.com", emailBlacklisted: false, listUnsubscribed: [23] },
        { email: "eligible@example.com", emailBlacklisted: false, listUnsubscribed: [] },
      ] } };
    },
  });
  assert.deepEqual(requested, { limit: 500, offset: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.hasDeliverableContact, true);
  assert.equal(result.subscriberCountSource, "contacts");
  assert.equal(result.totalSubscribers, 0); // Keep the provider's raw count honest.
});

test("a genuinely empty or blocked audience stays blocked", async () => {
  const result = await audience.inspectList(23, {
    loadList: async () => ({ ok: true, data: { id: 23, totalSubscribers: 42 } }),
    loadContacts: async () => ({ ok: true, data: { count: 1, contacts: [{ email: "blocked@example.com", emailBlacklisted: true }] } }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.hasDeliverableContact, false);
});

test("an unconfirmed audience cannot be treated as empty or ready", async () => {
  const result = await audience.inspectList(23, {
    loadList: async () => ({ ok: true, data: { id: 23, totalSubscribers: 0 } }),
    loadContacts: async () => ({ ok: false, status: 503, error: "Brevo unavailable" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "audience_inspection_failed");
});

test("an existing list resolves by unique exact name across folders and pages", async () => {
  globalThis.__newsletterListLookup = async ({ offset }) => ({ ok: true, data: {
    count: 51,
    lists: offset === 0
      ? Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: `Other ${i}` }))
      : [{ id: 99, name: "AI Edge" }],
  } });
  globalThis.__newsletterGetList = async (id) => ({ ok: true, data: { id, name: "AI Edge", totalSubscribers: 42 } });
  globalThis.__newsletterGetContacts = async () => ({ ok: true, data: { count: 1, contacts: [
    { email: "eligible@example.com", emailBlacklisted: false, listUnsubscribed: [] },
  ] } });
  try {
    const result = await audience.ensureList({ name: "AI Edge", folderName: "Unrelated", allowCreate: false, id: null });
    assert.equal(result.ok, true);
    assert.equal(result.listId, 99);
    assert.equal(result.source, "matched-name");
  } finally {
    delete globalThis.__newsletterListLookup;
    delete globalThis.__newsletterGetList;
    delete globalThis.__newsletterGetContacts;
  }
});

test("ambiguous names require the configured list ID", async () => {
  globalThis.__newsletterListLookup = async () => ({ ok: true, data: { count: 2, lists: [
    { id: 23, name: "AI Edge" }, { id: 42, name: "AI Edge" },
  ] } });
  try {
    const result = await audience.ensureList({ name: "AI Edge", folderName: "AI Edge", allowCreate: false });
    assert.equal(result.ok, false);
    assert.equal(result.status, "audience_ambiguous");
  } finally {
    delete globalThis.__newsletterListLookup;
  }
});

test("an R2 read failure or corrupt delivery record cannot start another campaign", async () => {
  const missing = await storage.readCampaignDelivery(record, { readText: async () => {
    throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
  } });
  assert.deepEqual(missing, { delivery: null });
  await assert.rejects(
    storage.readCampaignDelivery(record, { readText: async () => {
      throw Object.assign(new Error("unavailable"), { $metadata: { httpStatusCode: 503 } });
    } }),
    /unavailable/,
  );
  await assert.rejects(storage.readCampaignDelivery(record, { readText: async () => "{}" }), /Invalid newsletter delivery record/);
});
