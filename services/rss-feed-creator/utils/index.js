// /services/rss-feed-creator/index.js
import { ensureR2Sources } from "./rss-bootstrap.js";
import { endToEndRewrite } from "../rewrite-pipeline.js";
import { log } from "../../../logger.js";

export async function startFeedCreator() {
  log.debug("rss.pipeline.start");

  // 1️⃣ Ensure feeds.txt + urls.txt are present in R2 before anything else
  await ensureR2Sources();

  // 2️⃣ Run rotation + rebuild
  return await endToEndRewrite();
}

export default startFeedCreator;
