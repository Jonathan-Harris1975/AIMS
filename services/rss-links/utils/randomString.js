// services/rss-links/utils/randomString.js
// Generates a random short key using an unambiguous character set.
// Mirrors the original Shortener logic — omits easily-confused chars (0, O, l, I, etc.).
const CHARS = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";

export function randomString(len = 6) {
  let result = "";
  for (let i = 0; i < len; i++) {
    result += CHARS.charAt(Math.floor(Math.random() * CHARS.length));
  }
  return result;
}
