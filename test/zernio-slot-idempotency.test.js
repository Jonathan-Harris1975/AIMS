import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Zernio slot identity is independent of content and image payloads", async () => {
  const source = await readFile(new URL("../services/zernio/utils/state.js", import.meta.url), "utf8");
  const match = source.match(/export function buildScheduleSlotKey\([^)]*\) \{([\s\S]*?)\n\}/);
  assert.ok(match, "buildScheduleSlotKey source should be present");
  const body = match[1];

  assert.match(body, /normaliseSlotPart\(scope \|\| "zernio"\)/);
  assert.match(body, /normaliseSlotPart\(scheduledDateTime\)/);
  assert.match(body, /normaliseSlotPart\(profileName\)/);
  assert.match(body, /normaliseSlotPart\(accountId\)/);
  assert.doesNotMatch(body, /imageUrl/);
  assert.doesNotMatch(body, /sourceIntentHash/);
  assert.match(source, /sameScheduleSlot\(claim, input\)/);
  assert.match(source, /claim\.key === key \|\| sameScheduleSlot\(claim, input\)/);
});

test("Zernio recovered times keep the original canonical slot and provider idempotency seed", async () => {
  const scheduler = await readFile(new URL("../services/zernio/utils/socialScheduler.js", import.meta.url), "utf8");
  const client = await readFile(new URL("../services/zernio/utils/zernioClient.js", import.meta.url), "utf8");

  assert.match(scheduler, /canonicalScheduledDateTime = scheduleResolution\.originalScheduledDateTime \|\| originalScheduledDateTime/);
  assert.match(scheduler, /claimInput = \{ scope, scheduledDateTime: canonicalScheduledDateTime/);
  assert.match(scheduler, /claimScheduleSlot\(claimInput\)/);
  assert.match(scheduler, /idempotencySeed: slotClaim\.key \|\| ""/);
  assert.match(scheduler, /createPost\(payload, apiKey, \{ idempotencySeed \}\)/);
  assert.match(client, /material = seed \? `\$\{endpoint\}:slot:\$\{seed\}`/);
});

test("Zernio accepts its documented existingPost response when a recovered retry moved the local time", async () => {
  const { verifyZernioScheduleResponse } = await import(`../services/zernio/utils/socialScheduler.js?idempotent-replay=${Date.now()}`);

  const replay = verifyZernioScheduleResponse({
    existingPost: {
      _id: "post_already_scheduled",
      status: "scheduled",
      scheduledFor: "2026-09-03T12:35:00+01:00",
    },
  }, "2026-09-03 12:52");

  assert.equal(replay.accepted, true);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.timeMatches, false);
  assert.equal(replay.replayTimeDifferenceAccepted, true);

  const unrelated = verifyZernioScheduleResponse({
    post: {
      _id: "post_unrelated",
      status: "scheduled",
      scheduledFor: "2026-09-03T12:35:00+01:00",
    },
  }, "2026-09-03 12:52");
  assert.equal(unrelated.accepted, false);
  assert.equal(unrelated.idempotentReplay, false);
});
