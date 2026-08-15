// verifyPodcastEpisode.js
// Usage: node verifyPodcastEpisode.js TT-2025-11-23

import "./config/loadEnv.js";
import { getObjectAsText, buildR2Reference } from "./services/shared/utils/r2-client.js";

const sessionId = process.argv[2];

if (!sessionId) {
  console.error("Usage: node verifyPodcastEpisode.js <sessionId>");
  process.exit(1);
}

async function head(url) {
  const res = await fetch(url, { method: "HEAD" });
  return { ok: res.ok, status: res.status };
}

(async () => {
  console.log("🔎 Verifying episode", sessionId);
  const metaKey = `${sessionId}.json`;
  const metaRef = buildR2Reference("meta", metaKey);
  console.log("📘 Meta object:", metaRef);

  let meta;
  try {
    meta = JSON.parse(await getObjectAsText("meta", metaKey));
  } catch (err) {
    console.error("❌ Authenticated meta read failed:", err?.message || String(err));
    process.exit(1);
  }
  console.log("✅ Meta loaded. Title:", meta.title || "(none)");

  const urls = {
    podcastUrl: meta.podcastUrl,
    artUrl: meta.artUrl,
    transcriptUrl: meta.transcriptUrl,
  };

  for (const [label, url] of Object.entries(urls)) {
    if (!url) {
      console.warn(`⚠️ ${label} missing`);
      continue;
    }
    try {
      const res = await head(url);
      if (res.ok) {
        console.log(`✅ ${label} reachable (${res.status}) —`, url);
      } else {
        console.error(`❌ ${label} HEAD failed (${res.status}) —`, url);
      }
    } catch (err) {
      console.error(`❌ ${label} HEAD error:`, err.message);
    }
  }

  if (typeof meta.fileSize === "number") console.log("📦 fileSize:", meta.fileSize, "bytes");
  if (typeof meta.duration === "number") console.log("⏱ duration:", meta.duration.toFixed(1), "seconds");

  console.log("✅ Verification complete");
})().catch((err) => {
  console.error("❌ Verification error:", err);
  process.exit(1);
});
