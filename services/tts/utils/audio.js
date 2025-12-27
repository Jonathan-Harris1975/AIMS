// ============================================================
// 🎧 Audio Utilities (Merge Wrapper)
// ============================================================
// This module exists to support legacy merge routes.
// It wraps the canonical mergeProcessor.
// ============================================================

import mergeProcessor from "./mergeProcessor.js";

/**
 * Merge all chunks for a sessionId using the canonical mergeProcessor.
 * @param {string} sessionId
 * @returns {Promise<any>}
 */
export async function mergeChunks(sessionId) {
  return mergeProcessor(sessionId);
}

export default mergeChunks;
