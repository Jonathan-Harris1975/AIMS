import { spawnSync } from "node:child_process";

function value(env, name) {
  const text = String(env?.[name] ?? "").trim();
  if (!text || /^\{\{\s*secret\.[^}]+\}\}$/i.test(text)) return "";
  return text;
}

function oneOf(env, names) {
  for (const name of names) {
    const found = value(env, name);
    if (found) return { name, value: found };
  }
  return null;
}

function validHttpsUrl(input) {
  try {
    const parsed = new URL(String(input || ""));
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function commandAvailable(command) {
  const result = spawnSync(command, ["-version"], {
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  return result.status === 0 && !result.error;
}

export function getPodcastReadiness({ env = process.env, checkCommand = commandAvailable } = {}) {
  const checks = [];
  const requireEnv = (name, detail = name) => {
    const configured = Boolean(value(env, name));
    checks.push({ name: `env:${name}`, ok: configured, detail: configured ? "configured" : `${detail} missing` });
  };
  const requireOneOf = (name, names) => {
    const configured = oneOf(env, names);
    checks.push({ name, ok: Boolean(configured), detail: configured ? `configured via ${configured.name}` : `one of ${names.join(", ")} is required` });
  };
  const requireUrl = (name, names) => {
    const configured = oneOf(env, names);
    const ok = Boolean(configured && validHttpsUrl(configured.value));
    checks.push({
      name,
      ok,
      detail: ok ? `valid HTTPS URL via ${configured.name}` : `a valid HTTPS URL is required via ${names.join(", ")}`,
    });
  };

  requireEnv("OPENROUTER_API_KEY");
  requireOneOf("podcast_model", ["OPENROUTER_CLAUDE_SONNET_5", "OPENROUTER_GPT_5_6_SOL", "AI_MODEL_HIGH_QUALITY"]);
  requireEnv("AWS_ACCESS_KEY_ID");
  requireEnv("AWS_SECRET_ACCESS_KEY");
  requireEnv("AWS_REGION");
  requireEnv("POLLY_VOICE_ID");
  requireOneOf("r2_endpoint", ["R2_ENDPOINT", "R2_ENDPOINT_URL"]);
  requireEnv("R2_ACCESS_KEY_ID");
  requireEnv("R2_SECRET_ACCESS_KEY");

  for (const bucket of [
    "R2_BUCKET_PODCAST",
    "R2_BUCKET_CHUNKS",
    "R2_BUCKET_MERGED",
    "R2_BUCKET_EDITED_AUDIO",
    "R2_BUCKET_META",
    "R2_BUCKET_ART",
    "R2_BUCKET_TRANSCRIPTS",
    "R2_BUCKET_PODCAST_RSS_FEEDS",
    "R2_BUCKET_RAW_TEXT",
  ]) {
    requireEnv(bucket);
  }

  requireUrl("podcast_intro_url", ["PODCAST_INTRO_URL"]);
  requireUrl("podcast_outro_url", ["PODCAST_OUTRO_URL"]);
  requireUrl("podcast_public_url", ["R2_PUBLIC_BASE_URL_PODCAST"]);
  requireUrl("podcast_art_public_url", ["R2_PUBLIC_BASE_URL_ART"]);
  requireUrl("podcast_meta_public_url", ["R2_PUBLIC_BASE_URL_META"]);
  requireUrl("podcast_rss_public_url", ["R2_PUBLIC_BASE_URL_PODCAST_RSS"]);
  requireUrl("podcast_transcript_public_url", ["R2_PUBLIC_BASE_URL_TRANSCRIPT_HTML", "R2_PUBLIC_BASE_URL_TRANSCRIPT"]);

  const durationSetting = oneOf(env, ["PODCAST_TARGET_MINUTES", "PODCAST_DURATION_MINUTES", "PODCAST_DURATION_MINS", "PODCAST_TARGET_MINS"]);
  const targetMinutes = Number(durationSetting?.value || 60);
  checks.push({
    name: "podcast_target_minutes",
    ok: Number.isFinite(targetMinutes) && targetMinutes >= 30 && targetMinutes <= 60,
    detail: Number.isFinite(targetMinutes)
      ? `${targetMinutes} minutes via ${durationSetting?.name || "default"}`
      : "invalid number",
  });

  for (const command of ["ffmpeg", "ffprobe"]) {
    const available = Boolean(checkCommand(command));
    checks.push({ name: `binary:${command}`, ok: available, detail: available ? "available" : "not available" });
  }

  const ready = checks.every((check) => check.ok);
  return {
    ready,
    status: ready ? "ready" : "blocked",
    service: "podcast",
    checks,
    targetMinutes,
    time: new Date().toISOString(),
  };
}

export default getPodcastReadiness;
