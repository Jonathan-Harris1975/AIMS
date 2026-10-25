import test from "node:test";
import assert from "node:assert/strict";
import { downloadKdpObjectToTempFile } from "../services/kdp/storage.js";

test("KDP manuscript references are restricted to the catalogue's private PDF prefix", async () => {
  await assert.rejects(
    downloadKdpObjectToTempFile("covers/cover.pdf", { expectedPrefix: "Manuscripts pdf format/" }),
    (error) => error.code === "invalid_kdp_content_key",
  );
  await assert.rejects(
    downloadKdpObjectToTempFile("../private/secret.pdf", { expectedPrefix: "Manuscripts pdf format/" }),
    /unsafe path traversal segment/,
  );
});
