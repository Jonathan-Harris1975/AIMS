import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const policyUrl = new URL("../config/r2-access-policy.json", import.meta.url);
const clientUrl = new URL("../services/shared/utils/r2-client.js", import.meta.url);
const podcastProcessorUrl = new URL("../services/tts/utils/podcastProcessor.js", import.meta.url);
const ttsProcessorUrl = new URL("../services/tts/utils/ttsProcessor.js", import.meta.url);
const mergeProcessorUrl = new URL("../services/tts/utils/mergeProcessor.js", import.meta.url);
const editingProcessorUrl = new URL("../services/tts/utils/editingProcessor.js", import.meta.url);

test("R2 policy classifies all AIMS internal/intermediate buckets as private", async () => {
  const policy = JSON.parse(await fs.readFile(policyUrl, "utf8"));
  const privateNames = new Set(policy.buckets.filter((entry) => entry.access === "private").map((entry) => entry.bucket));
  for (const name of ["metasystem", "comms-hub", "comms-hub-private", "audits", "raw-text", "podcast-chunks", "podcast-merged", "podcast-meta", "edited"]) {
    assert.equal(privateNames.has(name), true, `${name} should be private`);
  }
  assert.equal(policy.buckets.find((entry) => entry.bucket === "hive-skills")?.access, "public-temporary");
});

test("AIMS internal podcast path uses authenticated R2 for private intermediate artefacts", async () => {
  const [client, podcast, tts, merge, editing] = await Promise.all([
    fs.readFile(clientUrl, "utf8"),
    fs.readFile(podcastProcessorUrl, "utf8"),
    fs.readFile(ttsProcessorUrl, "utf8"),
    fs.readFile(mergeProcessorUrl, "utf8"),
    fs.readFile(editingProcessorUrl, "utf8"),
  ]);
  assert.match(client, /PRIVATE_READY_BUCKET_ALIASES/);
  assert.match(client, /getObjectAsBuffer/);
  assert.match(client, /uploadPrivateBuffer/);
  assert.match(podcast, /getObjectAsBuffer\("editedAudio"/);
  assert.match(podcast, /getObjectAsText\("meta"/);
  assert.match(tts, /uploadPrivateBuffer\(CHUNKS_BUCKET_KEY/);
  assert.match(merge, /getR2ReferenceAsBuffer/);
  assert.match(merge, /uploadPrivateBuffer\(MERGED_BUCKET/);
  assert.match(editing, /uploadPrivateBuffer\("editedAudio"/);
});

test("target-private AIMS buckets no longer ship public base URLs", async () => {
  const env = await fs.readFile(new URL("../config/production.defaults.env", import.meta.url), "utf8");
  for (const name of ["R2_PUBLIC_BASE_URL_META_SYSTEM", "R2_PUBLIC_BASE_URL_COMMS_HUB"]) {
    assert.match(env, new RegExp(`^${name}=$`, "m"));
  }

  // Compatibility URLs remain only for buckets still marked temporary/public in the access matrix.
  for (const name of ["R2_PUBLIC_BASE_URL_AUDITS", "R2_PUBLIC_BASE_URL_RAW_TEXT", "R2_PUBLIC_BASE_URL_CHUNKS", "R2_PUBLIC_BASE_URL_MERGE", "R2_PUBLIC_BASE_URL_META", "R2_PUBLIC_BASE_URL_EDITED_AUDIO", "R2_PUBLIC_BASE_URL_HIVE_SKILLS"]) {
    assert.match(env, new RegExp(`^${name}=.+$`, "m"));
  }
});
