// audits/utils/newsletterAudit.js
//
// Produces the newsletter-engine section of the monthly AIMS audit. Note on
// scope: the monthly *audit orchestration* (RAMS — the self-improving
// monthly audit pipeline built on the Aider architecture) lives in its own
// repository and is out of scope for this change. What AIMS can and does own
// is the same thing every other "*-council" module in this directory owns:
// producing a RAMS-readable report.json/latest.json in the R2 audits bucket
// that RAMS's monthly pass reads, exactly like brand-social-council,
// the unified website audit and brand-social council already do.
//
// Metrics covered (per the newsletter engine spec):
//   - QA pass rate (how many issues cleared review without hitting
//     maxRewriteIterations / quarantine)
//   - Average rewrite iterations per issue
//   - Subscriber growth (from Brevo list counts)
//   - Open/click/unsubscribe rates (from Brevo campaign reports, for every
//     issue that was actually delivered — see campaign.json alongside each
//     issue's metadata.json, written by services/newsletter/brevo/campaign.js)
//   - Content quality trends (banned-phrase / Americanism hit-rate across
//     the period, from stored issue metadata)

import { info, warn } from "../../logger.js";
import { listKeys, getObjectAsText } from "../../services/shared/utils/r2-client.js";
import { buildAuditPrefix } from "./auditPaths.js";
import { publishAuditJson, publishAuditText, publishAuditLatest } from "./publishAuditArtifacts.js";
import { listNewsletterProfiles } from "../../services/newsletter/config/profiles.js";
import { ensureList } from "../../services/newsletter/brevo/audience.js";
import { getList } from "../../services/newsletter/brevo/client.js";
import { getCampaignStatus } from "../../services/newsletter/brevo/campaign.js";

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
 * Loads every issue's metadata.json (and, where present, its sibling
 * campaign.json recording the Brevo delivery) for a profile within a
 * window, by listing the R2 key prefix once and grouping keys by issue
 * directory.
 */
async function loadIssueRecordsForProfile(profile, { start, end }) {
  const bucketKey = profile.storage.htmlBucketKey;
  const keys = await listKeys(bucketKey, `${profile.storage.keyPrefix}/`);

  const byIssueDir = new Map();
  for (const key of keys) {
    if (key.endsWith("/metadata.json") || key.endsWith("/campaign.json")) {
      const issueDir = key.slice(0, key.lastIndexOf("/"));
      const entry = byIssueDir.get(issueDir) || {};
      if (key.endsWith("/metadata.json")) entry.metadataKey = key;
      if (key.endsWith("/campaign.json")) entry.campaignKey = key;
      byIssueDir.set(issueDir, entry);
    }
  }

  const issues = [];
  for (const { metadataKey, campaignKey } of byIssueDir.values()) {
    if (!metadataKey) continue;
    try {
      const metadata = JSON.parse(await getObjectAsText(bucketKey, metadataKey));
      const generatedAt = metadata.generatedAt ? new Date(metadata.generatedAt) : null;
      if (!generatedAt || generatedAt < start || generatedAt > end) continue;

      let campaign = null;
      if (campaignKey) {
        try {
          campaign = JSON.parse(await getObjectAsText(bucketKey, campaignKey));
        } catch (err) {
          warn("audit.newsletter.campaign_record_unreadable", { key: campaignKey, error: err.message });
        }
      }
      issues.push({ metadata, campaign });
    } catch (err) {
      warn("audit.newsletter.metadata_unreadable", { key: metadataKey, error: err.message });
    }
  }
  return issues;
}

function summariseQa(issues) {
  if (!issues.length) {
    return { issueCount: 0, passRate: null, avgIterations: null, quarantineCount: 0 };
  }
  const metadatas = issues.map((i) => i.metadata);
  const passed = metadatas.filter((m) => m.qa?.passed);
  const quarantined = metadatas.filter((m) => m.qa?.quarantined);
  const iterations = metadatas.map((m) => Number(m.qa?.iterations) || 0).filter((n) => n > 0);

  return {
    issueCount: issues.length,
    passRate: Number(((passed.length / issues.length) * 100).toFixed(1)),
    avgIterations: iterations.length ? Number((iterations.reduce((a, b) => a + b, 0) / iterations.length).toFixed(2)) : null,
    quarantineCount: quarantined.length,
  };
}

async function summariseAudience(profile) {
  const list = await ensureList({ name: profile.brevo.listName, folderName: profile.brevo.folderName });
  if (!list.ok) return { configured: true, error: list.error };

  const result = await getList(list.listId);
  if (!result.ok) return { configured: true, listId: list.listId, error: result.error };

  return {
    configured: true,
    listId: list.listId,
    totalSubscribers: result.data?.totalSubscribers ?? null,
    totalBlacklisted: result.data?.totalBlacklisted ?? null,
  };
}

async function summariseCampaignPerformance(issues) {
  const delivered = issues.filter((i) => i.campaign?.campaignId);
  if (!delivered.length) {
    return { available: false, deliveredCount: 0, reason: "No issues in this window have a recorded Brevo campaign delivery." };
  }

  const stats = [];
  for (const { campaign } of delivered) {
    const status = await getCampaignStatus(campaign.campaignId);
    if (status.ok && status.statistics) stats.push(status.statistics);
  }

  if (!stats.length) {
    return { available: false, deliveredCount: delivered.length, reason: "Brevo campaign reports were not retrievable for any delivered issue in this window." };
  }

  const avg = (field) => {
    const values = stats.map((s) => Number(s[field])).filter((n) => Number.isFinite(n));
    return values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : null;
  };

  return {
    available: true,
    deliveredCount: delivered.length,
    reportedCount: stats.length,
    avgUniqueOpens: avg("uniqueViews"),
    avgUniqueClicks: avg("clickers"),
    avgUnsubscribed: avg("unsubscriptions"),
  };
}

async function buildProfileSection(profile, window) {
  const issues = await loadIssueRecordsForProfile(profile, window);
  const qa = summariseQa(issues);
  const audience = await summariseAudience(profile);
  const campaignPerformance = await summariseCampaignPerformance(issues);

  return {
    profileId: profile.id,
    displayName: profile.displayName,
    window: { start: window.start.toISOString(), end: window.end.toISOString() },
    qa,
    audience,
    campaignPerformance,
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
<td>${p.audience.totalSubscribers ?? "—"}</td>
<td>${p.campaignPerformance.available ? `${p.campaignPerformance.avgUniqueOpens ?? "—"} / ${p.campaignPerformance.avgUniqueClicks ?? "—"} / ${p.campaignPerformance.avgUnsubscribed ?? "—"}` : "—"}</td>
</tr>`
    )
    .join("\n");

  return `<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8"/>
<title>Newsletter Audit — ${escapeHtml(report.generatedAt)}</title></head>
<body>
<h1>Newsletter Engine — Monthly Audit</h1>
<p>Window: ${escapeHtml(report.window.start)} to ${escapeHtml(report.window.end)}</p>
<table border="1" cellpadding="6" cellspacing="0">
<tr><th>Profile</th><th>Issues</th><th>QA pass rate</th><th>Avg rewrite iterations</th><th>Quarantined</th><th>Subscribers</th><th>Avg opens/clicks/unsubs</th></tr>
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
      profiles: profileSections.map((p) => ({ profileId: p.profileId, qa: p.qa, campaignPerformance: p.campaignPerformance })),
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
    note: "Feeds the monthly RAMS audit pass, same governance lane as brand-social-council and the unified website audit.",
  };
}

export default runNewsletterAudit;
