// services/script/index.js
// Unified export layer to expose script orchestration helpers to other services.

import { orchestrateEpisode as orchestrateScript } from "./utils/orchestrator.js";
import * as models from "./utils/models.js";

function normaliseScriptInput(input, maybeOptions = {}) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return { ...input, ...maybeOptions };
  }

  const sessionId = typeof input === "string" ? input : undefined;
  return {
    ...(maybeOptions || {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

export async function getScriptForPodcast(input, maybeOptions = {}) {
  const sessionMeta = normaliseScriptInput(input, maybeOptions);
  const result = await orchestrateScript(sessionMeta);
  return {
    ok: true,
    sessionId: sessionMeta.sessionId || result?.sessionId,
    ...result,
  };
}

export {
  orchestrateScript,
  models,
};

export default {
  orchestrateScript,
  getScriptForPodcast,
  models,
};
