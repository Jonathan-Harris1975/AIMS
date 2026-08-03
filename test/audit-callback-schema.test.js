import test from "node:test";
import assert from "node:assert/strict";

import { auditCallbackBodySchema } from "../services/shared/utils/requestSchemas.js";

test("successful audit callbacks tolerate legacy null error values", () => {
  const result = auditCallbackBodySchema.safeParse({
    auditType: "digital-growth",
    sessionId: "session-1",
    status: "completed",
    reportPrefix: "audits/test/session-1",
    error: null,
  });

  assert.equal(result.success, true);
  assert.equal(result.data.error, undefined);
});
