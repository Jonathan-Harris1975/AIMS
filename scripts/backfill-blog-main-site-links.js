#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { listObjects, getObjectAsText, putText } from "../services/shared/utils/r2-client.js";
import { rewriteLegacyBlogMainSiteLinks } from "../services/blog/utils/mainSiteLinks.js";

const BLOG_BUCKET_ALIAS = "blog";
const APPLY = process.argv.includes("--apply");
const NO_REBUILD = process.argv.includes("--no-rebuild");

function isPublishedBlogHtmlKey(key = "") {
  const value = String(key || "");
  return value.endsWith("/index.html") && value.includes("/posts/");
}

async function triggerWebsiteRebuild() {
  if (NO_REBUILD) return { attempted: false, reason: "disabled" };

  const hooks = [
    String(process.env.WEBSITE_REBUILD_HOOK || "").trim(),
    String(process.env.WEBSITE_REBUILD_HOOK_FALLBACK || "").trim(),
  ].filter(Boolean);

  if (!hooks.length) {
    return { attempted: false, reason: "no-hook-configured" };
  }

  let lastError = null;
  for (const hookUrl of hooks) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(hookUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source: "AIMS",
            action: "blog-link-backfill",
            timestamp: new Date().toISOString(),
          }),
          signal: AbortSignal.timeout(30_000),
        });

        if (response.ok) {
          return { attempted: true, ok: true, status: response.status };
        }

        lastError = new Error(`Website rebuild returned HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }

      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 1_000 * (2 ** (attempt - 1))));
      }
    }
  }

  throw lastError || new Error("Website rebuild failed.");
}

export async function backfillBlogMainSiteLinks({
  apply = APPLY,
  baseUrl = process.env.SITE_BASE_URL || "https://jonathan-harris.online",
} = {}) {
  const objects = await listObjects(BLOG_BUCKET_ALIAS);
  const htmlObjects = objects.filter((item) => isPublishedBlogHtmlKey(item?.key));

  const result = {
    mode: apply ? "apply" : "dry-run",
    scanned: htmlObjects.length,
    changedObjects: 0,
    replacements: 0,
    changedKeys: [],
  };

  for (const item of htmlObjects) {
    const key = item.key;
    const html = await getObjectAsText(BLOG_BUCKET_ALIAS, key);
    const repaired = rewriteLegacyBlogMainSiteLinks(html, { baseUrl });

    if (!repaired.changed) continue;

    result.changedObjects += 1;
    result.replacements += repaired.replacements;
    result.changedKeys.push(key);

    if (apply) {
      await putText(BLOG_BUCKET_ALIAS, key, repaired.html, "text/html; charset=utf-8");
    }
  }

  return result;
}

async function main() {
  const result = await backfillBlogMainSiteLinks();

  console.log(JSON.stringify(result, null, 2));

  if (!APPLY) {
    console.log("\nDry run only. Re-run with --apply to update the listed R2 blog HTML objects.");
    return;
  }

  if (!result.changedObjects) {
    console.log("\nNo legacy blog links required repair. No rebuild triggered.");
    return;
  }

  const rebuild = await triggerWebsiteRebuild();
  console.log("\nWebsite rebuild:", JSON.stringify(rebuild));
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsScript) {
  main().catch((error) => {
    console.error("blog-link-backfill.failed", error);
    process.exitCode = 1;
  });
}
