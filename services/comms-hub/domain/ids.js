import { createHash, randomUUID } from "node:crypto";

const BASE32_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export function sha256Hex(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function base32(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

export function stableId(prefix, ...parts) {
  if (!/^[a-z][a-z0-9]{1,7}$/.test(String(prefix || ""))) {
    throw new TypeError("Stable ID prefix must be 2-8 lowercase alphanumeric characters beginning with a letter.");
  }
  const digest = createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("\u001f"))
    .digest();
  return `${prefix}_${base32(digest).slice(0, 26)}`;
}

export function newCorrelationId() {
  return randomUUID();
}
