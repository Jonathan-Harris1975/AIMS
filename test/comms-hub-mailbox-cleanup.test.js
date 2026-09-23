import test from "node:test";
import assert from "node:assert/strict";
import { OneComMailClient } from "../services/comms-hub/clients/oneComMailClient.js";
import {
  CommsHubEmailMailboxCleanupService,
  EMAIL_MAILBOX_CLEANUP_CONFIRMATION,
  resolveCleanupMailboxes,
} from "../services/comms-hub/emailMailboxCleanupService.js";

function advertisedFolders({ includeSpam = true } = {}) {
  return [
    { name: "INBOX", selectable: true, flags: ["\\HasNoChildren"] },
    { name: "Deleted Items", selectable: true, flags: ["\\HasNoChildren", "\\Trash"] },
    ...(includeSpam ? [{ name: "Unwanted", selectable: true, flags: ["\\HasNoChildren", "\\Junk"] }] : []),
  ];
}

test("cleanup folders are selected exclusively from one.com special-use flags", () => {
  assert.deepEqual(resolveCleanupMailboxes(advertisedFolders()), {
    trash: "Deleted Items",
    spam: "Unwanted",
  });
  assert.throws(
    () => resolveCleanupMailboxes([
      { name: "Trash", selectable: true, flags: [] },
      { name: "Spam", selectable: true, flags: [] },
    ]),
    (error) => error?.code === "email_cleanup_special_use_folders_unresolved"
  );
});

test("cleanup never selects INBOX or another protected special-use mailbox", () => {
  assert.throws(
    () => resolveCleanupMailboxes([
      { name: "INBOX", selectable: true, flags: ["\\Trash"] },
      { name: "Unwanted", selectable: true, flags: ["\\Junk"] },
    ]),
    (error) => error?.code === "email_cleanup_special_use_folders_unresolved"
  );
  assert.throws(
    () => resolveCleanupMailboxes([
      { name: "Sent", selectable: true, flags: ["\\Sent", "\\Trash"] },
      { name: "Unwanted", selectable: true, flags: ["\\Junk"] },
    ]),
    (error) => error?.code === "email_cleanup_special_use_folders_unresolved"
  );
});

test("one.com bulk cleanup marks bounded UID batches deleted and expunges once", async () => {
  const commands = [];
  const client = new OneComMailClient({});
  client.withImapSession = async (callback) => callback({
    async command(command) {
      commands.push(command);
      if (command === "UID SEARCH ALL") {
        return { lines: [`* SEARCH ${Array.from({ length: 251 }, (_, index) => index + 1).join(" ")}`], literals: [] };
      }
      return { lines: [], literals: [] };
    },
  });

  const result = await client.deleteAllMessages({ mailbox: "Deleted Items" });
  assert.equal(result.deletedCount, 251);
  assert.equal(result.batches, 2);
  assert.equal(commands[0], 'SELECT "Deleted Items"');
  assert.equal(commands.filter((command) => command.startsWith("UID STORE ")).length, 2);
  assert.equal(commands.at(-1), "EXPUNGE");
});

test("one.com archive move copies persisted UIDs before marking only present messages deleted", async () => {
  const commands = [];
  const client = new OneComMailClient({});
  client.withImapSession = async (callback) => callback({
    async command(command) {
      commands.push(command);
      if (command === "UID SEARCH UID 5,6,7") return { lines: ["* SEARCH 5 7"], literals: [] };
      return { lines: [], literals: [] };
    },
  });
  const result = await client.moveMessages({ mailbox: "INBOX", uids: [5, 6, 7], destination: "Stored" });
  assert.deepEqual(result.movedUids, [5, 7]);
  assert.deepEqual(result.missingUids, [6]);
  assert.deepEqual(commands, [
    'SELECT "INBOX"',
    "UID SEARCH UID 5,6,7",
    'UID COPY 5,7 "Stored"',
    "UID STORE 5,7 +FLAGS.SILENT (\\Deleted)",
    "EXPUNGE",
  ]);
});

function cleanupContext({ adminHasSpam = true } = {}) {
  const calls = [];
  const account = (key) => ({
    key,
    address: `${key}@jonathan-harris.online`,
    enabled: true,
  });
  const client = (key, includeSpam = true) => ({
    async listMailboxes() { return advertisedFolders({ includeSpam }); },
    async deleteAllMessages({ mailbox }) {
      calls.push({ key, mailbox });
      return { mailbox, deletedCount: key === "info" ? 2 : 1 };
    },
  });
  return {
    calls,
    context: {
      config: {
        emailCleanupEnabled: true,
        emailAccounts: { info: account("info") },
        manualEmailAccounts: { admin: account("admin"), newsletter: account("newsletter") },
      },
      oneComMailAccounts: { info: client("info") },
      manualMailAccounts: {
        admin: client("admin", adminHasSpam),
        newsletter: client("newsletter"),
      },
    },
  };
}

test("monthly cleanup permanently covers Info, Admin and Newsletter", async () => {
  const fixture = cleanupContext();
  const service = new CommsHubEmailMailboxCleanupService({ context: fixture.context });
  const result = await service.run({ confirmation: EMAIL_MAILBOX_CLEANUP_CONFIRMATION });
  assert.equal(result.ok, true);
  assert.equal(result.permanent, true);
  assert.equal(result.accountsTotal, 3);
  assert.equal(result.accountsSucceeded, 3);
  assert.deepEqual(result.accounts.map((account) => account.accountKey), ["info", "admin", "newsletter"]);
  assert.deepEqual(fixture.calls, [
    { key: "info", mailbox: "Unwanted" },
    { key: "info", mailbox: "Deleted Items" },
    { key: "admin", mailbox: "Unwanted" },
    { key: "admin", mailbox: "Deleted Items" },
    { key: "newsletter", mailbox: "Unwanted" },
    { key: "newsletter", mailbox: "Deleted Items" },
  ]);
});

test("cleanup fails one account closed while continuing the other governed accounts", async () => {
  const fixture = cleanupContext({ adminHasSpam: false });
  const service = new CommsHubEmailMailboxCleanupService({ context: fixture.context });
  const result = await service.run({ confirmation: EMAIL_MAILBOX_CLEANUP_CONFIRMATION });
  assert.equal(result.ok, false);
  assert.equal(result.accountsSucceeded, 2);
  assert.equal(result.accountsFailed, 1);
  assert.equal(result.accounts.find((account) => account.accountKey === "admin").failure.code, "email_cleanup_special_use_folders_unresolved");
  assert.ok(fixture.calls.some((call) => call.key === "newsletter"));
});

test("permanent cleanup requires the exact confirmation value", async () => {
  const fixture = cleanupContext();
  const service = new CommsHubEmailMailboxCleanupService({ context: fixture.context });
  await assert.rejects(
    () => service.run({ confirmation: "yes" }),
    (error) => error?.code === "email_cleanup_confirmation_required"
  );
  assert.deepEqual(fixture.calls, []);
});
