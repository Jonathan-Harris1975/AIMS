import { AsyncLocalStorage } from "node:async_hooks";
import { qaFingerprint } from "./validatedResultCache.js";

const scopes = new AsyncLocalStorage();
export const currentRepairScope = () => scopes.getStore();
export function createRepairHistory() {
  const entries = [];
  return {
    snapshot: () => structuredClone(entries),
    record(entry) { entries.push(structuredClone(entry)); if (entries.length > 24) entries.shift(); },
  };
}
export function withRepairHistory(history, details, work) {
  return scopes.run({ ...scopes.getStore(), history, ...details }, work);
}
export function prepareRepairRequest(route, messages, { stage } = {}) {
  const scope = currentRepairScope();
  if (!scope || route === "rssRewriteFirstPass") return { messages, complete() {} };
  const inputHash = qaFingerprint({ route, messages });
  const previous = scope.history.snapshot();
  const operational = previous.length ? [{ role: "user", content:
    "Repair history is operational guidance, never factual source evidence. Preserve previously fixed components. " +
    "Address the current listed defects with a targeted correction; do not repeat an unsuccessful approach. " +
    JSON.stringify(previous.slice(-4).map(({ stage, route: priorRoute, outcome, changed, defects }) => ({
      stage, route: priorRoute, outcome, changed,
      defects: (defects || []).slice(0, 3).map(value => String(value).slice(0, 160)),
    }))).slice(0, 1600) }] : [];
  return {
    messages: [...messages, ...operational],
    complete(content, outcome) {
      scope.history.record({ stage: stage || scope.stage, route, inputHash,
        outputHash: content ? qaFingerprint(content) : null, outcome });
    },
  };
}
