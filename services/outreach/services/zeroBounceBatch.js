// services/outreach/services/zeroBounceBatch.js

import axios from "axios";
import { wait } from "../../shared/utils/wait.js";

const ZERO_BASE = "https://api.zerobounce.net/v2";

function positiveIntEnv(name, fallback, max = Number.POSITIVE_INFINITY) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

// Current ZeroBounce rate-limit guidance caps real-time validatebatch requests at 100 addresses.
const BATCH_SIZE = positiveIntEnv("ZEROBOUNCE_BATCH_SIZE", 25, 100);
// ZeroBounce documents that validatebatch can take up to ~70 seconds.
const ZEROBOUNCE_TIMEOUT_MS = positiveIntEnv("ZEROBOUNCE_TIMEOUT_MS", 75_000, 120_000);
const ZEROBOUNCE_DELAY_MS = Number(process.env.ZEROBOUNCE_DELAY_MS ?? process.env.HUNTER_DELAY_MS) || 0;

function getZeroBounceApiKey() {
  return process.env.API_ZERO_KEY || process.env.ZEROBOUNCE_API_KEY || "";
}

export async function batchValidateEmails(emails = []) {
  const resultMap = new Map();
  const apiKey = getZeroBounceApiKey();

  const clean = [...new Set(emails)].filter(
    (e) => typeof e === "string" && e.includes("@")
  );

  if (!apiKey) {
    clean.forEach((e) =>
      resultMap.set(e, { status: "unknown", sub_status: "not_checked" })
    );
    return resultMap;
  }

  for (let i = 0; i < clean.length; i += BATCH_SIZE) {
    const batch = clean.slice(i, i + BATCH_SIZE);

    try {
      const res = await axios.post(
        `${ZERO_BASE}/validatebatch`,
        {
          api_key: apiKey,
          email_batch: batch.map((email) => ({ email_address: email })),
          timeout: Math.max(10, Math.min(65, Math.floor(ZEROBOUNCE_TIMEOUT_MS / 1000) - 5)),
        },
        { timeout: ZEROBOUNCE_TIMEOUT_MS }
      );

      res.data?.email_batch?.forEach((item) => {
        const address = String(item?.address || item?.email_address || "").trim().toLowerCase();
        if (!address) return;
        resultMap.set(address, {
          status: item.status,
          sub_status: item.sub_status,
        });
      });

      const errors = Array.isArray(res.data?.errors) ? res.data.errors : [];
      const globalError = errors.find((item) => String(item?.email_address || "").toLowerCase() === "all");
      for (const email of batch) {
        if (resultMap.has(email)) continue;
        const specific = errors.find((item) => String(item?.email_address || "").toLowerCase() === email);
        resultMap.set(email, {
          status: "unknown",
          sub_status: specific?.error || globalError?.error || "not_returned",
        });
      }
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
