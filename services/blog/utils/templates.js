// services/blog/utils/templates.js

export function pageTemplate({
  title,
  description,
  canonicalUrl,
  imageUrl,
  contentHtml,
}) {
  const safeTitle = escapeHtml(title || "Blog");
  const safeDesc = escapeHtml(description || "");

  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${safeTitle}</title>
  ${safeDesc ? `<meta name="description" content="${safeDesc}" />` : ""}
  ${canonicalUrl ? `<link rel="canonical" href="${canonicalUrl}" />` : ""}

  <meta property="og:title" content="${safeTitle}" />
  ${safeDesc ? `<meta property="og:description" content="${safeDesc}" />` : ""}
  ${canonicalUrl ? `<meta property="og:url" content="${canonicalUrl}" />` : ""}
  ${imageUrl ? `<meta property="og:image" content="${imageUrl}" />` : ""}
  <meta property="og:type" content="article" />

  <style>
    :root{color-scheme:dark;}
    body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,Arial;line-height:1.6;background:#0b1220;color:#e7eefc;}
    a{color:#62d0ff;text-decoration:none;} a:hover{text-decoration:underline;}
    .wrap{max-width:900px;margin:0 auto;padding:24px;}
    header{margin-bottom:18px;}
    h1{font-size:2rem;line-height:1.2;margin:0 0 12px;}
    .hero{width:100%;border-radius:16px;overflow:hidden;box-shadow:0 12px 34px rgba(0,0,0,.35);margin:18px 0;}
    .hero img{display:block;width:100%;height:auto;}
    .card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:18px;}
    .meta{opacity:.8;font-size:.95rem;}
    .sources li{margin:.35rem 0;}
    footer{opacity:.7;margin-top:28px;font-size:.9rem;}
    code, pre{background:rgba(255,255,255,.06);padding:.2rem .35rem;border-radius:8px;}
  </style>
</head>
<body>
  <div class="wrap">
    ${contentHtml}
    <footer>
      <p>Built by AI Podcast Suite · Turing’s Torch</p>
    </footer>
  </div>
</body>
</html>`;
}

export function indexTemplate({ title = "Blog", items = [] }) {
  const list = items
    .map(
      (it) =>
        `<li><a href="${it.url}">${escapeHtml(it.title)}</a> <span class="meta">· ${escapeHtml(
          it.dateLabel || ""
        )}</span></li>`
    )
    .join("\n");

  const contentHtml = `
<header>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">Weekly AI news, minus the noise.</p>
</header>
<div class="card">
  <ol>
    ${list || "<li>No posts yet.</li>"}
  </ol>
</div>`;

  return pageTemplate({
    title,
    description: "Weekly AI news roundups.",
    canonicalUrl: "",
    imageUrl: "",
    contentHtml,
  });
}

export function weeklyPostBody({ title, dateLabel, imageUrl, html, sources = [] }) {
  const sourcesHtml = sources
    .map(
      (s) =>
        `<li><a href="${s.link}" rel="noopener" target="_blank">${escapeHtml(
          s.title
        )}</a></li>`
    )
    .join("\n");

  return `
<header>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">${escapeHtml(dateLabel || "")}</p>
</header>
${imageUrl ? `<div class="hero"><img src="${imageUrl}" alt="${escapeHtml(title)}" /></div>` : ""}
<article class="card">
  ${html}
  <hr style="border:0;border-top:1px solid rgba(255,255,255,.1);margin:18px 0;" />
  <h2 style="margin:0 0 10px;">Sources</h2>
  <ul class="sources">${sourcesHtml || ""}</ul>
</article>`;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
