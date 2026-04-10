import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";

import { materializeSourceToLocal } from "../services/tts/utils/mergeProcessor.js";

test("materializeSourceToLocal downloads a remote chunk to a local temp file", async () => {
  const audioBytes = Buffer.from("fake-mp3-data");

  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "audio/mpeg" });
    res.end(audioBytes);
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/chunk-001.mp3`;

  try {
    const localPath = await materializeSourceToLocal("TT-test-materialize", url, "remote_single");
    assert.equal(fs.existsSync(localPath), true);
    assert.deepEqual(fs.readFileSync(localPath), audioBytes);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
