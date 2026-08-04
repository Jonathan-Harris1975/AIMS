import test from "node:test";
import assert from "node:assert/strict";
import { pollUntil } from "../services/blotato/utils/pollUntil.js";

test("Blotato polling stops at the wall-clock limit before exhausting a large attempt budget", async () => {
  let currentTimeMs = 0;
  let calls = 0;
  const pendingError = Object.assign(new Error("Video generation is not complete. You most likely ran out of credits."), {
    statusCode: 500,
    details: { status: "processing" },
  });

  await assert.rejects(
    pollUntil({
      label: "Blotato video render",
      run: async () => {
        calls += 1;
        throw pendingError;
      },
      extractStatus: () => "processing",
      isDone: () => false,
      isDonePayload: () => false,
      isFailed: () => false,
      isPendingError: () => true,
      maxAttempts: 720,
      intervalMs: 5_000,
      maxDurationMs: 15_000,
      progressEvery: 0,
      now: () => currentTimeMs,
      wait: async (ms) => {
        currentTimeMs += ms;
      },
    }),
    (error) => {
      assert.equal(error.statusCode, 504);
      assert.equal(error.code, "blotato-poll-duration-exceeded");
      assert.equal(error.polling.elapsedMs, 15_000);
      assert.equal(error.polling.maxDurationMs, 15_000);
      assert.equal(error.cause, pendingError);
      return true;
    }
  );

  assert.equal(calls, 3);
});
