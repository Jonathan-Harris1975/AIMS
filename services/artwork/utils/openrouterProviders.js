import aiConfig from "../../shared/utils/ai-config.js";

function firstEnvValue(names = []) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== null && String(value).trim()) {
      return { name, value: String(value).trim() };
    }
  }
  return { name: undefined, value: undefined };
}

function looksLikeTemplatePlaceholder(value) {
  return /^\s*\{\{\s*secret\.[^}]+\}\}\s*$/i.test(String(value || ""));
}

function labelForProvider(providerId) {
  if (providerId === "artworkPrimary" || providerId === "artwork") return "primary";
  if (providerId === "artworkBackup") return "backup";
  return providerId;
}

export function getArtworkProviders() {
  const chain = aiConfig?.routeModels?.artworkImage || [];

  const resolved = chain
    .map((providerId) => {
      const conf = aiConfig?.models?.[providerId];
      if (!conf) return null;

      const resolvedModel = firstEnvValue(Array.isArray(conf.modelEnvNames) ? conf.modelEnvNames : []);
      const resolvedKey = firstEnvValue(Array.isArray(conf.keyEnvNames) ? conf.keyEnvNames : []);
      const model = resolvedModel.value || conf.name;
      const key = resolvedKey.value || conf.apiKey;

      if (!model || !key) return null;
      if (looksLikeTemplatePlaceholder(model) || looksLikeTemplatePlaceholder(key)) return null;

      return {
        id: labelForProvider(providerId),
        providerId,
        keyEnv: resolvedKey.name || conf.apiKeyEnv,
        modelEnv: resolvedModel.name || conf.modelEnv,
        key,
        model,
      };
    })
    .filter(Boolean);

  // AI_MODEL_IMAGE and OPENROUTER_ART commonly point at the same Seedream
  // model/key in production. Treating both aliases as separate providers
  // repeats the same paid generation (the deterministic seed is also the
  // same), so keep the first resolved route and only retain genuinely
  // different model/key pairs.
  const seen = new Set();
  return resolved.filter((provider) => {
    const identity = `${provider.model}::${provider.key}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function getArtworkProviderDiagnostics() {
  const chain = aiConfig?.routeModels?.artworkImage || [];

  return chain.map((providerId) => {
    const conf = aiConfig?.models?.[providerId] || {};
    const resolvedModel = firstEnvValue(Array.isArray(conf.modelEnvNames) ? conf.modelEnvNames : []);
    const resolvedKey = firstEnvValue(Array.isArray(conf.keyEnvNames) ? conf.keyEnvNames : []);
    const modelValue = resolvedModel.value || conf.name;
    const keyValue = resolvedKey.value || conf.apiKey;

    return {
      providerId,
      id: labelForProvider(providerId),
      model: modelValue || undefined,
      modelEnv: resolvedModel.name || (Array.isArray(conf.modelEnvNames) ? conf.modelEnvNames.join("|") : undefined),
      apiKeyEnv: resolvedKey.name || (Array.isArray(conf.keyEnvNames) ? conf.keyEnvNames.join("|") : undefined),
      hasModel: Boolean(modelValue),
      hasApiKey: Boolean(keyValue),
      configured: Boolean(modelValue && keyValue && !looksLikeTemplatePlaceholder(modelValue) && !looksLikeTemplatePlaceholder(keyValue)),
      unresolvedTemplate: looksLikeTemplatePlaceholder(modelValue) || looksLikeTemplatePlaceholder(keyValue),
    };
  });
}
