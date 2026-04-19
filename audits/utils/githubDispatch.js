import fetch from "node-fetch";

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required for audit workflow dispatch`);
  }
  return value;
}

export async function dispatchGithubWorkflow({ workflowId, inputs, ref }) {
  const token = requiredEnv("GITHUB_TOKEN_WEBSITE_AUDITS");
  const owner = requiredEnv("AUDIT_WEBSITE_REPO_OWNER");
  const repo = requiredEnv("AUDIT_WEBSITE_REPO_NAME");
  const effectiveRef = String(ref || process.env.AUDIT_WEBSITE_REPO_REF || "main").trim();

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: effectiveRef, inputs }),
    }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`GitHub workflow dispatch failed (${response.status}): ${text}`);
  }

  return {
    ok: true,
    owner,
    repo,
    ref: effectiveRef,
    workflowId,
    inputs,
  };
}

export default dispatchGithubWorkflow;
