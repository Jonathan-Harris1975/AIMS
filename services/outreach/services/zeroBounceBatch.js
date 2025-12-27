// services/outreach/services/zeroBounceBatch.js

import axios from "axios";
import { ENV } from "../../../scripts/envBootstrap.js";
import { wait } from "../../shared/utils/wait.js";

const ZERO_BASE = "https://api.zerobounce.net/v2";
const BATCH_SIZE = 50; // unchanged

export async function batchValidateEmails(emails = []) {
  const resultMap = new Map();

  const clean = [...new Set(emails)].filter(
    (e) => typeof e === "string" && e.includes("@")
  );

  if (!ENV.API_ZERO_KEY) {
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
          api_key: ENV.API_ZERO_KEY,
          email_batch: batch.map((email) => ({ email_address: email })),
        },
        { timeout: 30000 }
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
      await wait(ENV.HUNTER_DELAY_MS);
    }
  }

  return resultMap;
        }
