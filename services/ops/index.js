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
  oneup: ["ONEUP_API_KEY"],
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

router.get("/health", sendStage("health"));
router.get("/preflight", sendStage("preflight"));
router.get("/warmup", sendStage("warmup"));
router.get("/excellence", (_req, res) => {
  res.status(200).json({ ok: true, ...getOperationalExcellenceSnapshot() });
});

export default router;
