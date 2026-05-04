import fetch from "node-fetch";

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required for audit workflow dispatch`);
  }
  return value;
}

function githubApiHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

function buildRepoApiBase(owner, repo) {
  return `https://api.github.com/repos/${owner}/${repo}`;
}

function normaliseRef(ref) {
  return String(ref || process.env.AUDIT_WEBSITE_REPO_REF || "main").trim();
}

export function redactWorkflowInputs(inputs = {}) {
  const redacted = {};
  for (const [key, value] of Object.entries(inputs || {})) {
    if (/token|secret|password|api[_-]?key/i.test(key)) {
      redacted[key] = value ? "[configured]" : "";
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

async function readTextSafe(response) {
  return response.text().catch(() => "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function dispatchGithubWorkflow({ workflowId, inputs, ref }) {
  const token = requiredEnv("GITHUB_TOKEN_WEBSITE_AUDITS");
  const owner = requiredEnv("AUDIT_WEBSITE_REPO_OWNER");
  const repo = requiredEnv("AUDIT_WEBSITE_REPO_NAME");
  const effectiveRef = normaliseRef(ref);
  const apiBase = buildRepoApiBase(owner, repo);
  const dispatchedAt = new Date().toISOString();

  const response = await fetch(
    `${apiBase}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`,
    {
      method: "POST",
      headers: githubApiHeaders(token),
      body: JSON.stringify({ ref: effectiveRef, inputs }),
    }
  );

  if (!response.ok) {
    const text = await readTextSafe(response);
    throw new Error(`GitHub workflow dispatch failed (${response.status}): ${text}`);
  }

  return {
    ok: true,
    owner,
    repo,
    ref: effectiveRef,
    workflowId,
    inputs: redactWorkflowInputs(inputs),
    dispatchedAt,
  };
}

export async function verifyGithubWorkflowRun({
  workflowId,
  ref,
  sessionId,
  dispatchedAt,
  maxAttempts = 8,
  delayMs = 3000,
}) {
  const token = requiredEnv("GITHUB_TOKEN_WEBSITE_AUDITS");
  const owner = requiredEnv("AUDIT_WEBSITE_REPO_OWNER");
  const repo = requiredEnv("AUDIT_WEBSITE_REPO_NAME");
  const effectiveRef = normaliseRef(ref);
  const apiBase = buildRepoApiBase(owner, repo);
  const dispatchedAtMs = Number.isNaN(Date.parse(dispatchedAt || ""))
    ? Date.now()
    : Date.parse(dispatchedAt);

  let lastRunSummary = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(
      `${apiBase}/actions/workflows/${encodeURIComponent(workflowId)}/runs?event=workflow_dispatch&branch=${encodeURIComponent(effectiveRef)}&per_page=20`,
      {
        method: "GET",
        headers: githubApiHeaders(token),
      }
    );

    if (!response.ok) {
      const text = await readTextSafe(response);
      throw new Error(`GitHub workflow run lookup failed (${response.status}): ${text}`);
    }

    const payload = await response.json().catch(() => ({}));
    const runs = Array.isArray(payload.workflow_runs) ? payload.workflow_runs : [];

    lastRunSummary = runs.slice(0, 5).map((run) => ({
      id: run.id || null,
      name: run.name || null,
      display_title: run.display_title || null,
      status: run.status || null,
      conclusion: run.conclusion || null,
      created_at: run.created_at || null,
      html_url: run.html_url || null,
      event: run.event || null,
      head_branch: run.head_branch || null,
    }));

    const matchedRun = runs.find((run) => {
      const createdAtMs = Number.isNaN(Date.parse(run.created_at || ""))
        ? 0
        : Date.parse(run.created_at);
      const likelySameDispatch = createdAtMs >= dispatchedAtMs - 60_000;
      const text = [run.display_title, run.name, run.path, run.head_branch]
        .filter(Boolean)
        .join(" ");
      const sessionMatch = sessionId ? text.includes(sessionId) : false;
      return sessionMatch || likelySameDispatch;
    });

    if (matchedRun) {
      return {
        ok: true,
        workflowId,
        runId: matchedRun.id || null,
        workflowRunUrl: matchedRun.html_url || null,
        status: matchedRun.status || null,
        conclusion: matchedRun.conclusion || null,
        createdAt: matchedRun.created_at || null,
        displayTitle: matchedRun.display_title || matchedRun.name || null,
      };
    }

    if (attempt < maxAttempts) {
      await sleep(delayMs);
    }
  }

  throw new Error(
    `GitHub workflow run was not created for ${workflowId} (sessionId=${sessionId || "unknown"}, ref=${effectiveRef}) after dispatch. Recent runs: ${JSON.stringify(lastRunSummary)}`
  );
}

export default dispatchGithubWorkflow;
