import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { COMMS_HUB_REQUIRED_MIGRATIONS } from "../services/comms-hub/migrations/manifest.js";
import { CommsOperationsRepository } from "../services/comms-hub/repositories/commsOperationsRepository.js";
import { canReadOwnerSystemNotifications } from "../services/comms-hub/domain/rbac.js";

test("only the signed delegated HIVE administrator receives the system inbox alias", () => {
  const identity = { actor: "hive-owner", role: "admin", strategy: "delegated-hmac" };
  assert.equal(canReadOwnerSystemNotifications(identity), true);
  for (const other of [
    { ...identity, actor: "other" }, { ...identity, role: "read_only" },
    { ...identity, role: "reviewer" }, { ...identity, strategy: "suite" }, null,
  ]) assert.equal(canReadOwnerSystemNotifications(other), false);
});

test("owner system inbox lists and acknowledges only scoped records without rewriting recipients", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const name of COMMS_HUB_REQUIRED_MIGRATIONS) {
      db.exec(readFileSync(new URL(`../services/comms-hub/migrations/${name}.sql`, import.meta.url), "utf8"));
    }
    const repo = new CommsOperationsRepository({
      query: (sql, params = []) => ({ success: true, results: db.prepare(sql).all(...params) }),
    });
    for (const [id, actor, type] of [
      ["system-admin", "admin", "system"], ["failure-admin", "admin", "failure"],
      ["private-admin", "admin", "assignment"], ["mention-admin", "admin", "mention"],
      ["owner-private", "hive-owner", "assignment"], ["other", "AIMS", "failure"],
    ]) {
      await repo.createNotification({
        id, actor, type, title: "Test", bodyText: "Test", severity: "critical",
        createdAt: "2026-11-28T00:00:00.000Z", emailRequested: false,
      });
    }
    const owner = { actor: "hive-owner", includeOwnerSystem: true };
    assert.deepEqual((await repo.listNotifications(owner)).map(row => row.id).sort(),
      ["failure-admin", "owner-private", "system-admin"]);
    assert.deepEqual((await repo.listNotifications({ actor: "hive-owner" })).map(row => row.id), ["owner-private"]);
    assert.deepEqual((await repo.listNotifications({ actor: "AIMS", includeOwnerSystem: true })).map(row => row.id), ["other"]);
    assert.equal(await repo.markNotification({ ...owner, id: "private-admin", status: "read" }), null);
    assert.equal(await repo.markNotification({ ...owner, id: "other", status: "read" }), null);
    const marked = await repo.markNotification({ ...owner, id: "system-admin", status: "read" });
    assert.equal(marked.actor, "admin");
    assert.equal(marked.status, "read");
    assert.deepEqual((await repo.listNotifications(owner)).map(row => row.id).sort(), ["failure-admin", "owner-private"]);
  } finally { db.close(); }
});
