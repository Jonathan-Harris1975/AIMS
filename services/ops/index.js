import crypto from "node:crypto";
import express from "express";
import { getOperationalExcellenceSnapshot } from "../shared/utils/operationalExcellence.js";
import { extractAsyncStatusUrl, waitForAsyncOperation } from "./asyncOperation.js";
import { getWebsiteAuditReadiness } from "../../audits/utils/websiteAuditReadiness.js";

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
  audits: ["R2_BUCKET_AUDITS"],
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

  if (meta.service === "audits" && meta.targetPath === "/audits/website/run") {
    const readiness = getWebsiteAuditReadiness();
    checks.push(...readiness.checks.map((item) => ({
      name: `website-audit:${item.name}`,
      ok: item.ok,
      detail: item.ok ? "configured" : item.detail,
    })));
  }

  return checks;
}

function responseFor(req, stage) {
  const meta = requestMeta(req, stage);
  const checks = buildChecks(meta);
  const configuredStrict = booleanEnv("AIMS_OPS_PREFLIGHT_STRICT", false);
  const websiteAuditStrict = meta.service === "audits" && meta.targetPath === "/audits/website/run";
  const strict = configuredStrict || websiteAuditStrict;
  const requiredOk = checks.every((check) => check.ok);

  return {
    statusCode: strict && !requiredOk ? 503 : 200,
    body: {
      ok: strict ? requiredOk : true,
      strict,
      strictReason: websiteAuditStrict ? "website-audit-contract" : (configuredStrict ? "environment" : "warning-only"),
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
  const name = String(windowName || "").trim().toLowerCase();
  if (name === "friday-pm") {
    return Math.max(0, Number(process.env.AIMS_OPERATION_FRIDAY_PM_DELAY_MS || 0));
  }
  const isPm = name.endsWith("-pm");
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
    executionId: job.executionId || null,
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
    ["blotato-am", "/blotato/autoshorts/schedule", {}, null, false, "rss-rewrite"],
    ["zernio-monday", "/zernio/daily/monday", {}, null, false, "rss-rewrite"],
    ["blog-social", "/blog/social/daily/build", {}, null, false, "rss-rewrite"],
    ["zernio-blog-social", "/zernio/blog-rss/daily", {}, null, false, "blog-social"],
    ["blotato-pm", "/blotato/shorts/news-insight/schedule", {}, null, false, "blotato-am"],
    ["newsletter-generate", "/newsletter/generate", { profileId: "ai-edge" }, "newsletter", false, "rss-rewrite"],
    ["newsletter-send", "/newsletter/send", { profileId: "ai-edge" }, "newsletter", false, "newsletter-generate"],
    ["weekly-blog", "/blog/weekly/build", {}, null, false, "rss-rewrite"],
    ["outreach", "/outreach/batch/next", {}],
    ["zernio-ebooks", "/zernio/ebooks/weekly", { dryRun: false, profileName: "Default", accountId: "ALL", usePodcastFeaturedBook: true }, null, true, "rss-rewrite"],
    ["zernio-quiz", "/zernio/quiz/weekly", {}, null, false, "rss-rewrite"],
  ],
  "tuesday-am": [
    ["rss-rewrite", "/rss/rewrite", { batchSize: 5 }],
    ["blotato-am", "/blotato/autoshorts/schedule", {}, null, false, "rss-rewrite"],
    ["zernio-tuesday", "/zernio/daily/tuesday", {}, null, false, "rss-rewrite"],
    ["blog-social", "/blog/social/daily/build", {}, null, false, "rss-rewrite"],
    ["zernio-blog-social", "/zernio/blog-rss/daily", {}, null, false, "blog-social"],
    ["blotato-pm", "/blotato/shorts/model-verdict/schedule", {}, null, false, "blotato-am"],
    ["newsletter-generate", "/newsletter/generate", { profileId: "ai-edge" }, "newsletter", false, "rss-rewrite"],
    ["newsletter-send", "/newsletter/send", { profileId: "ai-edge" }, "newsletter", false, "newsletter-generate"],
    ["outreach", "/outreach/batch/next", {}],
  ],
  "wednesday-am": [
    ["rss-rewrite", "/rss/rewrite", { batchSize: 5 }],
    ["blotato-am", "/blotato/autoshorts/schedule", {}, null, false, "rss-rewrite"],
    ["zernio-wednesday", "/zernio/daily/wednesday", {}, null, false, "rss-rewrite"],
    ["blog-social", "/blog/social/daily/build", {}, null, false, "rss-rewrite"],
    ["zernio-blog-social", "/zernio/blog-rss/daily", {}, null, false, "blog-social"],
    ["blotato-pm", "/blotato/shorts/ai-at-work/schedule", {}, null, false, "blotato-am"],
    ["newsletter-generate", "/newsletter/generate", { profileId: "ai-edge" }, "newsletter", false, "rss-rewrite"],
    ["newsletter-send", "/newsletter/send", { profileId: "ai-edge" }, "newsletter", false, "newsletter-generate"],
    ["outreach", "/outreach/batch/next", {}],
  ],
  "thursday-am": [
    ["rss-rewrite", "/rss/rewrite", { batchSize: 5 }],
    ["blotato-am", "/blotato/autoshorts/schedule", {}, null, false, "rss-rewrite"],
    ["zernio-thursday", "/zernio/daily/thursday", {}, null, false, "rss-rewrite"],
    ["blog-social", "/blog/social/daily/build", {}, null, false, "rss-rewrite"],
    ["zernio-blog-social", "/zernio/blog-rss/daily", {}, null, false, "blog-social"],
    ["blotato-pm", "/blotato/shorts/reality-check/schedule", {}, null, false, "blotato-am"],
    ["newsletter-generate", "/newsletter/generate", { profileId: "ai-edge" }, "newsletter", false, "rss-rewrite"],
    ["newsletter-send", "/newsletter/send", { profileId: "ai-edge" }, "newsletter", false, "newsletter-generate"],
    ["outreach", "/outreach/batch/next", {}],
  ],
  "friday-am": [
    ["rss-rewrite", "/rss/rewrite", { batchSize: 5 }],
    ["blotato-am", "/blotato/autoshorts/schedule", {}, null, false, "rss-rewrite"],
    ["zernio-friday", "/zernio/daily/friday", {}, null, false, "rss-rewrite"],
    ["zernio-saturday", "/zernio/daily/saturday", {}, null, false, "rss-rewrite"],
    ["zernio-sunday", "/zernio/daily/sunday", {}, null, false, "rss-rewrite"],
    ["blog-social", "/blog/social/daily/build", {}, null, false, "rss-rewrite"],
    ["zernio-blog-social", "/zernio/blog-rss/daily", {}, null, false, "blog-social"],
    ["blotato-pm", "/blotato/shorts/ai-playbook/schedule", {}, null, false, "blotato-am"],
    ["newsletter-generate", "/newsletter/generate", { profileId: "ai-edge" }, "newsletter", false, "rss-rewrite"],
    ["newsletter-send", "/newsletter/send", { profileId: "ai-edge" }, "newsletter", false, "newsletter-generate"],
    ["outreach", "/outreach/batch/next", {}],
  ],
  "friday-pm": [
    ["podcast-readiness", "/podcast/readiness", {}],
    ["podcast", "/podcast/run", {}, null, false, "podcast-readiness"],
  ],
});

function assertContentOperationWindows() {
  for (const [windowName, tasks] of Object.entries(OPERATION_WINDOWS)) {
    const names = tasks.map((task) => task[0]);
    const paths = tasks.map((task) => task[1]);
    if (new Set(names).size !== names.length) {
      throw new Error(`${windowName} contains duplicate task names`);
    }
    if (new Set(paths).size !== paths.length) {
      throw new Error(`${windowName} contains duplicate task paths`);
    }
  }

  const weekdayWindows = ["monday-am", "tuesday-am", "wednesday-am", "thursday-am", "friday-am"];
  for (const windowName of weekdayWindows) {
    const tasks = OPERATION_WINDOWS[windowName] || [];
    const paths = tasks.map((task) => task[1]);
    const blogBuildIndex = paths.indexOf("/blog/social/daily/build");
    const zernioBlogIndex = paths.indexOf("/zernio/blog-rss/daily");
    if (blogBuildIndex < 0 || zernioBlogIndex !== blogBuildIndex + 1) {
      throw new Error(`${windowName} must run /zernio/blog-rss/daily immediately after /blog/social/daily/build`);
    }
    if (tasks[blogBuildIndex]?.[5] !== "rss-rewrite") {
      throw new Error(`${windowName} blog-social build must depend on rss-rewrite`);
    }
    if (tasks[zernioBlogIndex]?.[5] !== "blog-social") {
      throw new Error(`${windowName} Zernio blog handoff must depend on blog-social`);
    }

    const blotatoAmTask = tasks.find((task) => task[0] === "blotato-am");
    const blotatoPmTask = tasks.find((task) => task[0] === "blotato-pm");
    if (blotatoAmTask?.[5] !== "rss-rewrite") {
      throw new Error(`${windowName} blotato-am must depend on rss-rewrite`);
    }
    if (blotatoPmTask?.[5] !== "blotato-am") {
      throw new Error(`${windowName} blotato-pm must wait for the AM Blotato render before starting another render`);
    }

    const rssIndex = paths.indexOf("/rss/rewrite");
    const blotatoAmIndex = paths.indexOf("/blotato/autoshorts/schedule");
    const blotatoPmIndex = tasks.findIndex((task) => task[0] === "blotato-pm");
    const dailyZernioIndex = tasks.findIndex((task) => /^zernio-(?:monday|tuesday|wednesday|thursday|friday)$/.test(task[0]));
    if (rssIndex !== 0 || blotatoAmIndex !== 1 || dailyZernioIndex !== 2) {
      throw new Error(`${windowName} must prepare the AM Blotato slot and current-day Zernio slot immediately after rss-rewrite`);
    }
    if (blotatoPmIndex <= zernioBlogIndex) {
      throw new Error(`${windowName} must finish current-day Zernio and blog-social scheduling before the later Blotato PM slot`);
    }

    const dailyZernio = tasks[dailyZernioIndex];
    if (dailyZernio && dailyZernio[5] !== "rss-rewrite") {
      throw new Error(`${windowName} ${dailyZernio[0]} must depend on rss-rewrite`);
    }

    const newsletterGenerateIndex = paths.indexOf("/newsletter/generate");
    const newsletterSendIndex = paths.indexOf("/newsletter/send");
    if (newsletterGenerateIndex < 0 || newsletterSendIndex !== newsletterGenerateIndex + 1) {
      throw new Error(`${windowName} must run newsletter generate -> send in order`);
    }
    if (tasks[newsletterSendIndex]?.[5] !== "newsletter-generate") {
      throw new Error(`${windowName} newsletter send must depend on newsletter-generate`);
    }
  }

  const mondayPaths = OPERATION_WINDOWS["monday-am"].map((task) => task[1]);
  for (const required of ["/zernio/daily/monday", "/zernio/ebooks/weekly", "/zernio/quiz/weekly"]) {
    if (!mondayPaths.includes(required)) throw new Error(`monday-am missing required content task ${required}`);
  }
  if (mondayPaths.includes("/zernio/mini-series/weekly")) {
    throw new Error("monday-am must not duplicate the mini-series already owned by the Monday Zernio lane");
  }
  const mondayWeeklyBlog = OPERATION_WINDOWS["monday-am"].find((task) => task[0] === "weekly-blog");
  if (mondayWeeklyBlog?.[5] !== "rss-rewrite") {
    throw new Error("monday-am weekly blog must depend on rss-rewrite");
  }

  const thursdayPaths = OPERATION_WINDOWS["thursday-am"].map((task) => task[1]);
  if (!thursdayPaths.includes("/zernio/daily/thursday")) throw new Error("thursday-am missing Zernio Thursday lane/podcast promo trigger");

  const fridayAmPaths = OPERATION_WINDOWS["friday-am"].map((task) => task[1]);
  for (const required of ["/zernio/daily/saturday", "/zernio/daily/sunday", "/blotato/shorts/ai-playbook/schedule"]) {
    if (!fridayAmPaths.includes(required)) throw new Error(`friday-am missing required scheduled-content task ${required}`);
  }

  const fridayPmTasks = OPERATION_WINDOWS["friday-pm"];
  const fridayPmPaths = fridayPmTasks.map((task) => task[1]);
  if (fridayPmPaths.length !== 2 || fridayPmPaths[0] !== "/podcast/readiness" || fridayPmPaths[1] !== "/podcast/run") {
    throw new Error("friday-pm must contain only podcast readiness followed by /podcast/run");
  }
  if (fridayPmTasks[1]?.[5] !== "podcast-readiness") {
    throw new Error("friday-pm podcast run must depend on podcast-readiness");
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

const ASYNC_TASK_ROUTES = Object.freeze({
  "/rss/rewrite": { statusBase: "/rss/jobs", lane: "rewrite" },
  "/blog/social/daily/build": { statusBase: "/blog/social/jobs", lane: "daily-build" },
  "/blog/weekly/build": { statusBase: "/blog/weekly/jobs", lane: "weekly-build" },
  "/newsletter/generate": { statusBase: "/newsletter/jobs", lane: "generate" },
  "/zernio/blog-rss/daily": { statusBase: "/zernio/jobs", lane: "blog-rss-daily" },
  "/zernio/ebooks/weekly": { statusBase: "/zernio/jobs", lane: "ebooks-weekly" },
  "/zernio/quiz/weekly": { statusBase: "/zernio/jobs", lane: "quiz-weekly" },
  "/zernio/daily/monday": { statusBase: "/zernio/jobs", lane: "daily-monday" },
  "/zernio/daily/tuesday": { statusBase: "/zernio/jobs", lane: "daily-tuesday" },
  "/zernio/daily/wednesday": { statusBase: "/zernio/jobs", lane: "daily-wednesday" },
  "/zernio/daily/thursday": { statusBase: "/zernio/jobs", lane: "daily-thursday" },
  "/zernio/daily/friday": { statusBase: "/zernio/jobs", lane: "daily-friday" },
  "/zernio/daily/saturday": { statusBase: "/zernio/jobs", lane: "daily-saturday" },
  "/zernio/daily/sunday": { statusBase: "/zernio/jobs", lane: "daily-sunday" },
});

function operationToken(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "task";
}

function taskSessionId(job, taskName) {
  const group = String(taskName || "").startsWith("newsletter-") ? "newsletter" : taskName;
  return `ops-${operationToken(job?.window)}-${operationToken(job?.executionId)}-${operationToken(group)}`.slice(0, 150);
}

function asyncStatusUrlFor(path, sessionId) {
  const route = ASYNC_TASK_ROUTES[path];
  if (!route) return null;
  return `${route.statusBase}/${route.lane}/${encodeURIComponent(sessionId)}`;
}

function asyncDispatchPath(path) {
  if (!ASYNC_TASK_ROUTES[path]) return path;
  return `${path}${path.includes("?") ? "&" : "?"}async=true`;
}

async function runInternalTask([name, path, body = {}, feature = null, addWeekStartDate = false], requestContext, job) {
  if (feature === "newsletter" && !operationNewsletterEnabled()) {
    return { name, path, ok: true, skipped: true, reason: "newsletter-disabled-until-brevo-ready" };
  }

  const base = normalise(process.env.AIMS_INTERNAL_BASE_URL) || `http://127.0.0.1:${process.env.PORT || 8000}`;
  const token = normalise(process.env.AIMS_API_KEY) || normalise(requestContext?.authorization).replace(/^Bearer\s+/i, "");
  const sessionId = taskSessionId(job, name);
  const idempotencyKey = `ops:${job?.executionId || job?.id || "run"}:${name}`;
  const payload = { ...body, sessionId };
  // Delivery resolves the latest durable issue for the day. The generator
  // sanitises its storage session ID, so forwarding the raw orchestration ID
  // to readiness/send would point at a non-existent prefix.
  if (name === "newsletter-send") delete payload.sessionId;
  if (ASYNC_TASK_ROUTES[path]) payload.async = true;
  if (addWeekStartDate) payload.weekStartDate = localWeekStartDate();

  // Async-capable child routes must acknowledge quickly. Their actual work is
  // tracked through the status endpoint, so the dispatch timeout is deliberately
  // shorter than the child-job timeout and avoids Node's five-minute header limit.
  const dispatchTimeoutMs = ASYNC_TASK_ROUTES[path]
    ? Math.max(15_000, Number(process.env.AIMS_OPERATION_DISPATCH_TIMEOUT_MS || 120_000))
    : Math.max(30_000, Number(process.env.AIMS_OPERATION_TASK_TIMEOUT_MS || 900_000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("operation-dispatch-timeout")), dispatchTimeoutMs);
  timeout.unref?.();
  try {
    const response = await fetch(`${base.replace(/\/+$/, "")}${asyncDispatchPath(path)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-idempotency-key": idempotencyKey,
        "x-operation-execution-id": job?.executionId || "",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let result = null;
    try { result = text ? JSON.parse(text) : null; } catch { result = text.slice(0, 1000); }

    if (response.ok && response.status === 202) {
      // If an idempotent acknowledgement was replayed by middleware, it may not
      // contain the original body. The canonical route and deterministic session
      // still let the orchestrator recover and poll the real child job.
      // The operation window owns the canonical route contract. Prefer its
      // route map over a child-provided URL so a stale or malformed service
      // acknowledgement cannot send polling to a non-existent endpoint.
      const statusUrl = asyncStatusUrlFor(path, sessionId) || extractAsyncStatusUrl(result);
      if (!statusUrl) {
        return {
          name,
          path,
          ok: false,
          status: 502,
          acceptedStatus: response.status,
          result,
          sessionId,
          error: "async-operation-status-url-missing",
        };
      }

      const asyncJob = await waitForAsyncOperation({
        baseUrl: base,
        statusUrl,
        token,
        pollIntervalMs: Math.max(1_000, Number(process.env.AIMS_OPERATION_ASYNC_POLL_INTERVAL_MS || 15_000)),
        timeoutMs: Math.max(60_000, Number(process.env.AIMS_OPERATION_ASYNC_JOB_TIMEOUT_MS || 21_600_000)),
        requestTimeoutMs: Math.max(5_000, Number(process.env.AIMS_OPERATION_ASYNC_REQUEST_TIMEOUT_MS || 60_000)),
        maxConsecutiveErrors: Math.max(1, Number(process.env.AIMS_OPERATION_ASYNC_MAX_POLL_ERRORS || 8)),
        notFoundGraceMs: Math.max(0, Number(process.env.AIMS_OPERATION_ASYNC_NOT_FOUND_GRACE_MS || 120_000)),
      });

      return {
        name,
        path,
        ok: asyncJob.ok,
        status: asyncJob.ok ? 200 : 500,
        acceptedStatus: response.status,
        result,
        sessionId,
        statusUrl: asyncJob.statusUrl,
        asyncStatus: asyncJob.status,
        asyncPolls: asyncJob.polls,
        asyncPollErrors: asyncJob.pollErrors,
        asyncJob: asyncJob.payload,
      };
    }

    const resultFailed = Boolean(
      result
      && typeof result === "object"
      && (
        result.ok === false
        || result.failed === true
        || result.partialFailure === true
        || result.quarantined === true
      )
    );
    return { name, path, ok: response.ok && !resultFailed, status: response.status, result, sessionId };
  } catch (error) {
    return {
      name,
      path,
      ok: false,
      sessionId,
      error: error?.name === "AbortError" || controller.signal.aborted
        ? "operation-dispatch-timeout"
        : (error?.message || String(error)),
      errorCode: error?.code || null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

router.get("/windows", (_req, res) => {
  res.json({
    ok: true,
    service: "ops",
    newsletterEnabled: operationNewsletterEnabled(),
    windows: Object.fromEntries(Object.entries(OPERATION_WINDOWS).map(([key, tasks]) => [key, {
      delayMs: operationDelayMs(key),
      tasks: tasks.map(([name, path, _body, feature, _addWeekStartDate, dependsOn]) => ({
        name,
        path,
        dependsOn: dependsOn || null,
        enabled: feature !== "newsletter" || operationNewsletterEnabled(),
      })),
    }])),
  });
});

const DEFERRED_OPERATION_TASKS = new Set(["blotato-am", "blotato-pm"]);

async function executeOperationWindow(job, tasks, req) {
  job.status = "running";
  job.updatedAt = new Date().toISOString();
  const pendingTasks = new Map();
  // Capture the only request value needed by delayed background work before
  // the HTTP request lifecycle ends.
  const requestContext = { authorization: normalise(req.get?.("authorization")) };

  const operationDependencyReady = (dependency) => Boolean(
    dependency?.ok
    && dependency?.result?.ok !== false
    && dependency?.result?.ready !== false
  );

  const settlePendingTask = async (taskName) => {
    const pending = pendingTasks.get(taskName);
    if (!pending) return [...job.results].reverse().find((item) => item.name === taskName) || null;

    job.currentTask = {
      name: `join:${taskName}`,
      path: pending.path,
      background: true,
      pendingTasks: [...pendingTasks.keys()],
    };
    job.updatedAt = new Date().toISOString();
    const result = await pending.promise;
    pendingTasks.delete(taskName);
    job.results[pending.resultIndex] = result;
    if (!result.ok) job.failures += 1;
    job.updatedAt = new Date().toISOString();
    return result;
  };

  for (let index = 0; index < tasks.length; index += 1) {
    if (index > 0 && job.delayMs > 0) {
      job.currentTask = { name: "delay", before: tasks[index][0], delayMs: job.delayMs, pendingTasks: [...pendingTasks.keys()] };
      job.updatedAt = new Date().toISOString();
      await sleep(job.delayMs);
    }
    const task = tasks[index];
    const [taskName, taskPath, _taskBody, _feature, _addWeekStartDate, dependsOn] = task;
    job.currentTask = {
      name: taskName,
      path: taskPath,
      index: index + 1,
      total: tasks.length,
      dependsOn: dependsOn || null,
      pendingTasks: [...pendingTasks.keys()],
    };
    job.updatedAt = new Date().toISOString();

    const deferredTask = DEFERRED_OPERATION_TASKS.has(taskName);
    if (deferredTask && dependsOn && pendingTasks.has(dependsOn)) {
      const dependencyPromise = pendingTasks.get(dependsOn).promise;
      const placeholder = {
        name: taskName,
        path: taskPath,
        ok: null,
        pending: true,
        background: true,
        queuedBehind: dependsOn,
        startedAt: new Date().toISOString(),
      };
      const resultIndex = job.results.push(placeholder) - 1;
      pendingTasks.set(taskName, {
        path: taskPath,
        resultIndex,
        promise: dependencyPromise.then((dependency) => {
          if (!operationDependencyReady(dependency)) {
            return {
              name: taskName,
              path: taskPath,
              ok: false,
              skipped: true,
              status: 424,
              reason: "operation-dependency-not-ready",
              dependsOn,
              dependency,
            };
          }
          return runInternalTask(task, requestContext, job);
        }),
      });
      job.updatedAt = new Date().toISOString();
      continue;
    }

    if (dependsOn && pendingTasks.has(dependsOn)) {
      await settlePendingTask(dependsOn);
    }

    if (dependsOn) {
      const dependency = [...job.results].reverse().find((item) => item.name === dependsOn);
      if (!operationDependencyReady(dependency)) {
        const result = {
          name: taskName,
          path: taskPath,
          ok: false,
          skipped: true,
          status: 424,
          reason: "operation-dependency-not-ready",
          dependsOn,
          dependency: dependency || null,
        };
        job.results.push(result);
        job.failures += 1;
        job.updatedAt = new Date().toISOString();
        continue;
      }
    }

    if (deferredTask) {
      const placeholder = {
        name: taskName,
        path: taskPath,
        ok: null,
        pending: true,
        background: true,
        startedAt: new Date().toISOString(),
      };
      const resultIndex = job.results.push(placeholder) - 1;
      pendingTasks.set(taskName, {
        path: taskPath,
        resultIndex,
        promise: runInternalTask(task, requestContext, job),
      });
      job.updatedAt = new Date().toISOString();
      continue;
    }

    const result = await runInternalTask(task, requestContext, job);
    job.results.push(result);
    job.updatedAt = new Date().toISOString();
    if (!result.ok) job.failures += 1;
  }

  // Deferred providers are still strict required stages. They run in the
  // background to avoid blocking independent lanes, then the window joins and
  // verifies every result before it can report completion.
  for (const taskName of [...pendingTasks.keys()]) {
    await settlePendingTask(taskName);
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
      executionId: crypto.randomUUID(),
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
