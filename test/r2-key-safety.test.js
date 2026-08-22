import test from "node:test";
import assert from "node:assert/strict";
import "../config/loadEnv.js";
import { normaliseR2ObjectKey, buildPublicUrl, buildR2Reference } from "../services/shared/utils/r2-client.js";

test("R2 object keys reject traversal, absolute paths and URL fragments", () => {
  assert.equal(normaliseR2ObjectKey("audits/on-brand/latest.json"), "audits/on-brand/latest.json");
  assert.equal(normaliseR2ObjectKey("nested\\\\windows\\path.json"), "nested/windows/path.json");

  for (const key of ["../secret.json", "audits/../secret.json", "/absolute/key.json", "feed.xml?token=leak", "feed.xml#frag", "bad\nkey.json"]) {
    assert.throws(() => normaliseR2ObjectKey(key), /R2 object key|unsafe|relative|query|control/i, key);
  }
});

test("private R2 reference builder uses the safe object key validator", () => {
  assert.equal(
    buildR2Reference("audits", "audits/on-brand/latest.json"),
    "r2://audits/audits/on-brand/latest.json"
  );

  assert.throws(
    () => buildR2Reference("audits", "audits/on-brand/../../secret.json"),
    /unsafe path traversal/i
  );

  assert.throws(
    () => buildPublicUrl("audits", "audits/on-brand/latest.json"),
    /no public URL configured/i
  );
});
