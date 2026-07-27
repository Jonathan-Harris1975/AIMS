import express from "express";
import { getOperationalExcellenceSnapshot } from "../shared/utils/operationalExcellence.js";

const router = express.Router();

function normalise(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function booleanEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return ["1", "true", "yes", "y", "on"].includes(String(raw).trim().toLowerCase());
}

function envPresent(name) {
  const value = normalise(process.env[name]);
  if (!value) return false;
  return !/^\{\{\s*secret\.[^}]+\}\}$/i.test(value);
}

function requestMeta(req, stage) {
  return {
    stage,
    service: normalise(req.query.service) || "suite",
    sourceJob: normalise(req.query.sourceJob) || normalise(req.get?.("x-trigger-source-job")) || null,
    sourceGroup: normalise(req.query.sourceGroup) || null,
    targetPath: normalise(req.query.targetPath) || normalise(req.get?.("x-trigger-source-path")) || null,
    offsetMinutes: normalise(req.query.offsetMinutes) || normalise(req.get?.("x-trigger-offset-minutes")) || null,
    deep: booleanEnvFromValue(req.query.deep, false),
  };
}

function booleanEnvFromValue(value, fallback = false) {
  const raw = normalise(value);
  if (!raw) return fallback;
  return ["1", "true", "yes", "y", "on"].includes(raw.toLowerCase());
}

const SERVICE_ENV_HINTS = {
  zernio: ["ZERNIO_META_API_KEY"],
  blotato: ["BLOTATO_API_KEY"],
  audits: ["R2_BUCKET_AUDITS", "R2_PUBLIC_BASE_URL_AUDITS"],
  podcast: ["R2_BUCKET_PODCAST"],
  rss: ["R2_BUCKET_RAW_TEXT"],
  blog: ["R2_BUCKET_BLOG"],
  outreach: [],
};

function buildChecks(meta) {
  const envNames = SERVICE_ENV_HINTS[meta.service] || [];
  const checks = [
    { name: "process", ok: true, detail: "AIMS process is responding." },
    { name: "targetPath", ok: Boolean(meta.targetPath), detail: meta.targetPath || "No target path supplied by scheduler." },
  ];

  for (const name of envNames) {
    checks.push({
      name: `env:${name}`,
      ok: envPresent(name),
      detail: envPresent(name) ? "configured" : "missing-or-placeholder",
    });
  }

  return checks;
}

function responseFor(req, stage) {
  const meta = requestMeta(req, stage);
  const checks = buildChecks(meta);
  const strict = booleanEnv("AIMS_OPS_PREFLIGHT_STRICT", false);
  const requiredOk = checks.every((check) => check.ok);

  return {
    statusCode: strict && !requiredOk ? 503 : 200,
    body: {
      ok: strict ? requiredOk : true,
      strict,
      service: "ops",
      checkedService: meta.service,
      stage,
      readiness: requiredOk ? "ready" : "ready-with-warnings",
      sourceJob: meta.sourceJob,
      sourceGroup: meta.sourceGroup,
      targetPath: meta.targetPath,
      offsetMinutes: meta.offsetMinutes,
      deep: meta.deep,
      checks,
      time: new Date().toISOString(),
    },
  };
}

function sendStage(stage) {
  return (req, res) => {
    const response = responseFor(req, stage);
    res.status(response.statusCode).json(response.body);
  };
}


const OPERATION_WINDOWS = Object.freeze({
  "monday-am": [
    ["rss-rewrite", "/rss/rewrite", { batchSize: 5 }],
    ["outreach", "/outreach/batch/next", {}],
    ["blog-social", "/blog/social/daily/build", {}],
    ["weekly-blog", "/blog/weekly/build", {}],
    ["newsletter-generate", "/newsletter/generate", { profileId: "ai-edge" }, "newsletter"],
    ["newsletter-send", "/newsletter/send", { profileId: "ai-edge" }, "newsletter"],
    ["zernio-monday", "/zernio/daily/monday", {}],
    ["zernio-ebooks", "/zernio/ebooks/weekly", { dryRun: false, profileName: "Default", accountId: "ALL", usePodcastFeaturedBook: true }, null, true],
    ["zernio-quiz", "/zernio/quiz/weekly", {}],
    ["blotato-autoshorts", "/blotato/autoshorts/publish-now", {}],
  ],
  "tuesday-am": [
    ["rss-rewrite", "/rss/rewrite", { batchSize: 5 }], ["outreach", "/outreach/batch/next", {}],
    ["blog-social", "/blog/social/daily/build", {}], ["newsletter-generate", "/newsletter/generate", { profileId: "ai-edge" }, "newsletter"],
    ["newsletter-send", "/newsletter/send", { profileId: "ai-edge" }, "newsletter"], ["zernio-tuesday", "/zernio/daily/tuesday", {}],
    ["blotato-autoshorts", "/blotato/autoshorts/publish-now", {}],
  ],
  "wednesday-am": [
    ["rss-rewrite", "/rss/rewrite", { batchSize: 5 }], ["outreach", "/outreach/batch/next", {}],
    ["blog-social", "/blog/social/daily/build", {}], ["newsletter-generate", "/newsletter/generate", { profileId: "ai-edge" }, "newsletter"],
    ["newsletter-send", "/newsletter/send", { profileId: "ai-edge" }, "newsletter"], ["zernio-wednesday", "/zernio/daily/wednesday", {}],
    ["blotato-autoshorts", "/blotato/autoshorts/publish-now", {}],
  ],
  "thursday-am": [
    ["rss-rewrite", "/rss/rewrite", { batchSize: 5 }], ["outreach", "/outreach/batch/next", {}],
    ["blog-social", "/blog/social/daily/build", {}], ["newsletter-generate", "/newsletter/generate", { profileId: "ai-edge" }, "newsletter"],
    ["newsletter-send", "/newsletter/send", { profileId: "ai-edge" }, "newsletter"], ["zernio-thursday", "/zernio/daily/thursday", {}],
    ["blotato-autoshorts", "/blotato/autoshorts/publish-now", {}],
  ],
  "friday-am": [
    ["rss-rewrite", "/rss/rewrite", { batchSize: 5 }], ["outreach", "/outreach/batch/next", {}],
    ["blog-social", "/blog/social/daily/build", {}], ["newsletter-generate", "/newsletter/generate", { profileId: "ai-edge" }, "newsletter"],
    ["newsletter-send", "/newsletter/send", { profileId: "ai-edge" }, "newsletter"], ["zernio-friday", "/zernio/daily/friday", {}],
    ["blotato-autoshorts", "/blotato/autoshorts/publish-now", {}],
  ],
  "monday-pm": [["blotato-evening", "/blotato/shorts/news-insight/publish-now", {}]],
  "tuesday-pm": [["blotato-evening", "/blotato/shorts/model-verdict/publish-now", {}]],
  "wednesday-pm": [["blotato-evening", "/blotato/shorts/ai-at-work/publish-now", {}]],
  "thursday-pm": [["blotato-evening", "/blotato/shorts/reality-check/publish-now", {}]],
  "friday-pm": [
    ["blotato-evening", "/blotato/shorts/ai-playbook/publish-now", {}],
    ["podcast", "/podcast/run", {}],
    ["zernio-saturday", "/zernio/daily/saturday", {}],
    ["zernio-sunday", "/zernio/daily/sunday", {}],
  ],
});

function operationNewsletterEnabled() {
  return booleanEnv("AIMS_OPERATION_NEWSLETTER_ENABLED", false);
}

function localWeekStartDate() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

async function runInternalTask([name, path, body = {}, feature = null, addWeekStartDate = false], req) {
  if (feature === "newsletter" && !operationNewsletterEnabled()) {
    return { name, path, ok: true, skipped: true, reason: "newsletter-disabled-until-brevo-ready" };
  }

  const base = normalise(process.env.AIMS_INTERNAL_BASE_URL) || `http://127.0.0.1:${process.env.PORT || 8000}`;
  const token = normalise(process.env.AIMS_API_KEY) || normalise(req.get?.("authorization")).replace(/^Bearer\s+/i, "");
  const payload = { ...body };
  if (addWeekStartDate) payload.weekStartDate = localWeekStartDate();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(30_000, Number(process.env.AIMS_OPERATION_TASK_TIMEOUT_MS || 900_000)));
  try {
    const response = await fetch(`${base.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let result = null;
    try { result = text ? JSON.parse(text) : null; } catch { result = text.slice(0, 1000); }
    return { name, path, ok: response.ok, status: response.status, result };
  } catch (error) {
    return { name, path, ok: false, error: error?.name === "AbortError" ? "operation-task-timeout" : (error?.message || String(error)) };
  } finally {
    clearTimeout(timeout);
  }
}

router.get("/windows", (_req, res) => {
  res.json({ ok: true, service: "ops", newsletterEnabled: operationNewsletterEnabled(), windows: Object.fromEntries(Object.entries(OPERATION_WINDOWS).map(([key, tasks]) => [key, tasks.map(([name, path, _body, feature]) => ({ name, path, enabled: feature !== "newsletter" || operationNewsletterEnabled() }))])) });
});

router.post("/run/:window", async (req, res, next) => {
  try {
    const windowName = normalise(req.params.window).toLowerCase();
    const tasks = OPERATION_WINDOWS[windowName];
    if (!tasks) return res.status(404).json({ ok: false, error: "unknown-operation-window", window: windowName, available: Object.keys(OPERATION_WINDOWS) });
    const startedAt = new Date().toISOString();
    const results = [];
    for (const task of tasks) results.push(await runInternalTask(task, req));
    const failures = results.filter((item) => !item.ok);
    return res.status(failures.length ? 207 : 200).json({ ok: failures.length === 0, service: "ops", window: windowName, startedAt, finishedAt: new Date().toISOString(), newsletterEnabled: operationNewsletterEnabled(), results, failures: failures.length });
  } catch (error) { next(error); }
});

router.get("/health", sendStage("health"));
router.get("/preflight", sendStage("preflight"));
router.get("/warmup", sendStage("warmup"));
router.get("/excellence", (_req, res) => {
  res.status(200).json({ ok: true, ...getOperationalExcellenceSnapshot() });
});

export default router;
