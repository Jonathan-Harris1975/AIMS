// services/artwork/routes/createArtwork.js
import express from "express";
import { putJson } from "../../shared/utils/r2-client.js";
import { hookdeckDedupe } from "../../shared/utils/hookdeckDedupe.js";
import {
  validateBody,
  artworkCreateBodySchema,
} from "../../shared/utils/requestSchemas.js";
import { error, debug } from "../../../logger.js";

const router = express.Router();

router.post("/", hookdeckDedupe("artwork:create"), async (req, res) => {
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
    error("artwork.create.fail", { message: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
