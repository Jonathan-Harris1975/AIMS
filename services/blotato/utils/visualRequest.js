function clean(value = "") {
  return String(value ?? "").trim();
}

const DEFAULT_AI_STORY_VOICE = "Daniel (British, authoritative)";
const GEORGE_AI_STORY_VOICE = "George (British, warm)";
const DANIEL_VOICE_ID = "elevenlabs/eleven_multilingual_v2/cjVigY5qzO86Huf0OWal";
const GEORGE_VOICE_ID = "elevenlabs/eleven_multilingual_v2/cgSgspJ2msm6clMCkdW9";

/**
 * The AI Video with AI Voice template accepts its friendly `voiceName` enum,
 * while Blotato's generic voice catalogue also publishes provider voice IDs.
 * Normalise those IDs and the invalid legacy George label into supported
 * template values before a paid render is created.
 */
export function normaliseBlotatoVoiceName(value = "") {
  const raw = clean(value);
  const key = raw.toLowerCase().replace(/\s+/g, " ");
  if (!raw) return DEFAULT_AI_STORY_VOICE;
  if (key === "george (british, authoritative)" || key === DANIEL_VOICE_ID.toLowerCase()) {
    return DEFAULT_AI_STORY_VOICE;
  }
  if (key === GEORGE_VOICE_ID.toLowerCase()) return GEORGE_AI_STORY_VOICE;
  return raw;
}

const AI_STORY_INPUT_KEYS = Object.freeze([
  "voiceName",
  "aiImageModel",
  "animateAiImages",
  "captionPosition",
  "highlightColor",
  "transition",
  "aspectRatio",
  "trimToVoiceover",
]);

/**
 * Keep the provider payload aligned with Blotato's documented AI Video with
 * AI Voice template. AIMS carries extra editorial metadata beside these
 * values, but unknown template inputs must never be sent to the paid render
 * endpoint.
 */
export function buildAiStoryTemplateInputs(visualInputs = {}) {
  const scenes = Array.isArray(visualInputs?.scenes)
    ? visualInputs.scenes
        .map((scene) => ({
          mediaSource: clean(scene?.mediaSource),
          script: clean(scene?.script),
        }))
        .filter((scene) => scene.mediaSource && scene.script)
        .slice(0, 20)
    : [];

  if (!scenes.length) {
    const error = new Error("Blotato AI Voice template requires at least one complete scene before rendering");
    error.statusCode = 422;
    throw error;
  }

  const inputs = { scenes };
  for (const key of AI_STORY_INPUT_KEYS) {
    const value = visualInputs?.[key];
    if (value === undefined || value === null || value === "") continue;
    inputs[key] = value;
  }
  return inputs;
}

/**
 * Builds the Blotato videos/from-templates request in one place so UUID and
 * full-path template fallbacks cannot drift onto different provider payloads.
 *
 * The exact scene storyboard is the production default. Blotato documents
 * that manual inputs take precedence over prompt-autofill; sending the scenes
 * prevents its autofill step from replacing source-grounded visuals with a
 * generic interpretation of the long editorial prompt.
 */
export function buildVisualCreationRequest({
  candidateTemplateId,
  visualInputs = {},
  visualPrompt,
  manualInputsConfigured = true,
  useBrandKit = false,
} = {}) {
  const templateId = clean(candidateTemplateId);
  if (!templateId) {
    const error = new Error("Blotato template ID is required before creating a visual");
    error.statusCode = 400;
    throw error;
  }

  const prompt = clean(visualPrompt);
  if (!prompt) {
    const error = new Error("Blotato visual prompt is required before creating a visual");
    error.statusCode = 400;
    throw error;
  }

  return {
    templateId,
    inputs: manualInputsConfigured ? buildAiStoryTemplateInputs(visualInputs) : {},
    prompt,
    render: true,
    isDraft: false,
    ...(useBrandKit === true ? { useBrandKit: true } : {}),
  };
}

export default { buildVisualCreationRequest, normaliseBlotatoVoiceName };
