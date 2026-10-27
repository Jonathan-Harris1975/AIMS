import test from "node:test";
import assert from "node:assert/strict";
import { parseBooksMetadataRefs } from "../services/kdp/engine/kdpReportsApi.ts";
import { verifiedRefAsin } from "../services/kdp/engine/kdpMetadata.ts";

test("reports retain an explicitly associated Kindle ASIN without using the title ID as an ASIN", () => {
  const refs = parseBooksMetadataRefs([{ titleId: "A123456789012", format: "kindle", asin: "B012345678" }]);
  assert.equal(refs[0].titleId, "A123456789012");
  assert.equal(verifiedRefAsin("", refs[0].asin), "B012345678");
  assert.equal(verifiedRefAsin("", "A123456789012"), "");
  assert.equal(verifiedRefAsin("B011111111", "B022222222"), "");
});

test("conflicting report rows cannot provide an ASIN", () => {
  const refs = parseBooksMetadataRefs([
    { titleId: "A123456789012", format: "kindle", asin: "B011111111" },
    { titleId: "A123456789012", format: "kindle", asin: "B022222222" },
  ]);
  assert.equal(refs[0].asin, undefined);
});
