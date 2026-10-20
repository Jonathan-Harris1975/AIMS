const UPSTREAM_ORIGIN = "https://zeroth-kara-jonathanharris-3296ed37.koyeb.app";
const CONFIRM_PATH = /^\\/newsletter\\/confirm\\/[A-Za-z0-9_-]{43}$/;
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;

function log(outcome, status, fields = {}) {
  // Confirmation tokens are in the request path, so never log request URLs or paths.
  console.info({
    event: "newsletter_confirm_proxy",
    outcome,
    status,
    ...fields,
  });
}

function healthResponse(request, env) {
  const sourceCommitSha = typeof env?.SOURCE_COMMIT_SHA === "string"
    ? env.SOURCE_COMMIT_SHA.toLowerCase()
    : "";
  const valid = SOURCE_SHA_PATTERN.test(sourceCommitSha);
  const body = JSON.stringify({
    ok: valid,
    service: "newsletter-confirm-proxy",
    source_commit_sha: valid ? sourceCommitSha : null,
  });
  log(valid ? "health_ok" : "health_unattested", valid ? 200 : 503, {
    method: request.method,
  });
  return new Response(request.method === "HEAD" ? null : body, {
    status: valid ? 200 : 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);

    if (incoming.pathname === "/health" && (request.method === "GET" || request.method === "HEAD")) {
      return healthResponse(request, env);
    }

    if (!CONFIRM_PATH.test(incoming.pathname)) {
      log("rejected_path", 404, { method: request.method });
      return new Response("Not found", {
        status: 404,
        headers: { "cache-control": "no-store" },
      });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      log("rejected_method", 405, { method: request.method });
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "GET, HEAD", "cache-control": "no-store" },
      });
    }

    const upstream = new URL(UPSTREAM_ORIGIN);
    upstream.pathname = incoming.pathname;
    upstream.search = incoming.search;

    const headers = new Headers(request.headers);
    headers.delete("host");

    try {
      const response = await fetch(new Request(upstream.href, {
        method: request.method,
        headers,
        redirect: "manual",
      }));
      log("forwarded", response.status, {
        method: request.method,
        upstream_status: response.status,
      });
      return response;
    } catch {
      // Do not log exception text; platform errors can include the confirmation URL.
      log("upstream_error", 502, { method: request.method });
      throw new Error("Newsletter confirmation upstream request failed");
    }
  },
};
