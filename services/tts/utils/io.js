// services/tts/utils/io.js
// Unified I/O helpers for TTS audio pipeline – central R2 + logger

import { putObject, putJson, R2_BUCKET_RAW_AUDIO } from "../../shared/utils/r2-client.js";
import { info } from "../../../logger.js";

// Use canonical alias keys for the shared R2 client.
const RAW_BUCKET = R2_BUCKET_RAW_AUDIO;
const MERGED_BUCKET = "merged";
const META_BUCKET = "meta";
const PODCAST_BUCKET = "podcast";
const PUBLIC_BASE = process.env.R2_PUBLIC_BASE_URL_PODCAST;

function requireEnv(name, val) {
  if (!val) throw new Error(`Missing required env: ${name}`);
  return val;
}

export async function saveTtsChunk(audioBuffer, key) {
  requireEnv("R2_BUCKET_RAW", process.env.R2_BUCKET_RAW);
  await putObject(RAW_BUCKET, key, audioBuffer, "audio/mpeg");
  info("tts.chunk.put", { bucket: RAW_BUCKET, key, bytes: audioBuffer.length });
}

export async function saveMergedTts(audioBuffer, key) {
  requireEnv("R2_BUCKET_MERGED", process.env.R2_BUCKET_MERGED);
  await putObject(MERGED_BUCKET, key, audioBuffer, "audio/mpeg");
  info("tts.merged.put", { bucket: MERGED_BUCKET, key, bytes: audioBuffer.length });
}

export async function saveTtsMeta(key, data) {
  requireEnv("R2_BUCKET_META", process.env.R2_BUCKET_META);
  await putJson(META_BUCKET, key, data);
  info("tts.meta.put", { bucket: META_BUCKET, key });
}

export async function publishFinalTts(audioBuffer, key) {
  requireEnv("R2_BUCKET_PODCAST", process.env.R2_BUCKET_PODCAST);
  requireEnv("R2_PUBLIC_BASE_URL_PODCAST", PUBLIC_BASE);

  await putObject(PODCAST_BUCKET, key, audioBuffer, "audio/mpeg");
  info("tts.publish.put", { bucket: PODCAST_BUCKET, key, bytes: audioBuffer.length });

  const publicUrl = `${PUBLIC_BASE.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
  info("tts.publish.url", { url: publicUrl });

  return publicUrl;
}
