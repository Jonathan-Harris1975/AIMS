// Validate the immutable RSS show-cover master from the trusted R2 bucket.
// Podcast directories require an opaque square RGB cover at least 1400px wide.
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function validatePodcastShowCoverPng(data) {
  const image = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
  if (image.length < 33 || !image.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Podcast show cover must be a non-empty PNG image");
  }
  if (image.toString("ascii", 12, 16) !== "IHDR" || image.readUInt32BE(8) !== 13) {
    throw new Error("Podcast show cover has no valid PNG IHDR");
  }
  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  const bitDepth = image[24];
  const colourType = image[25];
  if (width !== height || width < 1400 || width > 3000) {
    throw new Error(`Podcast show cover has invalid dimensions ${width}x${height}; expected 1400–3000px square`);
  }
  if (bitDepth !== 8 || colourType !== 2) {
    throw new Error("Podcast show cover must use 8-bit RGB with no alpha channel");
  }
  return { ok: true, width, height, format: "image/png", opaqueRgb: true };
}
