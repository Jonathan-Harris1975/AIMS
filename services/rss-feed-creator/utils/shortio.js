import { fetchWithTimeout } from "../../shared/http-client.js";

const API_KEY = process.env.SHORTIO_API_KEY;
const DOMAIN = process.env.SHORTIO_DOMAIN;
const SHORTIO_TIMEOUT_MS = Number(process.env.SHORTIO_TIMEOUT_MS) || 8000;

export async function shortenUrl(originalURL) {
  if (!API_KEY || !DOMAIN || !originalURL) return originalURL;

  try {
    const res = await fetchWithTimeout("https://api.short.io/links", {
      method: "POST",
      headers: { Authorization: API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ domain: DOMAIN, originalURL }),
      timeout: SHORTIO_TIMEOUT_MS,
    });

    if (!res.ok) return originalURL;
    const data = await res.json().catch(() => ({}));
    return data?.shortURL || originalURL;
  } catch {
    return originalURL;
  }
}
