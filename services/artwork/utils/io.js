// services/artwork/utils/io.js
import { putObject, putJson } from "../../shared/utils/r2-client.js";
import { info, error } from "../../../logger.js";

const ART_BUCKET = "art";
const META_BUCKET = "meta";
const ART_PUBLIC = process.env.R2_PUBLIC_BASE_URL_ART;

function requireEnv(name, val) {
  if (!val) throw new Error(`Missing required env: ${name}`);
  return val;
}

export async function saveArtworkPng(pngBuffer, key, meta = null) {
  requireEnv("R2_BUCKET_ART", process.env.R2_BUCKET_ART);
  const publicBase = requireEnv("R2_PUBLIC_BASE_URL_ART", ART_PUBLIC);

  if (!pngBuffer || !key) throw new Error("saveArtworkPng requires both pngBuffer and key");

  try {
    await putObject(ART_BUCKET, key, pngBuffer, "image/png");
    info("artwork.r2.put", { bucket: ART_BUCKET, key, bytes: pngBuffer.length });

    if (meta && process.env.R2_BUCKET_META) {
      const metaKey = key.replace(/\.png$/i, ".json");
      await putJson(META_BUCKET, metaKey, meta);
      info("artwork.r2.meta.put", { bucket: META_BUCKET, key: metaKey });
    }

    return `${publicBase.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
  } catch (err) {
    error("artwork.r2.upload.fail", { message: err.message, bucket: ART_BUCKET, key });
    throw err;
  }
}
