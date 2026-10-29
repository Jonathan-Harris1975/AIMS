// services/newsletter/engine/render.js
//
// Renders AI Edge as email-safe HTML, plaintext and
// metadata. The structure mirrors the editorial promise: opening note, Big
// Three, Worth Using/Watching, On the Radar, Reality Check, optional Tuesday
// book/Thursday podcast promotion, then the subscription footer.

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripHtml(html = "") {
  let input = String(html || "");
  let previous;
  do { previous = input; input = input.replace(/<[^>]+>/g, ""); } while (input !== previous);
  return input.replace(/\s+/g, " ").trim();
}

function sectionLabel(label) {
  return `<tr><td style="padding:24px 24px 8px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6B7280;">${escapeHtml(label)}</td></tr>`;
}

function renderBigStory(story) {
  return `<tr><td style="padding:16px 24px;border-top:1px solid #E5E7EB;">
    <a href="${escapeHtml(story.link)}" style="font-family:Georgia,'Times New Roman',serif;font-size:19px;font-weight:700;color:#0D1420;text-decoration:none;">${escapeHtml(story.title)}</a>
    <div style="font-size:14px;line-height:1.55;color:#1F2937;padding-top:10px;"><strong>What happened:</strong> ${escapeHtml(story.whatHappened)}</div>
    <div style="font-size:14px;line-height:1.55;color:#1F2937;padding-top:6px;"><strong>Why it matters:</strong> ${escapeHtml(story.whyItMatters)}</div>
    <div style="font-size:14px;line-height:1.55;color:#1F2937;padding-top:6px;"><strong>Jonathan's take:</strong> ${escapeHtml(story.jonathanTake)}</div>
  </td></tr>`;
}

function renderPromotion(promotion) {
  if (!promotion?.title || !promotion?.url) return "";
  return `${sectionLabel(promotion.eyebrow || "Featured")}
  <tr><td style="padding:0 24px 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F6F8;border-radius:10px;">
      <tr><td style="padding:20px;">
        ${promotion.imageUrl ? `<img src="${escapeHtml(promotion.imageUrl)}" alt="${escapeHtml(
          promotion.title)}" width="100%" style="display:block;max-width:100%;border-radius:8px;margin-bottom:14px;"/>` : ""}
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:18px;font-weight:700;color:#0D1420;">${escapeHtml(promotion.title)}</div>
        <div style="font-size:14px;line-height:1.55;color:#374151;padding-top:8px;">${escapeHtml(promotion.blurb || "")}</div>
        <div style="padding-top:12px;"><a href="${escapeHtml(promotion.url)}" style="display:inline-block;background:#0D1420;color:#fff;text-decoration:none;padding:10px 16px;\
border-radius:6px;font-weight:600;font-size:14px;">${escapeHtml(promotion.ctaLabel || "Take a look")}</a></div>
      </td></tr>
    </table>
  </td></tr>`;
}

export function renderNewsletterHtml({ profile, newsletter }) {
  const editionLabel = newsletter.edition === "saturday" ? "Saturday · The week in debate"
    : newsletter.edition === "sunday" ? "Sunday · A slower look at the week" : "Jonathan Harris · practical AI, minus the hype";
  const bigThree = (newsletter.bigThree || []).map(renderBigStory).join("\n");
  const radar = (newsletter.onRadar || []).map((story) => `<tr><td style="padding:10px 0;border-top:1px solid #E5E7EB;"><a href="${escapeHtml(
    story.link)}" style="font-size:14px;font-weight:700;color:#0D1420;text-decoration:none;">${escapeHtml(
      story.title)}</a><div style="font-size:13px;line-height:1.5;color:#374151;padding-top:3px;">${escapeHtml(story.summary)}</div></td></tr>`).join("\n");

  return `<!DOCTYPE html>
<html lang="en-GB"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeHtml(newsletter.subject)}</title></head>
<body style="margin:0;padding:0;background:#EEF0F3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(newsletter.previewText || "")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EEF0F3;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;">
<tr><td align="center" style="padding:24px 24px 18px;border-bottom:1px solid #E5E7EB;">
  <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:#0D1420;">${escapeHtml(profile.displayName)}</div>
  <div style="padding-top:5px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#64748B;">${escapeHtml(editionLabel)}</div>
</td></tr>
${newsletter.heroImageUrl ? `<tr><td><img src="${escapeHtml(newsletter.heroImageUrl)}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;"/></td></tr>` : ""}
<tr><td style="padding:24px 24px 8px;font-family:Georgia,'Times New Roman',serif;font-size:25px;line-height:1.25;font-weight:700;color:#0D1420;">${escapeHtml(newsletter.heroHeadline)}</td></tr>
<tr><td style="padding:0 24px 18px;font-size:15px;line-height:1.6;color:#1F2937;">${newsletter.openingNoteHtml || ""}</td></tr>
${sectionLabel("The Big Three")}
${bigThree}
${newsletter.worthUsing ? `${sectionLabel(newsletter.worthUsing.label || "Worth Using")}
<tr><td style="padding:8px 24px 12px;"><a href="${escapeHtml(newsletter.worthUsing.link)}" style="font-size:16px;font-weight:700;color:#0D1420;text-decoration:none;\
">${escapeHtml(newsletter.worthUsing.title)}</a><div style="font-size:14px;line-height:1.55;color:#374151;padding-top:6px;">${escapeHtml(
  newsletter.worthUsing.summary)}</div>${newsletter.worthUsing.whyUseful ?
     `<div style="font-size:14px;line-height:1.55;color:#1F2937;padding-top:6px;"><strong>Why it's worth your time:</strong> ${escapeHtml(
       newsletter.worthUsing.whyUseful)}</div>` : ""}</td></tr>` : ""}
${sectionLabel("On the Radar")}
<tr><td style="padding:0 24px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${radar}</table></td></tr>
${sectionLabel("Reality Check")}
<tr><td style="padding:8px 24px 16px;"><div style="font-size:15px;font-weight:700;color:#0D1420;">${escapeHtml(newsletter.realityCheck?.claim ||
   "")}</div><div style="font-size:14px;line-height:1.6;color:#374151;padding-top:6px;">${escapeHtml(newsletter.realityCheck?.assessment ||
      "")}</div>${newsletter.realityCheck?.link ? `<div style="padding-top:6px;"><a href="${escapeHtml(
        newsletter.realityCheck.link)}" style="font-size:13px;color:#0D1420;">Read the source</a></div>` : ""}</td></tr>
${renderPromotion(newsletter.promotion)}
<tr><td style="padding:22px 24px;border-top:1px solid #E5E7EB;font-size:12px;line-height:1.65;color:#64748B;text-align:center;">${escapeHtml(newsletter.footer?.text || "")}${["saturday", "sunday"].includes(newsletter.edition)
  ? "<br/>Prepared on Friday from the week’s coverage." : ""}<br/>
<span style="color:#94A3B8;">AI Edge is written for people who want useful AI analysis without vendor theatre.</span></td></tr>
</table></td></tr></table></body></html>`;
}

export function renderNewsletterPlaintext({ profile, newsletter }) {
  const lines = [profile.displayName, "", newsletter.heroHeadline, "", stripHtml(newsletter.openingNoteHtml), "", "THE BIG THREE", ""];
  (newsletter.bigThree || []).forEach((story) => {
    lines.push(
      `${story.title}\nWhat happened: ${story.whatHappened}\nWhy it matters: ${story.whyItMatters}\nJonathan's take: ${story.jonathanTake}\n${story.link}\n`,
    );
  });
  if (newsletter.worthUsing) lines.push((newsletter.worthUsing.label || "WORTH USING").toUpperCase(), "",
     `${newsletter.worthUsing.title}\n${newsletter.worthUsing.summary}\n${newsletter.worthUsing.whyUseful}\n${newsletter.worthUsing.link}`, "");
  lines.push("ON THE RADAR", "");
  (newsletter.onRadar || []).forEach((story) => lines.push(`${story.title}\n${story.summary}\n${story.link}\n`));
  lines.push("REALITY CHECK", "", `${newsletter.realityCheck?.claim || ""}\n${newsletter.realityCheck?.assessment || ""}\n${newsletter.realityCheck?.link || ""}`, "");
  if (newsletter.promotion) lines.push((newsletter.promotion.eyebrow || "FEATURED").toUpperCase(), "", `${newsletter.promotion.title}\n${newsletter.promotion.blurb ||
     ""}\n${newsletter.promotion.url}`, "");
  lines.push(newsletter.footer?.text || "");
  return lines.join("\n").trim();
}

export function buildNewsletterMetadata({ profile, newsletter, qaResult, generatedAt, heroImage = null }) {
  const sourceLinks = [
    ...(newsletter.bigThree || []).map((s) => s.link),
    newsletter.worthUsing?.link,
    ...(newsletter.onRadar || []).map((s) => s.link),
    newsletter.realityCheck?.link,
  ].filter(Boolean);
  return {
    profileId: profile.id,
    formatVersion: "ai-edge-v3-email",
    distribution: "email-only",
    edition: newsletter.edition || "daily",
    subject: newsletter.subject,
    previewText: newsletter.previewText,
    heroHeadline: newsletter.heroHeadline,
    heroImageUrl: newsletter.heroImageUrl,
    heroImageKey: heroImage?.key || null,
    heroImageBucketKey: heroImage?.bucketKey || null,
    heroImageStatus: heroImage?.imageStatus || null,
    storyCount: new Set(sourceLinks).size,
    sourceLinks: [...new Set(sourceLinks)],
    promotion: newsletter.promotion ? { type: newsletter.promotion.type, title: newsletter.promotion.title, url: newsletter.promotion.url } : null,
    qa: {
      passed: qaResult.ok,
      quarantined: qaResult.quarantined,
      iterations: qaResult.iterations,
      finalScore: qaResult.finalScore,
      councilMembers: qaResult.council?.members || [],
      councilVerdict: qaResult.council?.verdict || null,
    },
    generatedAt: generatedAt || new Date().toISOString(),
  };
}

export default { renderNewsletterHtml, renderNewsletterPlaintext, buildNewsletterMetadata };
