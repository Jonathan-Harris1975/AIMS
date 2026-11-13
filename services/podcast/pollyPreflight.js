// Verify actual AWS Polly speech permissions before any paid podcast generation.
// Static checks of AWS credential presence cannot detect an IAM AccessDenied.
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";

const lastCheck = { key: "", expiresAt: 0, result: null, pending: null };

function failureCode(err) {
  const source = String(err?.name || "") + " " + String(err?.message || "");
  if (/AccessDenied|Unauthorized|not authorized|not permitted/i.test(source)) return "POLLY_ACCESS_DENIED";
  if (/InvalidVoice|Validation|UnsupportedVoice|EngineNotSupported/i.test(source)) return "POLLY_VOICE_CONFIGURATION";
  if (/abort|timeout/i.test(source)) return "POLLY_PREFLIGHT_TIMEOUT";
  return "POLLY_PREFLIGHT_FAILED";
}

async function synthesizeSample({ env }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  timer.unref?.();
  const polly = new PollyClient({ region: String(env.AWS_REGION).trim() });
  try {
    const response = await polly.send(new SynthesizeSpeechCommand({
      Text: "Podcast readiness check.", VoiceId: String(env.POLLY_VOICE_ID).trim(),
      OutputFormat: "mp3", Engine: "neural",
    }), { abortSignal: controller.signal });
    const bytes = await response.AudioStream?.transformToByteArray?.();
    if (!bytes?.length) throw new Error("AWS Polly returned empty speech output");
  } finally {
    clearTimeout(timer);
    polly.destroy();
  }
}

export async function checkPodcastPollySpeech({
  env = process.env, probe = synthesizeSample, nowMs = Date.now(),
  cache = probe === synthesizeSample && env === process.env,
} = {}) {
  if (!env.AWS_REGION || !env.POLLY_VOICE_ID) {
    return { ok: false, code: "POLLY_CONFIG_MISSING", detail: "AWS region or Polly voice is missing" };
  }
  const key = [env.AWS_ACCESS_KEY_ID, env.AWS_REGION, env.POLLY_VOICE_ID].join(":");
  if (cache && lastCheck.key === key) {
    if (lastCheck.pending) return lastCheck.pending;
    if (lastCheck.result && nowMs < lastCheck.expiresAt) return lastCheck.result;
  }
  const execute = async () => {
    try {
      await probe({ env });
      return { ok: true, code: "POLLY_SYNTHESIS_VERIFIED", detail: "Speech synthesis permission verified" };
    } catch (err) {
      const code = failureCode(err);
      return { ok: false, code, detail: code === "POLLY_ACCESS_DENIED"
        ? "AWS identity lacks polly:SynthesizeSpeech permission"
        : "AWS Polly speech synthesis preflight failed" };
    }
  };
  if (!cache) return execute();
  lastCheck.key = key;
  const pending = execute().then(result => {
    if (lastCheck.pending === pending) {
      lastCheck.result = result;
      lastCheck.expiresAt = Date.now() + (result.ok ? 300_000 : 15_000);
      lastCheck.pending = null;
    }
    return result;
  });
  lastCheck.pending = pending;
  return pending;
}
