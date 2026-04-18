// services/artwork/index.js
import express from "express";
import routes from "./routes/index.js";
import { createPodcastArtwork } from "./createPodcastArtwork.js";

const router = express.Router();
// mount all artwork subroutes at root: /artwork/*
router.use("/", routes);

function normaliseArtworkInput(input, maybeOptions = {}) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return { ...input, ...maybeOptions };
  }

  const sessionId = typeof input === "string" ? input : undefined;
  return {
    ...(maybeOptions || {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

export async function processArtwork(input, maybeOptions = {}) {
  return createPodcastArtwork(normaliseArtworkInput(input, maybeOptions));
}

export { createPodcastArtwork };
export default router;
