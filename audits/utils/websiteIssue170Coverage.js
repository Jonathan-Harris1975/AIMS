import { getWebsiteAuditPolicy } from "./websiteAuditPolicy.js";

const ISSUE_URL = "https://github.com/Jonathan-Harris1975/jonathan-harris-website/issues/170";
const ISSUE_API = "https://api.github.com/repos/Jonathan-Harris1975/jonathan-harris-website/issues/170";
const SITE = "https://jonathan-harris.online";
const VALID_STATUSES = new Set(["passed", "failed", "not_verified"]);

function clean(value) {
  return String(value || "").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function extractIssue170Checklist(body) {
  return String(body || "").split(/\r?\n/).flatMap((line) => {
    const match = /^\s*-\s*\[([ xX])\]\s+(.+?)\s*$/.exec(line);
    return match ? [{ checked: match[1].toLowerCase() === "x", title: match[2].trim().slice(0, 600) }] : [];
  });
}

async function fetchIssue170(fetchImpl, token) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "aims-monthly-website-audit", "X-GitHub-Api-Version": "2022-11-28" };
  if (token) headers.Authorization = "Bearer " + token;
  const response = await fetchImpl(ISSUE_API, { headers, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error("github-issue-http-" + response.status);
  const payload = await response.json();
  if (payload?.number !== 170 || typeof payload.body !== "string") throw new Error("github-issue-invalid");
  return { checked: extractIssue170Checklist(payload.body), state: payload.state, updatedAt: payload.updated_at || null };
}

async function probeR2Sitemap(fetchImpl) {
  const options = { headers: { Accept: "application/json, application/xml" }, signal: AbortSignal.timeout(12000) };
  const [manifestResponse, sitemapResponse] = await Promise.all([
    fetchImpl(SITE + "/blog/posts.json", options),
    fetchImpl(SITE + "/sitemap.xml", options),
  ]);
  if (!manifestResponse.ok || !sitemapResponse.ok) return { status: "failed", reason: "Live R2 blog manifest or sitemap returned non-200", evidence: [] };
  if (manifestResponse.headers.get("x-blog-manifest-source") !== "r2") {
    return { status: "not_verified", reason: "Blog manifest R2 source was not verified", evidence: [] };
  }
  const manifest = await manifestResponse.json();
  const xml = await sitemapResponse.text();
  const items = manifest?.items;
  if (!Array.isArray(items)) return { status: "failed", reason: "R2 manifest has no valid items array", evidence: [] };
  if (items.length > 5000) return { status: "not_verified", reason: "Sitemap manifest exceeded safe audit item limit", evidence: [] };
  const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((match) => match[1].trim());
  const seen = new Set(locs);
  if (seen.size !== locs.length || !xml.includes("</urlset>")) {
    return { status: "failed", reason: "Sitemap XML has duplicates or lacks closing urlset", evidence: [] };
  }
  const slugs = items.map((row) => row?.slug);
  if (slugs.some((slug) => typeof slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
      || new Set(slugs).size !== slugs.length) {
    return { status: "failed", reason: "R2 manifest contains missing, invalid or duplicate slugs", evidence: [] };
  }
  const expected = slugs.map((slug) => SITE + "/blog/posts/" + slug + "/");
  const missing = expected.filter((url) => !seen.has(url));
  if (missing.length) {
    return { status: "failed", reason: missing.length + " of " + items.length + " R2 blog articles absent from live sitemap", evidence: [SITE + "/sitemap.xml", SITE + "/blog/posts.json"] };
  }
  if (sitemapResponse.headers.get("x-blog-sitemap-source") !== "r2"
      || Number(sitemapResponse.headers.get("x-blog-posts-in-sitemap")) !== items.length) {
    return { status: "failed", reason: "Sitemap runtime has not confirmed R2 manifest parity", evidence: [SITE + "/sitemap.xml"] };
  }
  return {
    status: "passed",
    reason: "Verified " + items.length + " R2 blog posts in live canonical sitemap (" + locs.length + " unique URLs)",
    evidence: [SITE + "/sitemap.xml", SITE + "/blog/posts.json"],
  };
}

function stageEvidence(row, stageReports = {}) {
  const proof = [];
  for (const source of row.evidenceSources || []) {
    const stage = stageReports[source];
    if (!stage || typeof stage !== "object") continue;
    const url = stage.reportJsonUrl;
    if (typeof url === "string" && url.trim()) proof.push(url.trim());
  }
  return [...new Set(proof)];
}

function explicitAttestation(row, stageReports = {}) {
  for (const source of row.evidenceSources || []) {
    const stage = stageReports[source];
    if (!stage || String(stage.status).toLowerCase() !== "completed"
        || stage.requiredArtifactSetReady !== true || stage.reportJsonLoaded !== true) continue;
    const entries = Array.isArray(stage.acceptanceEvidence) ? stage.acceptanceEvidence : [];
    const evidence = entries.find((entry) => entry?.id === row.id);
    if (!evidence || !VALID_STATUSES.has(evidence.status)) continue;
    // A stage score or model-written summary is not acceptance proof. Require an exact
    // revision, contemporaneous verification time, and a retained audit artefact.
    if (!/^[a-f0-9]{40}$/.test(evidence.sourceRevisionSha || "")
        || !Number.isFinite(Date.parse(evidence.verifiedAt || ""))
        || typeof evidence.artifactUrl !== "string" || !evidence.artifactUrl.startsWith("r2://audits/")) continue;
    return { status: evidence.status, reason: evidence.summary || "Explicit deterministic source attestation", evidence: [evidence.artifactUrl] };
  }
  return null;
}

export async function buildWebsiteIssue170Coverage({
  stageReports = {},
  fetchImpl = fetch,
  githubToken = process.env.GITHUB_TOKEN_WEBSITE_AUDITS || "",
  now = new Date(),
} = {}) {
  const definitions = getWebsiteAuditPolicy().issue170Acceptance.rules;
  const results = await Promise.allSettled([
    fetchIssue170(fetchImpl, githubToken),
    probeR2Sitemap(fetchImpl),
  ]);
  const issue = results[0].status === "fulfilled" ? results[0].value : null;
  const sitemap = results[1].status === "fulfilled" ? results[1].value : null;
  const issueChecklist = issue?.checked || [];
  const mapped = new Set();
  const rows = definitions.map((definition) => {
    const match = definition.issueAnchor
      ? issueChecklist.find((item, index) => {
        if (clean(item.title).includes(clean(definition.issueAnchor))) { mapped.add(index); return true; }
        return false;
      }) : null;
    let status = "not_verified";
    let reason = "Full acceptance evidence has not been supplied by the required audit sources.";
    let proof = stageEvidence(definition, stageReports);
    const attestation = explicitAttestation(definition, stageReports);
    if (attestation) { status = attestation.status; reason = attestation.reason; proof = [...proof, ...attestation.evidence]; }
    if (definition.id === "W170-12") {
      status = sitemap?.status || "not_verified";
      reason = sitemap?.reason || "Live sitemap and R2 comparison unavailable in this run.";
      proof = [...proof, ...(sitemap?.evidence || [])];
    }
    if (definition.issueAnchor && !match) {
      status = "not_verified";
      reason = "Issue #170 checklist item not confirmed in the live GitHub source; audit must resynchronise.";
    }
    return {
      id: definition.id, title: definition.title, status, reason,
      owner: definition.owner, evidenceSources: definition.evidenceSources,
      acceptanceCriterion: definition.acceptance, evidence: [...new Set(proof)],
      githubCheckboxChecked: match ? match.checked : null,
      sourceIssue: ISSUE_URL,
    };
  });
  for (let index = 0; index < issueChecklist.length; index += 1) {
    if (mapped.has(index)) continue;
    const item = issueChecklist[index];
    rows.push({
      id: "W170-UNMAPPED-" + String(index + 1).padStart(2, "0"),
      title: clean(item.title).slice(0, 200),
      status: "not_verified",
      reason: "A new or altered issue #170 checklist item has no audited evidence mapping; update the acceptance policy.",
      owner: "Website audit governance", evidenceSources: [], acceptanceCriterion: "Create a verified evidence mapping and rerun this requirement.",
      evidence: [], githubCheckboxChecked: item.checked, sourceIssue: ISSUE_URL,
    });
  }
  if (!issue) rows.push({
    id: "W170-SYNC", title: "Live GitHub issue #170 checklist synchronisation",
    status: "not_verified", reason: "The live issue checklist could not be fetched; do not certify coverage from a stale local policy.",
    owner: "Website audit governance", evidenceSources: [], acceptanceCriterion: "Fetch and map all issue #170 checklist entries from GitHub.",
    evidence: [], githubCheckboxChecked: null, sourceIssue: ISSUE_URL,
  });
  const passed = rows.filter((row) => row.status === "passed").length;
  const failed = rows.filter((row) => row.status === "failed").length;
  const notVerified = rows.filter((row) => row.status === "not_verified").length;
  return {
    schemaVersion: "website-issue-170-coverage/v1", sourceIssue: ISSUE_URL,
    checkedAt: now.toISOString(), liveIssueSynced: Boolean(issue),
    issueUpdatedAt: issue?.updatedAt || null,
    checklistItemsOnIssue: issueChecklist.length,
    requiredCount: rows.length, passed, failed, notVerified,
    acceptanceComplete: Boolean(issue) && rows.length > 0 && passed === rows.length,
    rows,
  };
}

export function issue170CoverageLedger(coverage) {
  return (coverage?.rows || []).filter((row) => row.status !== "passed").map((row) => ({
    findingId: row.id,
    title: "Issue #170 acceptance: " + row.title,
    rootCause: row.reason,
    severity: row.status === "failed" ? "High" : "Medium",
    confidence: row.status === "failed" ? "Confirmed" : "Needs Verification",
    classification: "manual_review",
    fixClass: "",
    affected: [row.sourceIssue],
    affectedPaths: [],
    evidence: [row.sourceIssue, ...row.evidence],
    exactRemediation: "Collect the specified acceptance evidence from " + row.evidenceSources.join(", ")
      + " and verify this requirement. Determine root cause and file paths before authorising any code fix.",
    expectedGain: "Verifiable closure of website acceptance requirement " + row.id,
    effort: "Medium Lift", owner: row.owner,
    acceptanceCriterion: row.acceptanceCriterion,
    verificationMethod: "Rerun monthly website acceptance and verify issue #170 source plus retained audit artefacts.",
    sourceFindingIds: [row.id],
  }));
}
