import fs from "node:fs";
import { kdpCatalogueConfiguration } from "./catalogue.js";

function present(value) {
  const normalized = String(value || "").trim();
  return Boolean(normalized && !/^\{\{\s*secret\.[^}]+\}\}$/i.test(normalized));
}

export function getKdpReadiness(env = process.env) {
  const chromiumPath = env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || env.CHROMIUM_PATH || "/usr/bin/chromium";
  const catalogue = kdpCatalogueConfiguration();
  const checks = [
    { name: "KDP_USERNAME", ok: present(env.KDP_USERNAME) },
    { name: "KDP_PASSWORD", ok: present(env.KDP_PASSWORD) },
    { name: "KDP_OTP_ALLOWED_SENDERS", ok: present(env.KDP_OTP_ALLOWED_SENDERS) },
    { name: "D1_API_KEY", ok: present(env.D1_API_KEY) },
    { name: "KDP_D1_DATABASE_ID", ok: catalogue.configured },
    { name: "R2_ENDPOINT", ok: present(env.R2_ENDPOINT || env.R2_ENDPOINT_URL) },
    { name: "R2_ACCESS_KEY_ID", ok: present(env.R2_ACCESS_KEY_ID) },
    { name: "R2_SECRET_ACCESS_KEY", ok: present(env.R2_SECRET_ACCESS_KEY) },
    { name: "R2_BUCKET_KDP", ok: present(env.R2_BUCKET_KDP || "kdp") },
    { name: "Chromium", ok: fs.existsSync(chromiumPath) },
  ];
  return {
    ready: checks.every((check) => check.ok),
    checks,
    loginConfigured: checks.slice(0, 3).every((check) => check.ok),
    catalogueConfigured: checks.slice(3, 5).every((check) => check.ok),
    manuscriptStorageConfigured: checks.slice(5, 9).every((check) => check.ok),
    browserConfigured: checks[9].ok,
  };
}

export default { getKdpReadiness };
