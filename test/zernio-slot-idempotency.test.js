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
