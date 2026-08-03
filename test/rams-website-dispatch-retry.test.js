import assert from "node:assert/strict";
import test from "node:test";
import { isRetryableDispatchError } from "../audits/utils/ramsWebsiteDispatchRetry.js";

test("RAMS contract failures are not retried while transient failures remain retryable", () => {
  const contractError = new Error("RAMS website remediation completed with an error: website audit JSON could not be read or failed schema validation");
  assert.equal(isRetryableDispatchError(contractError), false);

  const badRequest = new Error("RAMS website rebuild dispatch returned HTTP 400");
  badRequest.status = 400;
  assert.equal(isRetryableDispatchError(badRequest), false);

  const throttled = new Error("RAMS website rebuild dispatch returned HTTP 429");
  throttled.status = 429;
  assert.equal(isRetryableDispatchError(throttled), true);
  assert.equal(isRetryableDispatchError(new Error("fetch failed")), true);
});
