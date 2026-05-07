// =======================================================================
// 🎧 MODULAR STREAMING MERGE PROCESSOR
// Supports mixing remote URLs + local batch files safely
// =======================================================================

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import fetch from "node-fetch";
import { info, error, warn, debug } from "../../../logger.js";
import { startKeepAlive, stopKeepAlive } from "../../shared/utils/keepalive.js";
import { uploadBuffer } from "../../shared/utils/r2-client.js";

const TMP_DIR = path.resolve(process.env.PODCAST_MERGE_TMP_DIR || path.join(process.env.APP_TMP_DIR || "/tmp", "podcast_merge"));
const MERGED_BUCKET = "merged";

// ------------------------------------------------------------
// ⚙️ Environment-based tuning
// ------------------------------------------------------------
function positiveIntEnv(name, fallback, max = Number.POSITIVE_INFINITY) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

const DOWNLOAD_TIMEOUT_MS = positiveIntEnv("MERGE_DOWNLOAD_TIMEOUT_MS", Number(process.env.AI_TIMEOUT || 30000), 120_000);
const FFMPEG_TIMEOUT_MS = positiveIntEnv("PODCAST_FFMPEG_TIMEOUT_MS", 900_000, 1_800_000);
const MAX_RETRIES = positiveIntEnv("MAX_CHUNK_RETRIES", 3, 8);
const DOWNLOAD_RETRIES = MAX_RETRIES;
const MERGE_RETRIES = MAX_RETRIES;
const RETRY_DELAY_MS = positiveIntEnv("RETRY_DELAY_MS", 2000);
const RETRY_BACKOFF_MULTIPLIER = Number(process.env.RETRY_BACKOFF_MULTIPLIER || 2);
const CLEANUP_DELAY_MS = positiveIntEnv("MERGE_CLEANUP_DELAY_MS", 120_000, 900_000);

// Merge smaller groups recursively. Keep conservative on 1 vCPU Koyeb instances.
const BATCH_SIZE = positiveIntEnv("MERGE_BATCH_SIZE", 2, 4);

// ------------------------------------------------------------
// 🛡 Create merge directory
// ------------------------------------------------------------
function ensureTmpDir() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

// ------------------------------------------------------------
// 🧠 Type Guard — remote URL or local file?
// ------------------------------------------------------------
function isRemote(input) {
  return typeof input === "string" && /^https?:\/\//i.test(input);
}

// ------------------------------------------------------------
// 🌐 Remote Download w/ Timeout + Retries
// ------------------------------------------------------------
async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Download timeout after ${DOWNLOAD_TIMEOUT_MS}ms`));
  }, DOWNLOAD_TIMEOUT_MS);
  timeoutId.unref?.();

  try {
    return await fetch(url, { signal: controller.signal });
  } catch (err) {
    const aborted = err?.name === "AbortError" || err?.code === "ABORT_ERR";
    if (aborted) {
      throw new Error(`Download timeout after ${DOWNLOAD_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function downloadRemoteToBuffer(url, attempt = 1) {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    if (attempt < DOWNLOAD_RETRIES) {
      const delay =
        RETRY_DELAY_MS * Math.pow(RETRY_BACKOFF_MULTIPLIER, attempt - 1);

      warn("Retrying remote download", { attempt, delayMs: delay });
      await new Promise((resolve) => setTimeout(resolve, delay));
      return downloadRemoteToBuffer(url, attempt + 1);
    }
    throw new Error(`Remote download failed after ${DOWNLOAD_RETRIES} attempts`);
  }
}

// ------------------------------------------------------------
// 📁 Local File Read w/ Retry
// ------------------------------------------------------------
async function loadLocalToBuffer(localPath, attempt = 1) {
  try {
    return fs.readFileSync(localPath);
  } catch (err) {
    if (attempt < DOWNLOAD_RETRIES) {
      const delay =
        RETRY_DELAY_MS * Math.pow(RETRY_BACKOFF_MULTIPLIER, attempt - 1);

      warn("Retrying local file read", { attempt, delayMs: delay });
      await new Promise((resolve) => setTimeout(resolve, delay));
      return loadLocalToBuffer(localPath, attempt + 1);
    }
    throw new Error(`Local file read failed after ${DOWNLOAD_RETRIES} attempts`);
  }
}

// ------------------------------------------------------------
// 🤝 Unified Buffer Loader (Remote or Local)
// ------------------------------------------------------------
async function loadChunk(input) {
  if (isRemote(input)) return downloadRemoteToBuffer(input);
  return loadLocalToBuffer(input);
}


function writeBufferToTemp(sessionId, label, buffer) {
  ensureTmpDir();
  const safeLabel = String(label || "chunk").replace(/[^a-z0-9_-]+/gi, "_");
  const outputPath = path.join(TMP_DIR, `${sessionId}_${safeLabel}.mp3`);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

export async function materializeSourceToLocal(sessionId, source, label = "single") {
  if (!source) {
    throw new Error("Cannot materialize an empty source");
  }

  if (!isRemote(source)) {
    return source;
  }

  const buffer = await loadChunk(source);
  return writeBufferToTemp(sessionId, label, buffer);
}

// ------------------------------------------------------------
// 🎧 STREAM MERGE — merge array of buffers into outputPath
// ------------------------------------------------------------
async function streamMergeBuffers(buffers, outputPath, attempt = 1) {
  try {
    const ff = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "mp3",
      "-i",
      "pipe:0",
      "-c",
      "copy",
      "-y",
      outputPath,
    ]);

    let stderr = "";

    ff.stderr.on("data", (d) => (stderr += d.toString()));

    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        ff.kill("SIGKILL");
        reject(new Error(`FFmpeg merge timed out after ${FFMPEG_TIMEOUT_MS}ms`));
      }, FFMPEG_TIMEOUT_MS);
      timer.unref?.();

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };

      ff.on("error", (err) => finish(reject, err));
      ff.on("close", (code) => {
        if (code !== 0) {
          finish(reject, new Error(`FFmpeg failed (code ${code}): ${stderr}`));
          return;
        }
        finish(resolve);
      });

      for (const buf of buffers) {
        const ok = ff.stdin.write(buf);
        if (!ok) ff.stdin.once("drain", () => {});
      }
      ff.stdin.end();
    });

    return outputPath;
  } catch (err) {
    if (attempt < MERGE_RETRIES) {
      const delay =
        RETRY_DELAY_MS * Math.pow(RETRY_BACKOFF_MULTIPLIER, attempt - 1);

      warn("Retrying merge batch", { attempt, delayMs: delay });
      return streamMergeBuffers(buffers, outputPath, attempt + 1);
    }
    throw err;
  }
}

// ------------------------------------------------------------
// 🧩 MODULAR BATCH MERGE (recursive, bulletproof)
// ------------------------------------------------------------
async function modularMerge(sessionId, sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error("modularMerge requires at least one source.");
  }

  if (sources.length === 1) {
    return materializeSourceToLocal(sessionId, sources[0], "single_0");
  }

  let round = 1;
  let current = sources;

  while (current.length > 1) {
    debug ("Batch merge round", {
      round,
      chunksRemaining: current.length,
    });

    const next = [];

    for (let i = 0; i < current.length; i += BATCH_SIZE) {
      const group = current.slice(i, i + BATCH_SIZE);

      const buffers = [];
      for (const source of group) {
        buffers.push(await loadChunk(source));
      }

      const batchOutput = path.join(
        TMP_DIR,
        `${sessionId}_batch_${round}_${i}.mp3`
      );

      await streamMergeBuffers(buffers, batchOutput);
      next.push(batchOutput);
    }

    current = next;
    round++;
  }

  return current[0];
}

// ------------------------------------------------------------
// 🧹 MEMORY CLEANUP - Remove temporary files
// ------------------------------------------------------------
function scheduleCleanup(finalPath, sessionId, delayMs = 120000) {
  const cleanupTimer = setTimeout(() => {
    try {
      // Clean up the final merged file
      if (fs.existsSync(finalPath)) {
        fs.unlinkSync(finalPath);
        debug("🧹 Cleaned up final merged file", { path: finalPath });
      }

      // Clean up any intermediate batch files
      const files = fs.readdirSync(TMP_DIR);
      const sessionFiles = files.filter(file => file.startsWith(sessionId));
      
      sessionFiles.forEach(file => {
        const filePath = path.join(TMP_DIR, file);
        try {
          fs.unlinkSync(filePath);
          debug("🧹 Cleaned up intermediate file", { file });
        } catch (err) {
          warn("Failed to clean up intermediate file", { file, error: err.message });
        }
      });

      info("🧹 Memory cleanup completed", { 
        sessionId, 
        filesRemoved: sessionFiles.length + (fs.existsSync(finalPath) ? 1 : 0)
      });
    } catch (err) {
      error("Memory cleanup failed", { 
        sessionId, 
        error: err.message 
      });
    }
  }, delayMs);
  cleanupTimer.unref?.();
}

// ------------------------------------------------------------
// 🚀 MAIN PROCESSOR
// ------------------------------------------------------------
export async function mergeProcessor(sessionId, chunkUrls = []) {
  const sid = sessionId || `TT-${Date.now()}`;
  const label = `mergeProcessor:${sid}`;

  startKeepAlive(label, 25000);
  ensureTmpDir();
  info("🎞️ Starting merge process")
  debug("Starting merge process", {
    sessionId: sid,
    totalChunks: chunkUrls.length,
  });

  try {
    if (!Array.isArray(chunkUrls) || chunkUrls.length === 0) {
      throw new Error("mergeProcessor requires chunk URLs.");
    }

    const finalPath = await modularMerge(sid, chunkUrls);

    if (!finalPath || !fs.existsSync(finalPath)) {
      throw new Error(`Merge output missing on local disk: ${finalPath || "<empty>"}`);
    }

    const mergedBuf = fs.readFileSync(finalPath);
    const mergedKey = `${sid}.mp3`;

    await uploadBuffer(MERGED_BUCKET, mergedKey, mergedBuf, "audio/mpeg");

    // ✅ CLEAN COMPLETION SUMMARY
    info("🟩 Merge process completed")
    debug("🟩 Merge process completed", {
      sessionId: sid,
      chunksProcessed: chunkUrls.length,
      outputKey: mergedKey,
      status: "success"
    });

    // 🧹 SCHEDULE MEMORY CLEANUP WITH SILENT DELAY
    scheduleCleanup(finalPath, sid, CLEANUP_DELAY_MS);
    info("🧹 Memory cleanup scheduled", { 
      sessionId: sid, 
      cleanupIn: `${Math.round(CLEANUP_DELAY_MS / 1000)} seconds` 
    });

    stopKeepAlive(label);
    return { key: mergedKey, localPath: finalPath };
  } catch (err) {
    error("Merge process failed", { 
      sessionId: sid,
      error: err.message,
      status: "failed"
    });
    stopKeepAlive(label);
    throw err;
  }
}

export { modularMerge };
export default mergeProcessor;
