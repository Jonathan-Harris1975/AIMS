function escapeHtml(value = "") {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = "Not verified from supplied evidence") {
  const cleaned = String(value ?? "").trim();
  return cleaned || fallback;
}

function score(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
}

function section(title, body) {
  return `<section class="card"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

function list(items) {
  const rows = arr(items).filter(Boolean);
  if (!rows.length) return "<p class=\"muted\">None recorded.</p>";
  return `<ul>${rows.map((item) => `<li>${escapeHtml(typeof item === "string" ? item : JSON.stringify(item))}</li>`).join("")}</ul>`;
}

function renderScorecard(scorecard = {}) {
  const labels = [
    ["overallBrandFit", "Overall brand fit"],
    ["rssBrandFit", "RSS brand fit"],
    ["oneUpBlogSocialBrandFit", "OneUp/blog/social brand fit"],
    ["podcastTranscriptBrandFit", "Podcast transcript brand fit"],
    ["titleQuality", "Title quality"],
    ["spokenNaturalness", "Spoken naturalness"],
    ["editorialAuthority", "Editorial authority"],
    ["antiHypeControl", "Anti-hype control"],
    ["implementationReadiness", "Implementation readiness"],
  ];
  return `<div class="scoregrid">${labels.map(([key, label]) => {
    const value = score(scorecard[key]);
    return `<div class="score"><span>${escapeHtml(label)}</span><strong>${value}</strong><div class="bar"><i style="width:${value}%"></i></div></div>`;
  }).join("")}</div>`;
}

function renderCoverage(rows = []) {
  if (!arr(rows).length) return "<p class=\"muted\">No source coverage returned.</p>";
  return `<table><thead><tr><th>Source</th><th>Status</th><th>Items</th><th>Method</th><th>Limitations</th></tr></thead><tbody>${arr(rows).map((row) => `<tr><td>${escapeHtml(row.sourceType)}</td><td><span class="pill ${escapeHtml(row.status)}">${escapeHtml(row.status)}</span></td><td>${escapeHtml(row.itemsInspected ?? 0)}</td><td>${escapeHtml(row.evidenceMethod)}</td><td>${list(row.limitations)}</td></tr>`).join("")}</tbody></table>`;
}

function renderDefects(rows = []) {
  if (!arr(rows).length) return "<p class=\"muted\">No confirmed defects recorded.</p>";
  return arr(rows).map((issue) => `<article class="defect severity-${escapeHtml(issue.severity)}">
    <div class="defect-head"><strong>${escapeHtml(issue.issueId || "Issue")}</strong><span>${escapeHtml(issue.severity || "")}</span><span>${escapeHtml(issue.sourceType || "")}</span><span>${escapeHtml(issue.confidence || "")}</span></div>
    <h3>${escapeHtml(issue.issueType || issue.itemTitleOrId || "Defect")}</h3>
    <p><b>Item:</b> ${escapeHtml(issue.itemTitleOrId || "")}</p>
    <p><b>Evidence:</b> <q>${escapeHtml(issue.exactEvidence || "")}</q></p>
    <p><b>Why off-brand:</b> ${escapeHtml(issue.whyItIsOffBrand || "")}</p>
    <p><b>Violated rule:</b> ${escapeHtml(issue.violatedRule || "")}</p>
    <p><b>Exact fix:</b> ${escapeHtml(issue.exactRemediation || "")}</p>
    ${issue.improvedExample ? `<p><b>Improved example:</b> ${escapeHtml(issue.improvedExample)}</p>` : ""}
    <p><b>Verification:</b> ${escapeHtml(issue.verificationMethod || "")}</p>
  </article>`).join("");
}

function renderObjects(rows = [], fields = []) {
  if (!arr(rows).length) return "<p class=\"muted\">None recorded.</p>";
  return `<table><thead><tr>${fields.map((field) => `<th>${escapeHtml(field.label)}</th>`).join("")}</tr></thead><tbody>${arr(rows).map((row) => `<tr>${fields.map((field) => `<td>${escapeHtml(row?.[field.key] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

export function renderOnBrandReportHtml(report = {}) {
  const verdict = report.executiveVerdict || {};
  const window = report.window || {};
  const title = "Jonathan Harris on-brand audit";
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} - ${escapeHtml(report.sessionId || "")}</title>
<style>
:root{color-scheme:dark;--bg:#0d1420;--panel:#121c2b;--panel2:#162235;--text:#edf4ff;--muted:#a9b8cc;--line:#2c3b52;--teal:#55f0d2;--purple:#a99cff;--warn:#ffd166;--bad:#ff7a90;--ok:#85e89d}*{box-sizing:border-box}body{margin:0;background:linear-gradient(135deg,#0d1420,#101827 55%,#171427);font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:var(--text)}main{width:min(1180px,92vw);margin:auto;padding:42px 0 70px}.hero{border:1px solid var(--line);background:radial-gradient(circle at top right,rgba(85,240,210,.16),transparent 34%),var(--panel);border-radius:24px;padding:34px;margin-bottom:22px;box-shadow:0 18px 50px rgba(0,0,0,.26)}h1{font-size:clamp(2rem,5vw,4rem);line-height:1;margin:0 0 16px}h2{margin:0 0 18px;font-size:1.45rem}h3{margin:.4rem 0}.meta{display:flex;flex-wrap:wrap;gap:10px}.meta span,.pill,.defect-head span{border:1px solid var(--line);background:rgba(255,255,255,.04);border-radius:999px;padding:6px 10px;color:var(--muted)}.card{background:rgba(18,28,43,.92);border:1px solid var(--line);border-radius:20px;padding:24px;margin:18px 0}.muted{color:var(--muted)}.verdict{font-size:1.12rem}.scoregrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.score{background:var(--panel2);border:1px solid var(--line);border-radius:16px;padding:14px}.score span{display:block;color:var(--muted);font-size:.92rem}.score strong{font-size:2rem}.bar{height:8px;background:#243149;border-radius:99px;overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--purple),var(--teal))}table{width:100%;border-collapse:collapse;overflow:hidden;border-radius:14px}th,td{border-bottom:1px solid var(--line);padding:10px;vertical-align:top;text-align:left}th{color:var(--teal);font-size:.9rem}.defect{border:1px solid var(--line);background:var(--panel2);border-radius:16px;padding:16px;margin:12px 0}.defect-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.severity-critical,.severity-high{border-color:rgba(255,122,144,.65)}.severity-medium{border-color:rgba(255,209,102,.55)}q{color:#fff}.complete{color:var(--ok)}.partial{color:var(--warn)}.blocked{color:var(--bad)}ul{margin-top:.25rem}</style>
</head>
<body><main>
<header class="hero">
  <p class="muted">Automated brand QA report</p>
  <h1>${escapeHtml(title)}</h1>
  <p class="verdict"><strong>${escapeHtml(text(verdict.status, "Verdict unavailable"))}</strong> - ${escapeHtml(text(verdict.summary, "No executive summary returned."))}</p>
  <div class="meta"><span>Session: ${escapeHtml(report.sessionId || "")}</span><span>Generated: ${escapeHtml(report.generatedAt || "")}</span><span>Window: ${escapeHtml(window.start || "")} to ${escapeHtml(window.end || "")}</span></div>
</header>
${section("Executive verdict", `<p>${escapeHtml(text(verdict.bluntAssessment, verdict.summary || "No blunt assessment returned."))}</p>`)}
${section("Source coverage", renderCoverage(report.sourceCoverage))}
${section("Scorecard", renderScorecard(report.scorecard))}
${section("Confirmed strengths", renderObjects(report.confirmedStrengths, [{key:"sourceType",label:"Source"},{key:"evidence",label:"Evidence"},{key:"whyItWorks",label:"Why it works"}]))}
${section("Confirmed defects ledger", renderDefects(report.confirmedDefectsLedger))}
${section("RSS analysis", `<p><b>Verdict:</b> ${escapeHtml(report.rssFindings?.verdict || "")}</p><p><b>Title issues:</b> ${escapeHtml(report.rssFindings?.titlePatternAnalysis || "")}</p><p><b>Summary tone:</b> ${escapeHtml(report.rssFindings?.summaryToneAnalysis || "")}</p>${renderDefects(report.rssFindings?.defects)}`)}
${section("OneUp/blog/social analysis", `<p><b>Verdict:</b> ${escapeHtml(report.oneUpBlogSocialFindings?.verdict || "")}</p><p>${escapeHtml(report.oneUpBlogSocialFindings?.postPatternAnalysis || "")}</p>${renderDefects(report.oneUpBlogSocialFindings?.defects)}`)}
${section("Podcast transcript analysis", `<p><b>Verdict:</b> ${escapeHtml(report.podcastTranscriptFindings?.verdict || "")}</p><p><b>Opening:</b> ${escapeHtml(report.podcastTranscriptFindings?.openingStrength || "")}</p><p><b>Flow:</b> ${escapeHtml(report.podcastTranscriptFindings?.flowAndTransitions || "")}</p><h3>Repetition watchlist</h3>${list(report.podcastTranscriptFindings?.repetitionWatchlist)}<h3>Spoken-word fixes</h3>${renderObjects(report.podcastTranscriptFindings?.spokenWordFixes, [{key:"originalLine",label:"Original"},{key:"improvedLine",label:"Improved"},{key:"reason",label:"Reason"}])}${renderDefects(report.podcastTranscriptFindings?.defects)}`)}
${section("Prompt-level diagnosis", renderObjects(report.promptLevelDiagnosis, [{key:"affectedArea",label:"Area"},{key:"diagnosis",label:"Diagnosis"},{key:"evidence",label:"Evidence"},{key:"recommendedPromptChange",label:"Prompt change"}]))}
${section("Pipeline-level diagnosis", renderObjects(report.pipelineLevelDiagnosis, [{key:"affectedFileOrService",label:"File/service"},{key:"diagnosis",label:"Diagnosis"},{key:"evidence",label:"Evidence"},{key:"smallestSafeFix",label:"Smallest safe fix"}]))}
${section("Ranked remediation plan", renderObjects(report.rankedRemediationPlan, [{key:"priority",label:"Priority"},{key:"severity",label:"Severity"},{key:"action",label:"Action"},{key:"affectedSource",label:"Source"},{key:"implementationNotes",label:"Implementation notes"},{key:"verificationMethod",label:"Verification"}]))}
${section("Do not change", renderObjects(report.doNotChange, [{key:"area",label:"Area"},{key:"reason",label:"Reason"},{key:"evidence",label:"Evidence"}]))}
${section("Limitations", list(report.limitations))}
</main></body></html>`;
}

export default renderOnBrandReportHtml;
