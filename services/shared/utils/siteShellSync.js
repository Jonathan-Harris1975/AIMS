import { getObjectAsText, listKeys, uploadText, putPrivateJson } from "./r2-client.js";
import { loadSiteShell, applySiteShellToHtml } from "./siteShell.js";
import { info, warn } from "../../../logger.js";

const SYNC_STATE_KEY = "site-shell/sync-state.json";

export function isManagedSiteShellHtmlKey(bucketKey, key) {
  const value = String(key || "").toLowerCase();
  if (!value.endsWith(".html")) return false;
  if (bucketKey === "transcript") return true;
  if (bucketKey === "blog") {
    if (value.endsWith("/email.html")) return false;
    return true;
  }
  return false;
}


function prepareLegacyNewsletterArchive(html, key) {
  if (!String(key || "").toLowerCase().startsWith("newsletter/")) return html;
  if (/\bid=["']main["']/i.test(html)) return html;
  return String(html).replace(/<body\b([^>]*)>([\s\S]*?)<\/body>/i, (_match, attrs, body) =>
    `<body${attrs}>\n<main id="main" role="main" class="main"><div class="wrap">${body}</div></main>\n</body>`
  );
}

async function syncBucket(bucketKey, shell, { dryRun = false } = {}) {
  const keys = (await listKeys(bucketKey, "")).filter((key) => isManagedSiteShellHtmlKey(bucketKey, key));
  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  const failures = [];

  for (const key of keys) {
    try {
      const current = await getObjectAsText(bucketKey, key);
      const prepared = bucketKey === "blog" ? prepareLegacyNewsletterArchive(current, key) : current;
      const next = applySiteShellToHtml(prepared, shell);
      if (next === current) {
        unchanged += 1;
        continue;
      }
      if (!dryRun) {
        await uploadText(bucketKey, key, next, "text/html; charset=utf-8", {
          cacheControl: "public, max-age=300, must-revalidate",
        });
      }
      updated += 1;
    } catch (error) {
      failed += 1;
      failures.push({ key, error: error?.message || String(error) });
      warn("siteShell.sync.objectFailed", { bucketKey, key, error: error?.message || String(error) });
    }
  }

  return { bucketKey, scanned: keys.length, updated, unchanged, failed, failures: failures.slice(0, 25) };
}

export async function syncPublishedSiteShell({ manifestUrl, releaseSha, dryRun = false } = {}) {
  const expectedReleaseSha = String(releaseSha || "").trim();
  if (!expectedReleaseSha) throw new Error("releaseSha is required for site-shell synchronisation");
  const shell = await loadSiteShell({
    manifestUrl,
    expectedReleaseSha,
    forceRefresh: true,
    allowLastKnownGood: false,
  });

  const [blog, transcripts] = await Promise.all([
    syncBucket("blog", shell, { dryRun }),
    syncBucket("transcript", shell, { dryRun }),
  ]);
  const result = {
    ok: blog.failed === 0 && transcripts.failed === 0,
    releaseSha: shell.manifest.releaseSha,
    manifestUrl,
    dryRun: Boolean(dryRun),
    families: {
      blogAndBlogSocialAndNewsletterWeb: blog,
      transcripts,
    },
    completedAt: new Date().toISOString(),
  };

  if (!dryRun) {
    try {
      await putPrivateJson("metasystem", SYNC_STATE_KEY, result);
    } catch (error) {
      warn("siteShell.sync.statePersistFailed", { error: error?.message || String(error) });
    }
  }
  info("siteShell.sync.complete", result);
  return result;
}

export default { syncPublishedSiteShell, isManagedSiteShellHtmlKey };
