import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { nextSendTimeUtc } from "../services/newsletter/utils/scheduling.js";

describe("newsletter utils/scheduling.js", () => {
  test("returns 10:00 GMT (UTC+0) in winter", () => {
    const from = new Date("2026-01-15T00:00:00Z");
    const result = nextSendTimeUtc({ from, timeZone: "Europe/London", hourLocal: 10, minuteLocal: 0 });
    assert.equal(result.toISOString(), "2026-01-15T10:00:00.000Z");
  });

  test("returns 10:00 BST as 09:00 UTC in summer", () => {
    const from = new Date("2026-07-15T00:00:00Z");
    const result = nextSendTimeUtc({ from, timeZone: "Europe/London", hourLocal: 10, minuteLocal: 0 });
    assert.equal(result.toISOString(), "2026-07-15T09:00:00.000Z");
  });

  test("rolls to the next day when the send time has already passed today", () => {
    const from = new Date("2026-07-15T12:00:00Z"); // after 09:00 UTC (10:00 BST) send time
    const result = nextSendTimeUtc({ from, timeZone: "Europe/London", hourLocal: 10, minuteLocal: 0 });
    assert.equal(result.toISOString(), "2026-07-16T09:00:00.000Z");
    assert.ok(result > from);
  });

  test("respects a different configured timezone", () => {
    const from = new Date("2026-07-15T00:00:00Z");
    const result = nextSendTimeUtc({ from, timeZone: "America/New_York", hourLocal: 10, minuteLocal: 0 });
    // 10:00 EDT (UTC-4) = 14:00 UTC
    assert.equal(result.toISOString(), "2026-07-15T14:00:00.000Z");
  });
});
