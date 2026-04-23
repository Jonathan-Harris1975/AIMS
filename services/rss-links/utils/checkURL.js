// services/rss-links/utils/checkURL.js
// Validates that a string is an absolute http/https URL.
// Replaces the regex-based check from the original Shortener Worker.
export function checkURL(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
