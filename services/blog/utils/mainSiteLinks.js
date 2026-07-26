// services/blog/utils/mainSiteLinks.js

const DEFAULT_SITE_BASE_URL = "https://jonathan-harris.online";

const MAIN_SITE_PATH_PREFIXES = Object.freeze([
  "/ebooks/",
  "/podcast/",
  "/newsletter/",
  "/topics/",
  "/bio/",
  "/blog/",
  "/glossary/",
  "/compare/",
  "/contact/",
  "/catalogue/",
  "/privacy-policy/",
  "/terms-of-use/",
]);

export function normaliseMainSiteBaseUrl(value = process.env.SITE_BASE_URL || DEFAULT_SITE_BASE_URL) {
  return String(value || DEFAULT_SITE_BASE_URL).trim().replace(/\/+$/, "") || DEFAULT_SITE_BASE_URL;
}

export function mainSiteUrl(path = "/", baseUrl = process.env.SITE_BASE_URL || DEFAULT_SITE_BASE_URL) {
  const base = normaliseMainSiteBaseUrl(baseUrl);
  const rawPath = String(path || "/").trim() || "/";
  const safePath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  return `${base}${safePath}`;
}

export function isMainSiteRootRelativeHref(href = "") {
  const value = String(href || "").trim();
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (value === "/") return true;
  return MAIN_SITE_PATH_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export function rewriteLegacyBlogMainSiteLinks(
  html = "",
  { baseUrl = process.env.SITE_BASE_URL || DEFAULT_SITE_BASE_URL } = {},
) {
  const source = String(html || "");
  if (!source) {
    return { html: source, changed: false, replacements: 0 };
  }

  let replacements = 0;
  const rewritten = source.replace(
    /\bhref=(["'])(\/(?!\/)[^"'#?]*?(?:[?#][^"']*)?)\1/gi,
    (match, quote, href) => {
      if (!isMainSiteRootRelativeHref(href)) return match;
      replacements += 1;
      return `href=${quote}${mainSiteUrl(href, baseUrl)}${quote}`;
    },
  );

  return {
    html: rewritten,
    changed: replacements > 0,
    replacements,
  };
}

export { DEFAULT_SITE_BASE_URL, MAIN_SITE_PATH_PREFIXES };
