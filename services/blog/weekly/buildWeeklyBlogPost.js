// services/blog/weekly/buildWeeklyBlogPost.js
import { info, error, debug } from "../../../logger.js";
import { getObjectAsText, putText, putJson, buildPublicUrl } from "../../shared/utils/r2-client.js";
import { resilientRequest } from "../../shared/utils/ai-service.js";
import { slugify } from "../utils/slug.js";
import { indexTemplate, pageTemplate, weeklyPostBody } from "../utils/templates.js";
import { createBlogArtwork } from "../../artwork/createBlogArtwork.js";

function isoWeekId(d = new Date()) {
  // ISO week: https://en.wikipedia.org/wiki/ISO_week_date
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  const yyyy = date.getUTCFullYear();
  return `${yyyy}-W${String(weekNo).padStart(2, "0")}`;
}

function parsePubDate(v) {
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : null;
}

function stripCdataHtml(html) {
  // rss-feed-creator stores rewritten text in CDATA inside description
  // We keep it readable; remove most tags but preserve basic spacing.
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toHtmlParagraphs(text) {
  const parts = String(text || "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n");
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function buildWeeklyBlogPost({ days = 7, weekId } = {}) {
  const prefix = process.env.BLOG_PREFIX || "blog";
  const rssBucketKey = "rss"; // newsletter RSS feed bucket alias (R2_BUCKET_RSS_FEEDS)
  const feedKey = "feed.json";
  const outBucketKey = "blog";

  const now = new Date();
  const cutoff = new Date(now.getTime() - Number(days) * 86400000);
  const week = weekId || isoWeekId(now);
  const sessionId = `BLOG-${week}`;

  try {
    info("blog.weekly.build.start", { days, week, rssBucketKey, feedKey });

    const raw = await getObjectAsText(rssBucketKey, feedKey);
    const feed = JSON.parse(raw);
    const channel = feed?.rss?.channel || {};
    const itemsRaw = channel?.item || [];
    const items = (Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw])
      .map((it) => {
        const pubDate = it?.pubDate;
        const d = parsePubDate(pubDate);
        const cdata = it?.description?.__cdata || "";
        return {
          title: String(it?.title || "Untitled"),
          link: String(it?.link || ""),
          pubDate: d,
          pubDateRaw: pubDate,
          rewritten: stripCdataHtml(cdata),
        };
      })
      .filter((it) => it.pubDate && it.pubDate >= cutoff)
      .sort((a, b) => b.pubDate - a.pubDate);

    if (!items.length) {
      return { ok: false, error: `No RSS items found in the last ${days} days.` };
    }

    const dateLabel = `${week} · last ${days} days`;
    const title = `AI Weekly Roundup — ${week}`;

    // ─────────────────────────────────────────
    // 1) Generate on-brand header artwork
    // ─────────────────────────────────────────
    const artPrompt = `Weekly blog header artwork for "Turing’s Torch AI Weekly".
Theme: the past week in AI news — sharp, modern, premium tech aesthetic.
Style: dark navy background, neon teal + muted purple accents, abstract AI circuitry / data glow.
No text, no logos, no people, no photorealistic faces.
Composition: wide header image suitable for a blog hero banner.`;

    const art = await createBlogArtwork({ sessionId, prompt: artPrompt });
    const imageUrl = art?.ok ? art.publicUrl : "";

    // ─────────────────────────────────────────
    // 2) Generate the weekly post body (HTML)
    // ─────────────────────────────────────────
    const sourcesForPrompt = items
      .slice(0, 18)
      .map(
        (it, idx) =>
          `${idx + 1}. ${it.title}\nSummary: ${it.rewritten}\nLink: ${it.link}`
      )
      .join("\n\n");

    const messages = [
      {
        role: "system",
        content:
          "You write for the blog of 'Turing’s Torch AI Weekly'. Voice: dry, sceptical British host energy; sharp, lightly sarcastic when deserved; zero corporate fluff. Output MUST be HTML only (no markdown). Use <h2>, <p>, <ul><li>. No inline styles.",
      },
      {
        role: "user",
        content:
          `Write a weekly AI news roundup blog post for ${week}.

Rules:
- Start with a short hook paragraph.
- Then 4–7 sections with <h2> headings.
- Each section should connect 2–5 related stories.
- Include practical "so what" takeaways.
- Avoid hype words/phrases (and close variants): groundbreaking, transformative, revolutionary, rapidly evolving, game-changer, paradigm shift, unprecedented, in a move that signals.
- No "In this post we explore" style filler.

Use these source summaries (do not quote them verbatim; rewrite in your own voice):

${sourcesForPrompt}
`,
      },
    ];

    let bodyHtml = await resilientRequest("blogWeekly", {
      sessionId,
      messages,
      max_tokens: 2600,
      temperature: 0.85,
    });

    bodyHtml = String(bodyHtml || "").trim();

    // Quick anti-fluff guard: if the model slips into press-release mode, regenerate once.
    const bannedPhrases = [
      "in a significant development",
      "in a move that",
      "rapidly evolving",
      "groundbreaking",
      "transformative",
      "revolutionary",
      "cutting-edge",
      "game-changer",
      "paradigm shift",
      "unprecedented",
      "delve into",
      "landscape",
      "underscores",
      "showcases",
      "notably",
      "this week we explore",
      "in this post",
    ];

    const hasFluff = bannedPhrases.some((p) => bodyHtml.toLowerCase().includes(p));
    if (hasFluff) {
      debug("blog.weekly.body.regen.fluffDetected", { week, matched: bannedPhrases.filter(p => bodyHtml.toLowerCase().includes(p)).slice(0, 5) });
      const regenMessages = [
        messages[0],
        {
          role: "user",
          content:
            `Rewrite the same weekly roundup again.

Hard rules:
- Remove ANY press-release/editorial filler.
- Do NOT use any of these phrases (or close variants): ${bannedPhrases.join(", ")}.
- Keep it tight and spoken, like a host writing a column.

Return HTML only.

Sources (same as before):
\n\n${sourcesForPrompt}`,
        },
      ];

      bodyHtml = await resilientRequest("blogWeekly", {
        sessionId,
        messages: regenMessages,
        max_tokens: 2600,
        temperature: 0.65,
      });
      bodyHtml = String(bodyHtml || "").trim();
    }

    if (!bodyHtml || !bodyHtml.includes("<p")) {
      // hard fallback: simple paragraphs from item summaries
      bodyHtml = `
<h2>What happened</h2>
${items.slice(0, 10).map((it) => `<p><strong>${escapeHtml(it.title)}:</strong> ${escapeHtml(it.rewritten)}</p>`).join("\n")}
<h2>The boring bit that matters</h2>
<p>If you’re seeing a pattern, that’s because there is one: tooling is maturing, governance is lagging, and the marketing departments are still doing lines of espresso.</p>
`;
    }

    // ─────────────────────────────────────────
    // 3) Write outputs to R2
    // ─────────────────────────────────────────
    const slug = slugify(`${week}-ai-weekly-roundup`);
    const dir = `${prefix}/${slug}`;

    const postUrl = buildPublicUrl(outBucketKey, `${dir}/index.html`);
    const postMetaUrl = buildPublicUrl(outBucketKey, `${dir}/post.json`);

    const contentHtml = weeklyPostBody({
      title,
      dateLabel,
      imageUrl,
      html: bodyHtml,
      sources: items.map((it) => ({ title: it.title, link: it.link })),
    });

    const fullHtml = pageTemplate({
      title,
      description: `Weekly AI roundup for ${week}.`,
      canonicalUrl: postUrl,
      imageUrl,
      contentHtml,
    });

    await putText(outBucketKey, `${dir}/index.html`, fullHtml, "text/html; charset=utf-8");
    await putJson(outBucketKey, `${dir}/post.json`, {
      ok: true,
      week,
      days,
      title,
      slug,
      url: postUrl,
      imageUrl,
      createdAt: new Date().toISOString(),
      sources: items.map((it) => ({
        title: it.title,
        link: it.link,
        pubDate: it.pubDateRaw,
      })),
    });

    // Index (simple: latest only)
    const indexHtml = indexTemplate({
      title: "Turing’s Torch — Weekly Blog",
      items: [{ title, url: postUrl, dateLabel }],
    });
    await putText(outBucketKey, `${prefix}/index.html`, indexHtml, "text/html; charset=utf-8");

    // Sitemap (latest + index)
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      `  <url><loc>${escapeXml(buildPublicUrl(outBucketKey, `${prefix}/index.html`))}</loc></url>\n` +
      `  <url><loc>${escapeXml(postUrl)}</loc></url>\n` +
      `</urlset>`;
    await putText(outBucketKey, `${prefix}/sitemap.xml`, sitemap, "application/xml; charset=utf-8");

    info("blog.weekly.build.success", { week, postUrl, postMetaUrl, imageUrl });

    return {
      ok: true,
      week,
      days,
      title,
      slug,
      postUrl,
      postMetaUrl,
      imageUrl,
      indexUrl: buildPublicUrl(outBucketKey, `${prefix}/index.html`),
      sitemapUrl: buildPublicUrl(outBucketKey, `${prefix}/sitemap.xml`),
    };
  } catch (e) {
    error("blog.weekly.build.fail", { error: e.message, stack: e.stack });
    return { ok: false, error: e.message };
  }
}

function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
