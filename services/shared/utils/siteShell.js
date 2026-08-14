import crypto from "node:crypto";

const DEFAULT_SITE_BASE_URL = "https://jonathan-harris.online";
const DEFAULT_MANIFEST_URL = `${DEFAULT_SITE_BASE_URL}/assets/site-shell/manifest.json`;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_RETRIES = 3;
const LAST_KNOWN_GOOD_KEY = "site-shell/last-known-good.json";

async function logInfo(event, payload) {
  try {
    const { info } = await import("../../../logger.js");
    info(event, payload);
  } catch {}
}

async function logWarn(event, payload) {
  try {
    const { warn } = await import("../../../logger.js");
    warn(event, payload);
  } catch {}
}

let memoryShell = null;

function normaliseUrl(value) {
  return String(value || "").trim();
}

function allowedHosts() {
  const configured = String(process.env.SITE_SHELL_ALLOWED_HOSTS || "jonathan-harris.online")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return new Set(configured);
}

function assertAllowedHttpsUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${label} must use HTTPS`);
  if (!allowedHosts().has(parsed.hostname.toLowerCase())) {
    throw new Error(`${label} host '${parsed.hostname}' is not permitted`);
  }
  return parsed.toString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

async function fetchText(url, { timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "text/html,application/json;q=0.9,*/*;q=0.5", "Cache-Control": "no-cache" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error(`Failed to fetch ${url}`);
}

function validateManifest(manifest, expectedReleaseSha = "") {
  if (!manifest || Number(manifest.schemaVersion) !== 1) throw new Error("Unsupported site-shell manifest schema");
  const releaseSha = String(manifest.releaseSha || "").trim();
  if (!releaseSha) throw new Error("Site-shell manifest is missing releaseSha");
  if (expectedReleaseSha && releaseSha !== expectedReleaseSha) {
    throw new Error(`Site-shell release mismatch: expected ${expectedReleaseSha}, received ${releaseSha}`);
  }
  for (const key of ["headerUrl", "footerUrl", "stylesheetUrl", "siteUiScriptUrl"]) {
    assertAllowedHttpsUrl(manifest[key], `site-shell ${key}`);
  }
  for (const key of ["headerSha256", "footerSha256"]) {
    if (!/^[a-f0-9]{64}$/i.test(String(manifest[key] || ""))) throw new Error(`Invalid ${key}`);
  }
  return releaseSha;
}

async function persistLastKnownGood(shell) {
  try {
    const { putPrivateJson } = await import("./r2-client.js");
    await putPrivateJson("metasystem", LAST_KNOWN_GOOD_KEY, shell);
  } catch (error) {
    await logWarn("siteShell.cache.persistFailed", { error: error?.message || String(error) });
  }
}

async function loadPersistedLastKnownGood() {
  try {
    const { getObjectAsText } = await import("./r2-client.js");
    const raw = await getObjectAsText("metasystem", LAST_KNOWN_GOOD_KEY);
    const parsed = JSON.parse(raw);
    validateManifest(parsed?.manifest || {});
    if (!parsed?.headerHtml || !parsed?.footerHtml) throw new Error("Persisted shell is incomplete");
    return parsed;
  } catch {
    return null;
  }
}

export async function loadSiteShell({ manifestUrl, expectedReleaseSha = "", forceRefresh = false, allowLastKnownGood = true } = {}) {
  const requestedManifestUrl = assertAllowedHttpsUrl(
    normaliseUrl(manifestUrl || process.env.SITE_SHELL_MANIFEST_URL || DEFAULT_MANIFEST_URL),
    "site-shell manifest URL",
  );

  if (!forceRefresh && memoryShell && (!expectedReleaseSha || memoryShell.manifest.releaseSha === expectedReleaseSha)) {
    return memoryShell;
  }

  try {
    const manifestRaw = await fetchText(requestedManifestUrl);
    const manifest = JSON.parse(manifestRaw);
    const releaseSha = validateManifest(manifest, expectedReleaseSha);
    const [headerHtml, footerHtml] = await Promise.all([
      fetchText(manifest.headerUrl),
      fetchText(manifest.footerUrl),
    ]);
    if (sha256(headerHtml) !== String(manifest.headerSha256).toLowerCase()) throw new Error("Site-shell header checksum mismatch");
    if (sha256(footerHtml) !== String(manifest.footerSha256).toLowerCase()) throw new Error("Site-shell footer checksum mismatch");

    const shell = { manifest: { ...manifest, releaseSha }, headerHtml, footerHtml };
    memoryShell = shell;
    await persistLastKnownGood(shell);
    await logInfo("siteShell.loaded", { releaseSha, manifestUrl: requestedManifestUrl });
    return shell;
  } catch (error) {
    if (!allowLastKnownGood || expectedReleaseSha) throw error;
    const fallback = memoryShell || await loadPersistedLastKnownGood();
    if (!fallback) throw error;
    await logWarn("siteShell.usingLastKnownGood", {
      releaseSha: fallback.manifest.releaseSha,
      error: error?.message || String(error),
    });
    memoryShell = fallback;
    return fallback;
  }
}

function replaceOrInsertMeta(html, releaseSha) {
  const tag = `<meta name="jh-site-shell-version" content="${releaseSha}"/>`;
  if (/<meta\s+name=["']jh-site-shell-version["'][^>]*>/i.test(html)) {
    return html.replace(/<meta\s+name=["']jh-site-shell-version["'][^>]*>/i, tag);
  }
  return html.replace(/<\/head>/i, `${tag}\n</head>`);
}

function ensureStylesheet(html, url) {
  const cleaned = html.replace(/\s*<link\b[^>]*href=["']https:\/\/jonathan-harris\.online\/assets\/css\/site\.css[^"']*["'][^>]*>\s*/ig, "\n");
  return cleaned.replace(/<\/head>/i, `<link href="${url}" rel="stylesheet"/>\n</head>`);
}

function ensureSiteUiScript(html, url) {
  const cleaned = html.replace(/\s*<script\b[^>]*src=["']https:\/\/jonathan-harris\.online\/assets\/js\/site-ui\.min\.js[^"']*["'][^>]*><\/script>\s*/ig, "\n");
  return cleaned.replace(/<\/body>/i, `<script defer src="${url}"></script>\n</body>`);
}

function replaceHeader(html, headerHtml) {
  const marker = /<!--\s*JH_SITE_SHELL_HEADER_START[\s\S]*?<!--\s*JH_SITE_SHELL_HEADER_END\s*-->/i;
  if (marker.test(html)) return html.replace(marker, headerHtml.trim());

  const withSkip = /<a\b[^>]*class=["'][^"']*skip-link[^"']*["'][^>]*>[\s\S]*?<\/a>\s*<header\b[^>]*(?:id=["']site-primary-nav["']|class=["'][^"']*jh-header[^"']*["'])[^>]*>[\s\S]*?<\/header>/i;
  if (withSkip.test(html)) return html.replace(withSkip, headerHtml.trim());

  const headerOnly = /<header\b[^>]*(?:id=["']site-primary-nav["']|class=["'][^"']*jh-header[^"']*["'])[^>]*>[\s\S]*?<\/header>/i;
  if (headerOnly.test(html)) return html.replace(headerOnly, headerHtml.trim());

  return html.replace(/<body\b[^>]*>/i, (match) => `${match}\n${headerHtml.trim()}`);
}

function replaceFooter(html, footerHtml) {
  const marker = /<!--\s*JH_SITE_SHELL_FOOTER_START[\s\S]*?<!--\s*JH_SITE_SHELL_FOOTER_END\s*-->/i;
  if (marker.test(html)) return html.replace(marker, footerHtml.trim());

  const footer = /<footer\b[^>]*class=["'][^"']*site-footer[^"']*["'][^>]*>[\s\S]*?<\/footer>/i;
  if (footer.test(html)) return html.replace(footer, footerHtml.trim());

  return html.replace(/<\/body>/i, `${footerHtml.trim()}\n</body>`);
}

export function applySiteShellToHtml(html, shell) {
  if (!shell?.manifest?.releaseSha || !shell?.headerHtml || !shell?.footerHtml) {
    throw new Error("A complete site shell is required");
  }
  let output = String(html || "");
  output = replaceHeader(output, shell.headerHtml);
  output = replaceFooter(output, shell.footerHtml);
  output = replaceOrInsertMeta(output, shell.manifest.releaseSha);
  output = ensureStylesheet(output, shell.manifest.stylesheetUrl);
  output = ensureSiteUiScript(output, shell.manifest.siteUiScriptUrl);
  return output;
}

export function getSiteShellReleaseSha(shell) {
  return String(shell?.manifest?.releaseSha || "");
}

export const SITE_SHELL_DEFAULT_MANIFEST_URL = DEFAULT_MANIFEST_URL;

export default { loadSiteShell, applySiteShellToHtml, getSiteShellReleaseSha };
