// services/artwork/utils/openrouterImageCapabilities.js
//
// OpenRouter image parameters vary by model and endpoint. Discover and cache
// the current capability map so AIMS never sends provider knobs that the
// selected model cannot accept.

import { fetchWithTimeout } from "../../shared/http-client.js";
import { warn } from "../../../logger.js";
import { getArtworkModelFamily } from "./artworkModelPrompt.js";

const CACHE = new Map();
const DEFAULT_CACHE_MS = 6 * 60 * 60 * 1000;
const CORE_FIELDS = new Set(["model", "prompt"]);

function parseBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function cacheMs() {
  const value = Number(process.env.ARTWORK_CAPABILITY_CACHE_MS || DEFAULT_CACHE_MS);
  return Number.isFinite(value) && value >= 60_000 ? value : DEFAULT_CACHE_MS;
}

function staticCapabilities(model = "") {
  const family = getArtworkModelFamily(model);
  if (family === "seedream") {
    return new Set(["aspect_ratio", "resolution", "n", "input_references", "seed"]);
  }
  if (family === "flux") {
    return new Set(["output_format", "n", "input_references", "seed"]);
  }
  return null;
}

function modelEndpointUrl(baseUrl, model) {
  const [author, ...slugParts] = String(model || "").split("/").filter(Boolean);
  const slug = slugParts.join("/");
  if (!author || !slug) return "";
  return `${String(baseUrl || "").replace(/\/+$/, "")}/images/models/${encodeURIComponent(author)}/${slug.split("/").map(encodeURIComponent).join("/")}/endpoints`;
}

function collectSupportedParameters(payload = {}) {
  const supported = new Set();
  for (const endpoint of Array.isArray(payload?.endpoints) ? payload.endpoints : []) {
    const parameters = endpoint?.supported_parameters;
    if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) continue;
    for (const name of Object.keys(parameters)) supported.add(name);
  }
  return supported.size ? supported : null;
}

export async function getImageSupportedParameters({ baseUrl, model, apiKey, headers = {}, signal } = {}) {
  const fallback = staticCapabilities(model);
  if (!parseBoolean(process.env.ARTWORK_CAPABILITY_DISCOVERY_ENABLED, true)) return fallback;

  const cacheKey = `${String(baseUrl || "").replace(/\/+$/, "")}|${model}`;
  const cached = CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const url = modelEndpointUrl(baseUrl, model);
  if (!url) return fallback;

  try {
    const response = await fetchWithTimeout(url, {
      method: "GET",
      timeout: Math.max(3_000, Number(process.env.ARTWORK_CAPABILITY_TIMEOUT_MS || 10_000)),
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        accept: "application/json",
        ...headers,
      },
    });
    if (!response.ok) throw new Error(`OpenRouter image capability lookup returned ${response.status}`);
    const payload = await response.json();
    const supported = collectSupportedParameters(payload) || fallback;
    CACHE.set(cacheKey, { value: supported, expiresAt: Date.now() + cacheMs() });
    return supported;
  } catch (error) {
    warn("artwork.openrouter.capability_lookup_failed", {
      model,
      error: error?.message || String(error),
      usingStaticCapabilities: Boolean(fallback),
    });
    CACHE.set(cacheKey, { value: fallback, expiresAt: Date.now() + Math.min(cacheMs(), 15 * 60_000) });
    return fallback;
  }
}

export function filterImagePayloadByCapabilities(payload = {}, supportedParameters) {
  if (!(supportedParameters instanceof Set) || supportedParameters.size === 0) return { ...payload };

  return Object.fromEntries(Object.entries(payload).filter(([key]) => (
    CORE_FIELDS.has(key) || supportedParameters.has(key)
  )));
}

export function clearImageCapabilityCache() {
  CACHE.clear();
}

export default { getImageSupportedParameters, filterImagePayloadByCapabilities, clearImageCapabilityCache };
