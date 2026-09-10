import test from "node:test";
import assert from "node:assert/strict";
import {
  claimDurableLease,
  completeDurableLease,
  releaseDurableLease,
} from "../services/shared/utils/durableLease.js";

test("a durable lease gives one owner to concurrent triggers", async () => {
  const previous = process.env.STATE_BACKEND;
  process.env.STATE_BACKEND = "local";
  const key = `concurrent-${Date.now()}-${Math.random()}`;

  try {
    const [first, second] = await Promise.all([
      claimDurableLease({ namespace: "test", key }),
      claimDurableLease({ namespace: "test", key }),
    ]);
    const winner = [first, second].find((item) => item.claimed);
    const duplicate = [first, second].find((item) => !item.claimed);
    assert.ok(winner);
    assert.equal(duplicate?.duplicatePrevented, true);
    assert.equal(duplicate?.state, "pending");

    await releaseDurableLease(winner.lease, { reason: "test-retry" });
    const retry = await claimDurableLease({ namespace: "test", key });
    assert.equal(retry.claimed, true);
    await completeDurableLease(retry.lease, { postId: "one-post" });

    const completedDuplicate = await claimDurableLease({ namespace: "test", key });
    assert.equal(completedDuplicate.claimed, false);
    assert.equal(completedDuplicate.state, "completed");
  } finally {
    if (previous === undefined) delete process.env.STATE_BACKEND;
    else process.env.STATE_BACKEND = previous;
  }
});
