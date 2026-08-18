import { log } from "../../../logger.js";
import { clearSession } from "../../script/utils/sessionCache.js";

/**
 * Clear ephemeral podcast/script state for one completed session.
 * Durable R2 objects and job records are intentionally untouched.
 */
export async function cleanupTempMemory(sessionId) {
  if (!sessionId) {
    log.warn("cleanupTempMemory called without sessionId");
    return false;
  }

  try {
    await clearSession(sessionId);
    return true;
  } catch (error) {
    log.warn("cleanupTempMemory failed", {
      sessionId,
      error: error?.message || String(error),
    });
    return false;
  }
}

export default cleanupTempMemory;
