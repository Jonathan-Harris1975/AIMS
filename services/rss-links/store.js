// services/rss-links/store.js
//
// Thin KV-like interface over the suite's readJsonState / writeJsonState.
// Data lives in `rss-links-store.json` inside APP_STATE_DIR and is
// automatically shadowed to R2_BUCKET_META_SYSTEM when R2 credentials
// are present (via the shared stateFile module).
//
// NOTE: rss-links-store.json is not listed in KNOWN_REMOTE_FILES inside
// stateFile.js, so it is NOT pre-loaded from R2 at boot.  If durable
// cross-restart state matters in production, add "rss-links-store.json"
// to KNOWN_REMOTE_FILES in services/shared/utils/stateFile.js.
//
import { readJsonState, writeJsonState } from "../shared/utils/stateFile.js";
import { debug } from "../../logger.js";

const STATE_FILE = "rss-links-store.json";

// Module-level in-memory cache so repeated reads within a request are O(1).
// Seeded once from disk / remote state on first access.
let _cache = null;

function getCache() {
  if (_cache === null) {
    _cache = readJsonState(STATE_FILE, {});
    debug("rss-links.store.loaded", { keys: Object.keys(_cache).length });
  }
  return _cache;
}

/**
 * Retrieve a value by key.
 * @param {string} key
 * @returns {string|null}
 */
export function kvGet(key) {
  return getCache()[key] ?? null;
}

/**
 * Store a key → value pair and persist to disk (+ R2 if configured).
 * @param {string} key
 * @param {string} value
 */
export function kvPut(key, value) {
  const store = getCache();
  store[key] = value;
  writeJsonState(STATE_FILE, store);
  debug("rss-links.store.put", { key });
}
