import test from "node:test";
import assert from "node:assert/strict";
import { validatePodcastShowCoverPng } from "../services/rss-feed-podcast/showCoverValidation.js";

function stubCover(width, height, colourType = 2) {
  const bytes = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8;
  bytes[25] = colourType;
  return bytes;
}

test("accepts a versioned, opaque RGB show cover within Apple RSS limits", () => {
  assert.deepEqual(validatePodcastShowCoverPng(stubCover(3000, 3000)), {
    ok: true, width: 3000, height: 3000, format: "image/png", opaqueRgb: true,
  });
});

test("rejects undersized, oversized and non-square show covers", () => {
  for (const [w, h] of [[1254, 1254], [3001, 3001], [2000, 1900]]) {
    assert.throws(() => validatePodcastShowCoverPng(stubCover(w, h)), /invalid dimensions/);
  }
});

test("rejects PNGs with alpha and corrupt signatures", () => {
  assert.throws(() => validatePodcastShowCoverPng(stubCover(3000, 3000, 6)), /no alpha/);
  assert.throws(() => validatePodcastShowCoverPng(Buffer.from("not an image")), /PNG image/);
});
