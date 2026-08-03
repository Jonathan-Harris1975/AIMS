import test from "node:test";
import assert from "node:assert/strict";
import { detectImageFormat } from "../services/artwork/utils/imageFormat.js";

test("artwork format detection prevents JPEG bytes being labelled as PNG", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const result = detectImageFormat(jpeg.toString("base64"));
  assert.equal(result.mimeType, "image/jpeg");
  assert.equal(result.extension, "jpg");
  assert.deepEqual(result.buffer, jpeg);
});

test("artwork format detection recognises PNG data URLs", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const result = detectImageFormat(`data:image/png;base64,${png.toString("base64")}`);
  assert.equal(result.mimeType, "image/png");
  assert.equal(result.extension, "png");
});
