// ============================================================
// 🧠 AI Podcast Suite — Temporary Storage Check
// ============================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { log } from "../logger.js";

const TEMP_DIR = path.resolve(process.env.APP_TMP_DIR || path.join(os.tmpdir(), "ai-management-suite"));

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  log.debug("temp.dir.created", { TEMP_DIR });
}

log.info("💽 temp.dir.verified");
log.debug("temp.dir.verified", { TEMP_DIR });
