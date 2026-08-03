function stripDataUrl(value = "") {
  const text = String(value || "").trim();
  const match = text.match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,(.+)$/is);
  return {
    base64: match ? match[2].replace(/\s+/g, "") : text.replace(/\s+/g, ""),
    declaredMimeType: match ? normaliseMimeType(match[1]) : null,
  };
}

function normaliseMimeType(value = "") {
  const mime = String(value || "").trim().toLowerCase();
  return mime === "image/jpg" ? "image/jpeg" : mime || null;
}

export function detectImageFormat(input) {
  const source = Buffer.isBuffer(input)
    ? { buffer: input, declaredMimeType: null, base64: input.toString("base64") }
    : (() => {
        const stripped = stripDataUrl(input);
        return {
          ...stripped,
          buffer: Buffer.from(stripped.base64 || "", "base64"),
        };
      })();

  const { buffer } = source;
  let mimeType = null;
  let extension = null;

  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    mimeType = "image/png";
    extension = "png";
  } else if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    mimeType = "image/jpeg";
    extension = "jpg";
  } else if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    mimeType = "image/webp";
    extension = "webp";
  } else if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) {
    mimeType = "image/gif";
    extension = "gif";
  }

  const declaredMimeType = normaliseMimeType(source.declaredMimeType);
  if (!mimeType && declaredMimeType) {
    mimeType = declaredMimeType;
    extension = mimeType === "image/jpeg" ? "jpg" : mimeType.replace(/^image\//, "");
  }

  if (!mimeType) {
    mimeType = "image/png";
    extension = "png";
  }

  return {
    base64: source.base64,
    buffer,
    mimeType,
    extension,
    declaredMimeType,
  };
}

export default { detectImageFormat };
