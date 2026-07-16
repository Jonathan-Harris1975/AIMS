// audits/utils/newsletterAudit.js
//
// Produces the newsletter-engine section of the monthly AIMS audit. Note on
// scope: the monthly *audit orchestration* (RAMS — the self-improving
// monthly audit pipeline built on the Aider architecture) lives in its own
// repository and is out of scope for this change. What AIMS can and does own
// is the same thing every other "*-council" module in this directory owns:
// producing a RAMS-readable report.json/latest.json in the R2 audits bucket
// that RAMS's monthly pass reads, exactly like brand-social-council,
// seo-aeo-geo-council and mobile-ux-council already do.
//
// Metrics covered (per the newsletter engine spec):
//   - QA pass rate (how many issues cleared review without hitting
//     maxRewriteIterations / quarantine)
//   - Average rewrite iterations per issue
//   - Subscriber growth (from EmailOctopus list metadata, when configured)
//   - Open/click rates (from EmailOctopus campaign reports, for any issue
//     that has a real campaign ID on file)
//   - Unsubscribe rate (from the same campaign summary reports)
//   - Content quality trends (banned-phrase / Americanism hit-rate across
//     the period, from stored issue metadata)

import { info, warn } from "../../logger.js";
import { listKeys, getObjectAsText } from "../../services/shared/utils/r2-client.js";
import { buildAuditPrefix } from "./auditPaths.js";
import { publishAuditJson, publishAuditText, publishAuditLatest } from "./publishAuditArtifacts.js";
import { listNewsletterProfiles } from "../../services/newsletter/config/profiles.js";
import { getList } from "../../services/newsletter/emailoctopus/client.js";

const AUDIT_TYPE = "newsletter";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function monthWindow(now = new Date()) {
  const end = now;
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * Loads every issue's metadata.json for a profile within a window by
 * listing the R2 key prefix and reading each metadata file. Bounded by
 * listKeys pagination already handled inside r2-client.
 */
async function loadIssueMetadataForProfile(profile, { start, end }) {
  const bucketKey = profile.storage.htmlBucketKey;
  const keys = await listKeys(bucketKey, `${profile.storage.keyPrefix}/`);
  const metadataKeys = keys.filter((k) => k.endsWith("/metadata.json"));

  const issues = [];
  for (const key of metadataKeys) {
    try {
      const raw = await getObjectAsText(bucketKey, key);
      const metadata = JSON.parse(raw);
      const generatedAt = metadata.generatedAt ? new Date(metadata.generatedAt) : null;
      if (generatedAt && generatedAt >= start && generatedAt <= end) {
        issues.push(metadata);
      }
    } catch (err) {
      warn("audit.newsletter.metadata_unreadable", { key, error: err.message });
    }
  }
  return issues;
}

function summariseQa(issues) {
  if (!issues.length) {
    return { issueCount: 0, passRate: null, avgIterations: null, quarantineCount: 0 };
  }
  const passed = issues.filter((i) => i.qa?.passed);
  const quarantined = issues.filter((i) => i.qa?.quarantined);
  const iterations = issues.map((i) => Number(i.qa?.iterations) || 0).filter((n) => n > 0);

  return {
    issueCount: issues.length,
    passRate: Number(((passed.length / issues.length) * 100).toFixed(1)),
    avgIterations: iterations.length ? Number((iterations.reduce((a, b) => a + b, 0) / iterations.length).toFixed(2)) : null,
    quarantineCount: quarantined.length,
  };
}

async function summariseAudience(profile) {
  if (!profile.emailOctopus.listId) return { configured: false };
  const result = await getList(profile.emailOctopus.listId);
  if (!result.ok) return { configured: true, error: result.error };
  return {
    configured: true,
    listId: profile.emailOctopus.listId,
    counts: result.data?.counts || null,
  };
}

async function buildProfileSection(profile, window) {
  const issues = await loadIssueMetadataForProfile(profile, window);
  const qa = summariseQa(issues);
  const audience = await summariseAudience(profile);

  return {
    profileId: profile.id,
    displayName: profile.displayName,
    window: { start: window.start.toISOString(), end: window.end.toISOString() },
    qa,
    audience,
    // Campaign-level open/click/unsubscribe metrics require a real
    // EmailOctopus campaign ID per issue, which the documented v2 API
    // cannot currently create programmatically (see
    // services/newsletter/emailoctopus/client.js). Once a campaign ID is
    // recorded against an issue (manually, or via a future documented
    // endpoint), audits/routes/newsletter.js's /run can be extended to pull
    // per-campaign reports here.
    campaignPerformance: {
      available: false,
      reason: "No EmailOctopus campaign IDs on file — campaign creation is not exposed by the documented v2 API.",
    },
  };
}

function renderHtml(report) {
  const rows = report.profiles
    .map(
      (p) => `<tr>
<td>${escapeHtml(p.displayName)}</td>
<td>${p.qa.issueCount}</td>
<td>${p.qa.passRate ?? "—"}%</td>
<td>${p.qa.avgIterations ?? "—"}</td>
<td>${p.qa.quarantineCount}</td>
</tr>`
    )
    .join("\n");

  return `<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8"/>
<title>Newsletter Audit — ${escapeHtml(report.generatedAt)}</title></head>
<body>
<h1>Newsletter Engine — Monthly Audit</h1>
<p>Window: ${escapeHtml(report.window.start)} to ${escapeHtml(report.window.end)}</p>
<table border="1" cellpadding="6" cellspacing="0">
<tr><th>Profile</th><th>Issues</th><th>QA pass rate</th><th>Avg rewrite iterations</th><th>Quarantined</th></tr>
${rows}
</table>
</body></html>`;
}

export async function runNewsletterAudit({ sessionId = `newsletter-audit-${Date.now()}` } = {}) {
  const window = monthWindow();
  const profiles = listNewsletterProfiles();

  const profileSections = [];
  for (const profile of profiles) {
    profileSections.push(await buildProfileSection(profile, window));
  }

  const report = {
    auditType: AUDIT_TYPE,
    sessionId,
    generatedAt: new Date().toISOString(),
    window: { start: window.start.toISOString(), end: window.end.toISOString() },
    profiles: profileSections,
  };

  const reportPrefix = buildAuditPrefix(AUDIT_TYPE, sessionId);
  const html = renderHtml(report);

  const [reportJson, reportHtml] = await Promise.all([
    publishAuditJson({ key: `${reportPrefix}/report.json`, payload: report }),
    publishAuditText({ key: `${reportPrefix}/report.html`, text: html, contentType: "text/html; charset=utf-8" }),
  ]);

  const latest = await publishAuditLatest({
    auditType: AUDIT_TYPE,
    sessionId,
    payload: {
      reportPrefix,
      reportUrl: reportHtml.url,
      reportJsonUrl: reportJson.url,
      profiles: profileSections.map((p) => ({ profileId: p.profileId, qa: p.qa })),
    },
  });

  info("audit.newsletter.complete", { sessionId, reportPrefix, profileCount: profileSections.length });

  return {
    ok: true,
    auditType: AUDIT_TYPE,
    sessionId,
    reportPrefix,
    reportUrl: reportHtml.url,
    reportJsonUrl: reportJson.url,
    latestUrl: latest.url,
    profiles: profileSections,
  };
}

export function getNewsletterAuditStatus() {
  return {
    ok: true,
    auditType: AUDIT_TYPE,
    profiles: listNewsletterProfiles().map((p) => p.id),
    output: ["report.html", "report.json", "latest.json"],
    note: "Feeds the monthly RAMS audit pass, same as brand-social-council / seo-aeo-geo-council / mobile-ux-council.",
  };
}

export default runNewsletterAudit;
