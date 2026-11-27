import { createHash, randomUUID } from "node:crypto";
import { hasDurableStateEnv } from "../../shared/utils/durableStateEnv.js";
import { info, warn } from "../../../logger.js";

export const VISUAL_EVIDENCE_PREFIX = "visual-quality/artwork";
const sha = (value) => createHash("sha256").update(String(value || "")).digest("hex");
export function reportedCost(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const cost = Number(value);
  return Number.isFinite(cost) && cost >= 0 ? cost : null;
}
export function imageDigest(image) {
  return createHash("sha256").update(Buffer.from(String(image || "").replace(/^data:[^,]+,/, ""), "base64")).digest("hex");
}

export function createVisualEvidenceTracker({ mode, prompt, now = new Date(), benchmark = false } = {}) {
  const record = { version: 1, id: randomUUID(), createdAt: now.toISOString(), mode, benchmark, briefHash: sha(prompt), attempts: [], qaUsage: [] };
  return {
    record,
    begin(model, instruction) {
      const row = { model, promptHash: sha(instruction), costUsd: null, status: "unknown", qaPass: null, qaScore: null };
      record.attempts.push(row);
      return row;
    },
    returned(row, json, image) {
      row.costUsd = reportedCost(json?.usage?.cost);
      row.status = image ? "generated" : "missing-image";
      row.assetHash = image ? imageDigest(image) : null;
    },
    reviewed(row, qa) {
      row.qaPass = qa?.pass === true;
      row.qaScore = typeof qa?.score === "number" && Number.isFinite(qa.score) ? qa.score : null;
    },
    qaUsage(event) {
      record.qaUsage.push({ model: event?.model || null, costUsd: reportedCost(event?.usage?.cost), responseId: event?.responseId || null });
    },
    finish(image) {
      record.assetHash = image ? imageDigest(image) : null;
      const accepted = image ? record.attempts.filter((item) => item.assetHash === record.assetHash).at(-1) : null;
      record.status = image ? (accepted?.qaPass === true ? "qa-accepted" : "returned-unverified") : "failed";
      record.acceptedModel = accepted?.model || null;
      return record;
    },
  };
}

export async function persistVisualEvidence(record) {
  info("artwork.generation.evidence", record);
  if (!hasDurableStateEnv()) return { status: "not-configured" };
  try {
    const { putPrivateJson } = await import("../../shared/utils/r2-client.js");
    const key = VISUAL_EVIDENCE_PREFIX + "/" + record.createdAt.slice(0, 10) + "/" + record.id + ".json";
    await putPrivateJson("metaSystem", key, record, { ifNoneMatch: "*" });
    return { status: "persisted" };
  } catch (error) {
    warn("artwork.generation.evidence_unavailable", { id: record.id, error: String(error?.message || error).slice(0, 200) });
    return { status: "unavailable" };
  }
}

export function summariseArtworkEvidence(records = []) {
  const models = new Map(), assets = new Set(), duplicateAssets = new Set();
  let accepted = 0, knownCostUsd = 0, unknownCosts = 0;
  const production = records.filter((record) => record?.version === 1 && record.benchmark !== true);
  for (const record of production) {
    if (record.status === "qa-accepted") accepted++;
    if (record.assetHash) {
      if (assets.has(record.assetHash)) duplicateAssets.add(record.assetHash);
      assets.add(record.assetHash);
    }
    for (const row of [...(record.attempts || []), ...(record.qaUsage || [])]) {
      const cost = reportedCost(row.costUsd);
      if (cost === null) unknownCosts++;
      else knownCostUsd += cost;
    }
    for (const row of record.attempts || []) {
      const model = models.get(row.model) || { model: row.model, attempts: 0, qaAccepted: 0, reviewed: 0, scoreTotal: 0, knownCostUsd: 0, unknownCosts: 0 };
      model.attempts++;
      if (row.qaPass === true) model.qaAccepted++;
      if (typeof row.qaScore === "number" && Number.isFinite(row.qaScore)) { model.reviewed++; model.scoreTotal += row.qaScore; }
      const cost = reportedCost(row.costUsd);
      if (cost === null) model.unknownCosts++;
      else model.knownCostUsd += cost;
      models.set(row.model, model);
    }
  }
  const perModel = [...models.values()].map(({ scoreTotal, ...model }) => ({
    ...model, averageQaScore: model.reviewed ? scoreTotal / model.reviewed : null,
    generationCostPerQaAcceptedUsd: model.qaAccepted && !model.unknownCosts ? model.knownCostUsd / model.qaAccepted : null,
  }));
  return { records: production.length, qaAccepted: accepted, duplicateAssetCount: duplicateAssets.size,
    knownCostUsd, unknownCosts, costPerQaAcceptedUsd: accepted && !unknownCosts ? knownCostUsd / accepted : null,
    models: perModel, costBasis: "provider-reported image and returned QA usage; unknown costs are never estimated",
    comparisonBasis: "observational production outcomes; not a controlled benchmark" };
}

export async function collectArtworkEvidence({ now = new Date(), days = 31 } = {}) {
  if (!hasDurableStateEnv()) return { status: "not-configured", ...summariseArtworkEvidence() };
  try {
    const { listObjects, getObjectAsBuffer } = await import("../../shared/utils/r2-client.js");
    const start = new Date(now.getTime() - (Math.min(31, Math.max(1, days)) - 1) * 86400000).toISOString().slice(0, 10);
    const end = now.toISOString().slice(0, 10);
    const months = [...new Set(Array.from({ length: Math.min(31, Math.max(1, days)) }, (_, i) =>
      new Date(now.getTime() - i * 86400000).toISOString().slice(0, 7)))];
    const objects = (await Promise.all(months.map((month) => listObjects("metaSystem", VISUAL_EVIDENCE_PREFIX + "/" + month)))).flat();
    const selected = objects.filter((item) => {
      const date = item.key.split("/").at(-2);
      return date >= start && date <= end && item.key.endsWith(".json");
    }).sort((a, b) => b.key.localeCompare(a.key));
    const records = [], limit = 500;
    let unreadable = 0;
    for (let i = 0; i < Math.min(selected.length, limit); i += 8) {
      const batch = await Promise.allSettled(selected.slice(i, Math.min(i + 8, limit)).map(async (item) =>
        JSON.parse((await getObjectAsBuffer("metaSystem", item.key, { maxBytes: 128000 })).toString("utf8"))));
      for (const item of batch) {
        if (item.status === "fulfilled" && item.value?.version === 1) records.push(item.value);
        else unreadable++;
      }
    }
    const summary = summariseArtworkEvidence(records);
    const benchmarkRows = records.filter((record) => record.benchmark === true);
    const benchmark = summariseArtworkEvidence(benchmarkRows.map((record) => ({ ...record, benchmark: false })));
    benchmark.comparisonBasis = "operator-invoked matched creative briefs; no automatic model promotion";
    benchmark.status = benchmarkRows.length ? "observed" : "not-run";
    const incomplete = unreadable > 0 || selected.length > limit;
    return { ...summary, benchmark, status: incomplete ? "partial" : records.length ? "observed" : "no-evidence",
      start, end, unreadable, truncated: selected.length > limit,
      costPerQaAcceptedUsd: incomplete ? null : summary.costPerQaAcceptedUsd };
  } catch (error) {
    return { status: "unavailable", reason: String(error?.message || error).slice(0, 200), ...summariseArtworkEvidence() };
  }
}

export async function checkArtworkDuplicate({ image, briefHash, now = new Date(), storage } = {}) {
  if (!storage && !hasDurableStateEnv()) return { status: "not-configured", duplicate: false };
  try {
    const { putPrivateJson, getObjectAsText } = storage || await import("../../shared/utils/r2-client.js");
    const assetHash = imageDigest(image);
    const key = "visual-quality/asset-index/" + assetHash + ".json";
    try {
      await putPrivateJson("metaSystem", key, { version: 1, briefHash, createdAt: now.toISOString() }, { ifNoneMatch: "*" });
      return { status: "claimed", duplicate: false };
    } catch (error) {
      const status = Number(error?.$metadata?.httpStatusCode || error?.statusCode || error?.status);
      if (![409, 412].includes(status) && !["PreconditionFailed", "ConditionalRequestConflict"].includes(error?.name)) throw error;
      const prior = JSON.parse(await getObjectAsText("metaSystem", key));
      if (prior?.version !== 1 || typeof prior.briefHash !== "string") throw new Error("Invalid stored asset ownership evidence");
      return { status: "existing", duplicate: prior.briefHash !== briefHash };
    }
  } catch (error) {
    return { status: "unavailable", duplicate: false, reason: String(error?.message || error).slice(0, 200) };
  }
}
