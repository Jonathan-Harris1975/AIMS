// services/shared/utils/cleanupSessionFinal.js
// ============================================================
// 🧹 FINAL MEMORY CLEANUP (SAFE PREFIX MODE)
// ============================================================
// Only removes objects that are clearly owned by the session.
// Avoids whole-bucket substring scans that can delete unrelated files.
// ============================================================

import { log, debug } from "../../../logger.js";
import { listKeys, deleteObject } from "./r2-client.js";

const PREFIXES_BY_BUCKET = {
  edited: (sessionId) => [`${sessionId}`, `${sessionId}_`],
  rawtext: (sessionId) => [`${sessionId}`, `${sessionId}/`],
  merged: (sessionId) => [`${sessionId}`, `${sessionId}_`],
  chunks: (sessionId) => [`${sessionId}/`, `${sessionId}_`],
  "raw-text": (sessionId) => [`${sessionId}`, `${sessionId}/`],
  "edited-audio": (sessionId) => [`${sessionId}`, `${sessionId}_`],
};

export async function finalCleanupSession(sessionId) {
  if (!sessionId) {
    log.warn("finalCleanupSession called without sessionId");
    return;
  }

  log.debug("🧹 FINAL cleanup starting for session", { sessionId });

  for (const [bucketKey, prefixFactory] of Object.entries(PREFIXES_BY_BUCKET)) {
    try {
      const prefixes = prefixFactory(String(sessionId));
      const hits = new Set();

      for (const prefix of prefixes) {
        const keys = await listKeys(bucketKey, prefix);
        for (const key of keys || []) {
          if (key.startsWith(prefix)) {
            hits.add(key);
          }
        }
      }

      if (!hits.size) {
        debug("🧹 No stray objects found in bucket", { bucketKey, sessionId });
        continue;
      }

      log.debug("🗑️ FINAL cleanup deleting objects", {
        bucketKey,
        count: hits.size,
        sessionId,
      });

      for (const key of hits) {
        try {
          await deleteObject(bucketKey, key);
        } catch (err) {
          log.warn("⚠️ FINAL cleanup failed to delete object", {
            bucketKey,
            key,
            sessionId,
            error: err?.message,
          });
        }
      }
    } catch (err) {
      log.warn("⚠️ FINAL cleanup listing failed", {
        bucketKey,
        sessionId,
        error: err?.message,
      });
    }
  }

  log.info("🧹 FINAL cleanup completed", { sessionId });
}

export default finalCleanupSession;
