import { listObjects, getObjectAsText } from "../../services/shared/utils/r2-client.js";

// The main website audit delegates /blog to AIMS. Read the actual owned
// published pages here rather than attempting editorial scoring from analytics.
export async function collectMonthlyPublishedContent({ now = new Date(), storage = { listObjects, getObjectAsText } } = {}) {
  const start = new Date(now.getTime() - 31 * 86400000);
  const items = [];
  const errors = [];
  try {
    const objects = await storage.listObjects("blog", "");
    const candidates = objects.filter(row => /\/index\.html$/.test(row.key || row.Key || "") &&
      Date.parse(row.lastModified || row.LastModified || "") >= start.getTime() &&
      Date.parse(row.lastModified || row.LastModified || "") <= now.getTime());
    for (const row of candidates) {
      const key = row.key || row.Key;
      try {
        const html = await storage.getObjectAsText("blog", key);
        const content = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
          .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        items.push({ key, lastModified: row.lastModified || row.LastModified, content,
          links: [...html.matchAll(/href=["']([^"']+)["']/gi)].map(match => match[1]) });
      } catch (error) { errors.push(`${key}: ${error.message}`); }
    }
  } catch (error) { errors.push(error.message); }
  return { status: items.length && !errors.length ? "complete" : "partial", window: {start: start.toISOString(), end: now.toISOString()},
    itemsInspected: items.length, items, errors,
    limitations: ["R2 LastModified defines the scan window; this is not proof of publication date.",
      ...(!items.length ? ["No published blog HTML could be inspected in the monthly window."] : []),
      "HTML/text inspection does not verify rendered imagery, audio quality or video pacing."] };
}
