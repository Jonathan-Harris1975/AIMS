/**
 * Builds the Blotato template request without coupling the payload shape to
 * whether the provider exposes a bare UUID or a legacy full template path.
 *
 * This preserves the proven 31 July contract: the generated visual prompt is
 * always supplied, while `inputs` remains empty unless manual template inputs
 * have been explicitly enabled. A template path is an ID fallback only.
 */
export function buildVisualCreationRequest({
  candidateTemplateId,
  visualInputs = {},
  visualPrompt = "",
  manualInputsConfigured = false,
  useBrandKit = false,
} = {}) {
  const templateId = String(candidateTemplateId || "").trim();
  const prompt = String(visualPrompt || "").trim();

  if (!templateId) {
    const error = new Error("A Blotato template ID is required.");
    error.statusCode = 400;
    throw error;
  }
  if (!prompt) {
    const error = new Error("A Blotato visual prompt is required.");
    error.statusCode = 422;
    throw error;
  }

  return {
    templateId,
    inputs: manualInputsConfigured ? visualInputs : {},
    prompt,
    render: true,
    isDraft: false,
    useBrandKit: Boolean(useBrandKit),
  };
}

export default { buildVisualCreationRequest };
