// services/artwork/routes/createArtwork.js
import express from "express";
import { putJson } from "../../shared/utils/r2-client.js";
import { requestDedupe } from "../../shared/utils/requestDedupe.js";
import {
  validateBody,
  artworkCreateBodySchema,
} from "../../shared/utils/requestSchemas.js";
import { error, debug } from "../../../logger.js";

const router = express.Router();

function sendRouteError(req, res, err, fallbackMessage = "Internal error") {
  const requestId = req?.id || req?.headers?.["x-request-id"] || null;
  return res.status(500).json({ ok: false, error: fallbackMessage, requestId });
}

router.post("/", requestDedupe("artwork:create"), async (req, res) => {
  try {
    const parsed = validateBody(artworkCreateBodySchema, req.body);
    if (!parsed.ok) {
      return res.status(400).json({ ok: false, error: parsed.error });
    }

    const payload = parsed.data;
    const bucket = "art";
    const key = `artwork/requests/${Date.now()}.json`;
    await putJson(bucket, key, payload);
    debug("artwork.create.stored", { bucket, key });

    res.json({ ok: true, bucket, key });
  } catch (err) {
    error("artwork.create.fail", {
      requestId: req?.id || req?.headers?.["x-request-id"] || null,
      error: err?.stack || err?.message || String(err),
    });
    return sendRouteError(req, res, err, "Artwork request storage failed");
  }
});

export default router;
