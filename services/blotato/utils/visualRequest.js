function clean(value = "") {
  return String(value ?? "").trim();
}

/**
 * Builds the Blotato videos/from-templates request in one place so UUID and
 * full-path template fallbacks cannot drift onto different provider payloads.
 *
 * Prompt-autofill is the production default. Manual template inputs are only
 * forwarded when explicitly enabled because Blotato templates can change
 * their input schema independently of AIMS.
 */
export function buildVisualCreationRequest({
  candidateTemplateId,
  visualInputs = {},
  visualPrompt,
  manualInputsConfigured = false,
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
    inputs: manualInputsConfigured ? visualInputs : {},
    prompt,
    render: true,
    isDraft: false,
    ...(useBrandKit === true ? { useBrandKit: true } : {}),
  };
}

export default { buildVisualCreationRequest };
