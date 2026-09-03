import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("Zernio reclaims an orphaned pending slot and keeps completed slots duplicate-safe", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aims-zernio-orphaned-slot-"));
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    APP_TMP_DIR: process.env.APP_TMP_DIR,
    STATE_BACKEND: process.env.STATE_BACKEND,
    ALLOW_EPHEMERAL_STATE: process.env.ALLOW_EPHEMERAL_STATE,
  };

  process.env.NODE_ENV = "test";
  process.env.APP_TMP_DIR = tempDir;
  process.env.STATE_BACKEND = "local";
  process.env.ALLOW_EPHEMERAL_STATE = "true";

  try {
    const state = await import(`../services/zernio/utils/state.js?orphan-recovery=${Date.now()}`);
    const input = {
      scope: "daily:thursday",
      scheduledDateTime: "2026-09-03 12:20",
      profileName: "Default",
      accountId: "ALL",
    };
    const key = state.buildScheduleSlotKey(input);
    state.writeZernioState({
      lanes: {},
      quiz: { topics: [], scheduled: [] },
      weeklyLedger: [],
      spotlightPeople: [],
      usedSocialSources: [],
      slotClaims: [{
        ...input,
        key,
        state: "pending",
        createdAt: "2026-09-03T08:00:00.000Z",
        updatedAt: "2026-09-03T08:00:00.000Z",
        expiresAt: Date.now() + 60 * 60_000,
      }],
    });

    const reclaimed = await state.claimScheduleSlot(input);
    assert.equal(reclaimed.claimed, true);
    assert.equal(reclaimed.duplicatePrevented, false);
    assert.equal(reclaimed.recoveredOrphanedClaim, true);
    assert.equal(reclaimed.key, key);

    state.completeScheduleSlot(reclaimed, { postId: "zernio-post-1" });
    const completedDuplicate = await state.claimScheduleSlot(input);
    assert.equal(completedDuplicate.claimed, false);
    assert.equal(completedDuplicate.duplicatePrevented, true);
    assert.equal(completedDuplicate.reason, "same-slot-already-completed");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});
