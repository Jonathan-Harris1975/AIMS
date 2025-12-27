// ============================================================
// ℹ️ Podcast Info Utilities
// ============================================================
// Minimal implementation to satisfy /info route imports.
// Extend this to return richer metadata if needed.
// ============================================================

/**
 * Return basic info about a generated audio file.
 * Currently returns a minimal object so the route can operate without
 * module-resolution failures.
 *
 * @param {string} filename
 * @returns {Promise<{filename: string}>}
 */
export async function getPodcastInfo(filename) {
  return { filename };
}

export default getPodcastInfo;
