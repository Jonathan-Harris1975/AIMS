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



const operationJobs = new Map();

function operationDelayMs(windowName) {
  const isPm = String(windowName || "").endsWith("-pm");
  const envName = isPm ? "AIMS_OPERATION_PM_DELAY_MS" : "AIMS_OPERATION_AM_DELAY_MS";
  const fallback = isPm ? 600_000 : 300_000;
  return Math.max(0, Number(process.env[envName] || fallback));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function operationJobId(windowName) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  return `${date}:${windowName}`;
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    window: job.window,
    status: job.status,
    terminal: ["completed", "completed-with-failures", "failed"].includes(job.status),
    updatedAt: job.updatedAt || job.startedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || null,
    currentTask: job.currentTask || null,
    delayMs: job.delayMs,
    results: job.results,
    failures: job.failures,
  };
}

const OPERATION_WINDOWS = Object.freeze({
  "monday-am": [
    ["rss-rewrite", "/rss/rewrite", { batchSize: 5 }],
    ["outreach", "/outreach/batch/next", {}],
    ["blog-social", "/blog/social/daily/build", {}],
    ["zernio-blog-social", "/zernio/blog-rss/daily", {}],
    ["weekly-blog", "/blog/weekly/build", {}],
    ["newsletter-generate", "/newsletter/generate", { profileId: "ai-edge" }, "newsletter"],
    ["newsletter-send", "/newsletter/send", { profileId: "ai-edge" }, "newsletter"],
    ["zernio-monday", "/zernio/daily/monday", {}],
    ["zernio-ebooks", "/zernio/ebooks/weekly", { dryRun: false, profileName: "Default", accountId: "ALL", usePodcastFeaturedBook: true }, null, true],
    ["zernio-quiz", "/zernio/quiz/weekly", {}],
    ["blotato-am", "/blotato/autoshorts/schedule", {}],
    ["blotato-pm", "/blotato/shorts/news-insight/schedule", {}],
  ],
  "tuesday-am": [
    ["rss-rewrite", "/rss/rewrite", { batchSize: 5 }], ["outreach", "/outreach/batch/next", {}],
    ["blog-social", "/blog/social/daily/build", {}], ["zernio-blog-social", "/zernio/blog-rss/daily", {}],
    ["newsletter-generate", "/newsletter/generate", { profileId: "ai-edge" }, "newsletter"],
    ["newsletter-send", "/newsletter/send", { profileId: "ai-edge" }, "newsletter"],
    ["zernio-tuesday", "/zernio/daily/tuesday", {}],
    ["blotato-am", "/blotato/autoshorts/schedule", {}],
    ["blotato-pm", "/blotato/shorts/model-verdict/schedule", {}],
  ],
  "wednesday-am": [
    ["rss-rewrite", "/rss/rewrite", { batchSize: 5 }], ["outreach", "/outreach/batch/next", {}],
    ["blog-social", "/blog/social/daily/build", {}], ["zernio-blog-social", "/zernio/blog-rss/daily", {}],
    ["newsletter-generate", "/newsletter/generate", { profileId: "ai-edge" }, "newsletter"],
    ["newsletter-send", "/newsletter/send", { profileId: "ai-edge" }, "newsletter"],
    ["zernio-wednesday", "/zernio/daily/wednesday", {}],
    ["blotato-am", "/blotato/autoshorts/schedule", {}],
    ["blotato-pm", "/blotato/shorts/ai-at-work/schedule", {}],
  ],
  "thursday-am": [
    ["rss-rewrite", "/rss/rewrite", { batchSize: 5 }], ["outreach", "/outreach/batch/next", {}],
    ["blog-social", "/blog/social/daily/build", {}], ["zernio-blog-social", "/zernio/blog-rss/daily", {}],
    ["newsletter-generate", "/newsletter/generate", { profileId: "ai-edge" }, "newsletter"],
    ["newsletter-send", "/newsletter/send", { profileId: "ai-edge" }, "newsletter"],
    ["zernio-thursday", "/zernio/daily/thursday", {}],
    ["blotato-am", "/blotato/autoshorts/schedule", {}],
    ["blotato-pm", "/blotato/shorts/reality-check/schedule", {}],
  ],
  "friday-am": [
    ["rss-rewrite", "/rss/rewrite", { batchSize: 5 }], ["outreach", "/outreach/batch/next", {}],
    ["blog-social", "/blog/social/daily/build", {}], ["zernio-blog-social", "/zernio/blog-rss/daily", {}],
    ["newsletter-generate", "/newsletter/generate", { profileId: "ai-edge" }, "newsletter"],
    ["newsletter-send", "/newsletter/send", { profileId: "ai-edge" }, "newsletter"],
    ["zernio-friday", "/zernio/daily/friday", {}],
    ["zernio-saturday", "/zernio/daily/saturday", {}],
    ["zernio-sunday", "/zernio/daily/sunday", {}],
    ["blotato-am", "/blotato/autoshorts/schedule", {}],
    ["blotato-pm", "/blotato/shorts/ai-playbook/schedule", {}],
  ],
  "friday-pm": [["podcast", "/podcast/run", {}]],
});

function assertContentOperationWindows() {
  const weekdayWindows = ["monday-am", "tuesday-am", "wednesday-am", "thursday-am", "friday-am"];
  for (const windowName of weekdayWindows) {
    const tasks = OPERATION_WINDOWS[windowName] || [];
    const paths = tasks.map((task) => task[1]);
    const blogBuildIndex = paths.indexOf("/blog/social/daily/build");
    const zernioBlogIndex = paths.indexOf("/zernio/blog-rss/daily");
    if (blogBuildIndex < 0 || zernioBlogIndex !== blogBuildIndex + 1) {
      throw new Error(`${windowName} must run /zernio/blog-rss/daily immediately after /blog/social/daily/build`);
    }
  }

  const mondayPaths = OPERATION_WINDOWS["monday-am"].map((task) => task[1]);
  for (const required of ["/zernio/daily/monday", "/zernio/ebooks/weekly", "/zernio/quiz/weekly"]) {
    if (!mondayPaths.includes(required)) throw new Error(`monday-am missing required content task ${required}`);
  }

  const thursdayPaths = OPERATION_WINDOWS["thursday-am"].map((task) => task[1]);
  if (!thursdayPaths.includes("/zernio/daily/thursday")) throw new Error("thursday-am missing Zernio Thursday lane/podcast promo trigger");

  const fridayAmPaths = OPERATION_WINDOWS["friday-am"].map((task) => task[1]);
  for (const required of ["/zernio/daily/saturday", "/zernio/daily/sunday", "/blotato/shorts/ai-playbook/schedule"]) {
    if (!fridayAmPaths.includes(required)) throw new Error(`friday-am missing required scheduled-content task ${required}`);
  }

  const fridayPmPaths = OPERATION_WINDOWS["friday-pm"].map((task) => task[1]);
  if (fridayPmPaths.length !== 1 || fridayPmPaths[0] !== "/podcast/run") {
    throw new Error("friday-pm must contain only /podcast/run");
  }
}

assertContentOperationWindows();

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
  res.json({ ok: true, service: "ops", newsletterEnabled: operationNewsletterEnabled(), windows: Object.fromEntries(Object.entries(OPERATION_WINDOWS).map(([key, tasks]) => [key, { delayMs: operationDelayMs(key), tasks: tasks.map(([name, path, _body, feature]) => ({ name, path, enabled: feature !== "newsletter" || operationNewsletterEnabled() })) }])) });
});

async function executeOperationWindow(job, tasks, req) {
  job.status = "running";
  job.updatedAt = new Date().toISOString();
  for (let index = 0; index < tasks.length; index += 1) {
    if (index > 0 && job.delayMs > 0) {
      job.currentTask = { name: "delay", before: tasks[index][0], delayMs: job.delayMs };
      job.updatedAt = new Date().toISOString();
      await sleep(job.delayMs);
    }
    job.currentTask = { name: tasks[index][0], path: tasks[index][1], index: index + 1, total: tasks.length };
    job.updatedAt = new Date().toISOString();
    const result = await runInternalTask(tasks[index], req);
    job.results.push(result);
    job.updatedAt = new Date().toISOString();
    if (!result.ok) job.failures += 1;
  }
  job.currentTask = null;
  job.finishedAt = new Date().toISOString();
  job.updatedAt = job.finishedAt;
  job.status = job.failures ? "completed-with-failures" : "completed";
}

router.post("/run/:window", async (req, res, next) => {
  try {
    const windowName = normalise(req.params.window).toLowerCase();
    const tasks = OPERATION_WINDOWS[windowName];
    if (!tasks) return res.status(404).json({ ok: false, error: "unknown-operation-window", window: windowName, available: Object.keys(OPERATION_WINDOWS) });

    const id = operationJobId(windowName);
    const existing = operationJobs.get(id);
    if (existing && ["accepted", "running"].includes(existing.status)) {
      return res.status(202).json({ ok: true, service: "ops", duplicatePrevented: true, job: publicJob(existing) });
    }

    const job = {
      id,
      window: windowName,
      status: "accepted",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: null,
      currentTask: null,
      delayMs: operationDelayMs(windowName),
      results: [],
      failures: 0,
    };
    operationJobs.set(id, job);

    void executeOperationWindow(job, tasks, req).catch((error) => {
      job.status = "failed";
      job.finishedAt = new Date().toISOString();
      job.updatedAt = job.finishedAt;
      job.currentTask = null;
      job.failures += 1;
      job.results.push({ name: "operation-window", ok: false, error: error?.message || String(error) });
    });

    return res.status(202).json({
      ok: true,
      accepted: true,
      service: "ops",
      window: windowName,
      newsletterEnabled: operationNewsletterEnabled(),
      statusUrl: `/ops/jobs/${encodeURIComponent(job.id)}`,
      job: publicJob(job),
    });
  } catch (error) { next(error); }
});

router.get("/jobs/:id", (req, res) => {
  const job = operationJobs.get(normalise(req.params.id));
  if (!job) return res.status(404).json({ ok: false, error: "operation-job-not-found" });
  return res.json({ ok: true, service: "ops", job: publicJob(job) });
});

router.get("/health", sendStage("health"));
router.get("/preflight", sendStage("preflight"));
router.get("/warmup", sendStage("warmup"));
router.get("/excellence", (_req, res) => {
  res.status(200).json({ ok: true, ...getOperationalExcellenceSnapshot() });
});

export default router;
