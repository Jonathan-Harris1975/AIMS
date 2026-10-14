const UPSTREAM_ORIGIN = "https://zeroth-kara-jonathanharris-3296ed37.koyeb.app";
const CONFIRM_PATH = /^\/newsletter\/confirm\/[A-Za-z0-9_-]{43}$/;

export default {
  async fetch(request) {
    const incoming = new URL(request.url);

    if (!CONFIRM_PATH.test(incoming.pathname)) {
      return new Response("Not found", {
        status: 404,
        headers: { "cache-control": "no-store" },
      });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
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

    return fetch(new Request(upstream.href, {
      method: request.method,
      headers,
      redirect: "manual",
    }));
  },
};
