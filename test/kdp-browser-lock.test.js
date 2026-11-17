import test from "node:test";
import assert from "node:assert/strict";
import { claimExclusiveKdpBrowserLease } from "../services/kdp/engine/browser.ts";

test("every authenticated KDP worker claims the same shared account-wide R2 lock", async () => {
  let checked = false;
  const acquired = await claimExclusiveKdpBrowserLease(async opts => {
    assert.deepEqual({ namespace:opts.namespace, key:opts.key },
      { namespace:"kdp-account",key:"browser-session" });
    assert.ok(opts.pendingTtlMs > 90 * 60_000);
    checked = true;
    return { claimed:true, lease:{ backend:"r2", objectKey:"leases/kdp-account/test" } };
  }, true);
  assert.equal(checked,true);
  assert.equal(acquired.lease.backend,"r2");
});

test("occupied remote KDP account blocks a second browser session", async () => {
  await assert.rejects(claimExclusiveKdpBrowserLease(async () => ({
    claimed:false,reason:"already-owned",
  }), true), /busy in another production worker/);
});

test("production refuses a machine-local lock even when the browser itself is available", async () => {
  await assert.rejects(claimExclusiveKdpBrowserLease(async () => ({
    claimed:true,lease:{backend:"local"},
  }), true), /distributed R2 account-session lock/);
});
