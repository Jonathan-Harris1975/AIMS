import assert from "node:assert/strict";
import test from "node:test";

import auditRouter, { auditRouter as namedAuditRouter } from "../audits/index.js";
import blotatoRouter, { blotatoRouter as namedBlotatoRouter } from "../services/blotato/index.js";
import commsHubRouter, { commsHubRouter as namedCommsHubRouter } from "../services/comms-hub/index.js";
import zernioRouter, { zernioRouter as namedZernioRouter } from "../services/zernio/index.js";

test("service entrypoints preserve their public default exports after wrapper consolidation", () => {
  assert.strictEqual(auditRouter, namedAuditRouter);
  assert.strictEqual(blotatoRouter, namedBlotatoRouter);
  assert.strictEqual(commsHubRouter, namedCommsHubRouter);
  assert.strictEqual(zernioRouter, namedZernioRouter);
});
