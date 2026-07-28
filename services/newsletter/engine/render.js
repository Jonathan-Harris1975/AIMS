// services/newsletter/engine/render.js
//
// Renders the final, QA-passed newsletter content into:
//  - Email-safe HTML (table layout, inline CSS — no external stylesheet,
//    no flexbox/grid, since major email clients strip <style> blocks and
//    don't support modern CSS layout).
//  - A website archive page using the canonical versioned site shell.
//  - A plaintext fallback (required for deliverability/spam scoring).
//  - A metadata JSON object for R2 storage / the audit trail.

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderFeaturedBlock(featured) {
  if (!featured?.enabled || !featured.title) return "";
  const image = featured.imageUrl
    ? `<tr><td style="padding:0 0 12px 0;"><img src="${escapeHtml(featured.imageUrl)}" alt="${escapeHtml(featured.title)}" width="100%" style="display:block;border-radius:8px;max-width:100%;"/></td></tr>`
    : "";
  const cta = featured.url
    ? `<tr><td style="padding:12px 0 0 0;"><a href="${escapeHtml(featured.url)}" style="display:inline-block;background:#0D1420;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;font-size:14px;">${escapeHtml(featured.ctaLabel || "Take a look")}</a></td></tr>`
    : "";

  return `
<tr>
  <td style="padding:28px 24px;background:#F5F6F8;border-radius:10px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      ${image}
      <tr><td style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#6B7280;padding-bottom:6px;">Featured</td></tr>
      <tr><td style="font-size:17px;font-weight:700;color:#0D1420;font-family:Georgia,'Times New Roman',serif;padding-bottom:6px;">${escapeHtml(featured.title)}</td></tr>
      ${featured.blurb ? `<tr><td style="font-size:14px;line-height:1.5;color:#374151;">${escapeHtml(featured.blurb)}</td></tr>` : ""}
      ${cta}
    </table>
  </td>
</tr>`;
}

function renderStoryRow(story, index) {
  return `
<tr>
  <td style="padding:14px 0;border-top:1px solid #E5E7EB;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="width:28px;vertical-align:top;font-size:14px;font-weight:700;color:#9CA3AF;">${index + 1}.</td>
        <td>
          <a href="${escapeHtml(story.link)}" style="font-size:15px;font-weight:600;color:#0D1420;text-decoration:none;">${escapeHtml(story.title)}</a>
          <div style="font-size:14px;line-height:1.5;color:#374151;padding-top:4px;">${escapeHtml(story.summary)}</div>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

export function renderNewsletterHtml({ profile, newsletter }) {
  const {
    subject, previewText, heroHeadline, leadArticleHtml, heroImageUrl, sourceLink, stories, footer,
  } = newsletter;

  const storyRows = (stories || []).map((s, i) => renderStoryRow(s, i)).join("\n");
  const featuredBlock = renderFeaturedBlock(profile.featuredContent);

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#EEF0F3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(previewText || "")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EEF0F3;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">

<tr><td style="padding:20px 24px;border-bottom:1px solid #E5E7EB;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#0D1420;">${escapeHtml(profile.displayName)}</td></tr>

${heroImageUrl ? `<tr><td><img src="${escapeHtml(heroImageUrl)}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;"/></td></tr>` : ""}

<tr><td style="padding:24px 24px 8px 24px;">
  <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.3;font-weight:700;color:#0D1420;">
    <a href="${escapeHtml(sourceLink || "#")}" style="color:#0D1420;text-decoration:none;">${escapeHtml(heroHeadline)}</a>
  </div>
</td></tr>

<tr><td style="padding:0 24px 20px 24px;font-size:15px;line-height:1.6;color:#1F2937;">
  ${leadArticleHtml}
</td></tr>

<tr><td style="padding:0 24px 8px 24px;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6B7280;">Today's top stories</td></tr>

<tr><td style="padding:0 24px 8px 24px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    ${storyRows}
  </table>
</td></tr>

<tr><td style="padding:20px 24px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    ${featuredBlock}
  </table>
</td></tr>

<tr><td style="padding:20px 24px;border-top:1px solid #E5E7EB;font-size:12px;line-height:1.5;color:#9CA3AF;">
  ${escapeHtml(footer?.text || "")}
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}


function renderWebFeatured(featured) {
  if (!featured?.enabled || !featured.title) return "";
  return `<section class="card">
    <p class="tag">Featured</p>
    <h2>${escapeHtml(featured.title)}</h2>
    ${featured.imageUrl ? `<img class="cover" src="${escapeHtml(featured.imageUrl)}" alt="${escapeHtml(featured.title)}" loading="lazy" decoding="async"/>` : ""}
    ${featured.blurb ? `<p>${escapeHtml(featured.blurb)}</p>` : ""}
    ${featured.url ? `<p><a class="button" href="${escapeHtml(featured.url)}">${escapeHtml(featured.ctaLabel || "Take a look")}</a></p>` : ""}
  </section>`;
}

export function renderNewsletterWebHtml({ profile, newsletter, siteShell }) {
  if (!siteShell?.manifest?.releaseSha || !siteShell?.headerHtml || !siteShell?.footerHtml) {
    throw new Error("A canonical site shell is required to render the newsletter web archive.");
  }
  const { subject, heroHeadline, leadArticleHtml, heroImageUrl, sourceLink, stories } = newsletter;
  const storyCards = (stories || []).map((story) => `<article class="card">
    <h2><a href="${escapeHtml(story.link)}">${escapeHtml(story.title)}</a></h2>
    <p>${escapeHtml(story.summary)}</p>
  </article>`).join("\n");

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"/>
<meta name="jh-site-shell-version" content="${escapeHtml(siteShell.manifest.releaseSha)}"/>
<title>${escapeHtml(subject)} | ${escapeHtml(profile.displayName)}</title>
<meta name="robots" content="index,follow"/>
<link href="${escapeHtml(siteShell.manifest.stylesheetUrl)}" rel="stylesheet"/>
</head>
<body class="page-newsletter jh-growth-page">
${siteShell.headerHtml}
<section class="hero jh-page-hero" data-jh-header-reveal-anchor aria-label="AI Edge issue">
  <div class="wrap">
    <p class="tag">${escapeHtml(profile.displayName)}</p>
    <h1>${escapeHtml(heroHeadline)}</h1>
    ${heroImageUrl ? `<img class="cover" src="${escapeHtml(heroImageUrl)}" alt="" loading="eager" decoding="async"/>` : ""}
  </div>
</section>
<main class="main" id="main" role="main">
  <div class="wrap">
    <article class="card">
      <h2>${escapeHtml(heroHeadline)}</h2>
      <div>${leadArticleHtml}</div>
      ${sourceLink ? `<p><a class="button" href="${escapeHtml(sourceLink)}">Read the source</a></p>` : ""}
    </article>
    ${storyCards}
    ${renderWebFeatured(profile.featuredContent)}
  </div>
</main>
${siteShell.footerHtml}
<script defer src="${escapeHtml(siteShell.manifest.siteUiScriptUrl)}"></script>
</body>
</html>`;
}

export function renderNewsletterPlaintext({ profile, newsletter }) {
  const lines = [
    profile.displayName,
    "",
    newsletter.heroHeadline,
    newsletter.sourceLink,
    "",
    stripHtml(newsletter.leadArticleHtml),
    "",
    "TODAY'S TOP STORIES",
    "",
    ...(newsletter.stories || []).map((s, i) => `${i + 1}. ${s.title}\n${stripHtml(s.summary)}\n${s.link}\n`),
    "",
    newsletter.footer?.text || "",
  ];
  return lines.join("\n").trim();
}

function stripHtml(html = "") {
  let input = String(html || "");
  let previous;
  do {
    previous = input;
    input = input.replace(/<[^>]+>/g, "");
  } while (input !== previous);
  return input.replace(/\s+/g, " ").trim();
}

export function buildNewsletterMetadata({ profile, newsletter, qaResult, generatedAt, siteShellReleaseSha = "" }) {
  return {
    profileId: profile.id,
    subject: newsletter.subject,
    previewText: newsletter.previewText,
    heroHeadline: newsletter.heroHeadline,
    heroImageUrl: newsletter.heroImageUrl,
    storyCount: (newsletter.stories || []).length,
    sourceLinks: [newsletter.sourceLink, ...(newsletter.stories || []).map((s) => s.link)].filter(Boolean),
    siteShellReleaseSha: siteShellReleaseSha || null,
    qa: {
      passed: qaResult.ok,
      quarantined: qaResult.quarantined,
      iterations: qaResult.iterations,
      finalScore: qaResult.finalScore,
    },
    generatedAt: generatedAt || new Date().toISOString(),
  };
}

export default { renderNewsletterHtml, renderNewsletterWebHtml, renderNewsletterPlaintext, buildNewsletterMetadata };
