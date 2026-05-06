// services/outreach/services/zeroBounceBatch.js

import axios from "axios";
import { wait } from "../../shared/utils/wait.js";

const ZERO_BASE = "https://api.zerobounce.net/v2";

function positiveIntEnv(name, fallback, max = Number.POSITIVE_INFINITY) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

const BATCH_SIZE = positiveIntEnv("ZEROBOUNCE_BATCH_SIZE", 25, 50);
const ZEROBOUNCE_TIMEOUT_MS = positiveIntEnv("ZEROBOUNCE_TIMEOUT_MS", 30_000, 120_000);
const ZEROBOUNCE_DELAY_MS = Number(process.env.ZEROBOUNCE_DELAY_MS ?? process.env.HUNTER_DELAY_MS) || 0;

export async function batchValidateEmails(emails = []) {
  const resultMap = new Map();

  const clean = [...new Set(emails)].filter(
    (e) => typeof e === "string" && e.includes("@")
  );

  if (!process.env.API_ZERO_KEY) {
    clean.forEach((e) =>
      resultMap.set(e, { status: "unknown", sub_status: "not_checked" })
    );
    return resultMap;
  }

  for (let i = 0; i < clean.length; i += BATCH_SIZE) {
    const batch = clean.slice(i, i + BATCH_SIZE);

    try {
      const res = await axios.post(
        `${ZERO_BASE}/batch-validate`,
        {
          api_key: process.env.API_ZERO_KEY,
          email_batch: batch.map((email) => ({ email_address: email })),
        },
        { timeout: ZEROBOUNCE_TIMEOUT_MS }
      );

      res.data?.email_batch?.forEach((item) => {
        resultMap.set(item.email_address, {
          status: item.status,
          sub_status: item.sub_status,
        });
      });
    } catch {
      batch.forEach((email) =>
        resultMap.set(email, {
          status: "unknown",
          sub_status: "batch_failed",
        })
      );
    }

    if (i + BATCH_SIZE < clean.length) {
      await wait(ZEROBOUNCE_DELAY_MS);
    }
  }

  return resultMap;
}
