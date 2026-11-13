// Reserve estimated render credits before calling Blotato. The job store is
// pruned after 24 hours, so it cannot enforce a calendar-month spending cap.
import { readFileSync } from "node:fs";
import { getObjectAsTextWithMetadata, putPrivateJson } from "../../shared/utils/r2-client.js";
import { getStateFilePath, writeJsonState } from "../../shared/utils/stateFile.js";
import { hasDurableStateEnv } from "../../shared/utils/durableStateEnv.js";

function remoteBackend() {
  const mode = String(process.env.STATE_BACKEND || "auto").trim().toLowerCase();
  return !["local", "file", "filesystem"].includes(mode) && hasDurableStateEnv(process.env);
}

function missing(error) {
  const status = Number(error?.$metadata?.httpStatusCode || error?.statusCode || error?.status);
  return status === 404 || /nosuchkey|not[ -]?found/i.test(`${error?.name || ""} ${error?.code || ""}`);
}

function conflict(error) {
  const status = Number(error?.$metadata?.httpStatusCode || error?.statusCode || error?.status);
  return status === 409 || status === 412;
}

function filename(month) {
  return `blotato-credit-guard-${month}.json`;
}

async function readLedger(month) {
  if (remoteBackend()) {
    try {
      const result = await getObjectAsTextWithMetadata("metaSystem", `blotato/credit-guard/${month}.json`);
      return { ledger: JSON.parse(result.text), eTag: result.eTag, exists: true };
    } catch (error) {
      if (missing(error)) return { ledger: null, eTag: null, exists: false };
      throw error;
    }
  }
  try {
    return { ledger: JSON.parse(readFileSync(getStateFilePath(filename(month)), "utf8")), exists: true };
  } catch (error) {
    if (error?.code === "ENOENT") return { ledger: null, exists: false };
    throw error;
  }
}

async function writeLedger(month, ledger, previous) {
  if (remoteBackend()) {
    if (previous.exists && !previous.eTag) throw new Error("Blotato credit ledger has no ETag; refusing an unsafe update.");
    try {
      await putPrivateJson("metaSystem", `blotato/credit-guard/${month}.json`, ledger,
        previous.exists ? { ifMatch: previous.eTag } : { ifNoneMatch: "*" });
      return true;
    } catch (error) {
      if (conflict(error)) return false;
      throw error;
    }
  }
  if (!writeJsonState(filename(month), ledger)) throw new Error("Could not persist Blotato credit reservation.");
  return true;
}

function matchingReservation(entries, render) {
  const reservationId = String(render?.reservationId || "").trim();
  const sessionId = String(render?.sessionId || "").trim();
  const visualId = String(render?.visualId || "").trim();
  const candidates = entries.filter((entry) => !entry.id.startsWith("legacy:")
    && entry.date === render.date
    && ((reservationId && entry.id === reservationId)
      || (visualId && entry.visualId === visualId)
      || (sessionId && entry.id.startsWith(`${sessionId}:attempt-`))));
  // Multiple reservations for one session may indicate several paid render attempts.
  // Never collapse them without a unique, durable match.
  return candidates.length === 1 ? candidates[0] : null;
}

function capError(code, message, details) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  Object.assign(error, details);
  return error;
}

export async function reservePaidRender({
  reservationId, scheduleDate, expectedCredits, dailyCap, monthlyCap, priorRenders = [],
}, { read = readLedger, write = writeLedger } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)
    || !reservationId || !Number.isFinite(expectedCredits) || expectedCredits <= 0
    || !Number.isInteger(dailyCap) || dailyCap < 1
    || !Number.isInteger(monthlyCap) || monthlyCap < 1) {
    throw new Error("Invalid Blotato credit reservation parameters.");
  }
  const month = scheduleDate.slice(0, 7);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const previous = await read(month);
    const ledger = previous.ledger || { version: 1, month, entries: [] };
    if (ledger.version !== 1 || ledger.month !== month || !Array.isArray(ledger.entries)
      || ledger.entries.some((entry) => !entry?.id || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)
        || !Number.isFinite(entry.credits) || entry.credits <= 0)) {
      throw new Error(`Invalid Blotato credit ledger for ${month}; refusing a paid render.`);
    }
    const reconciledRenders = priorRenders.filter((render) => render?.visualId
      && render.date?.startsWith(`${month}-`));
    // The live failure in November 2026 exposed a legacy import of the SAME
    // visual already covered by a durable reservation. Identify it from the
    // exact reservation, persisted visual ID, or unique session/attempt prefix.
    // Do not silently refund any uncorrelated provider render.
    const entries = ledger.entries.filter((entry) => {
      if (!entry.id.startsWith("legacy:")) return true;
      const render = reconciledRenders.find((item) => entry.id === `legacy:${item.visualId}`);
      return !render || !matchingReservation(ledger.entries, render);
    });
    const known = new Set(entries.map((entry) => entry.id));
    for (const render of reconciledRenders) {
      const id = `legacy:${render.visualId}`;
      if (known.has(id) || matchingReservation(entries, render)) continue;
      entries.push({ id, date: render.date, credits: render.expectedCredits > 0 ? render.expectedCredits : 70 });
      known.add(id);
    }
    // Reconcile and import under the same conditional write. The daily/monthly
    // limits must observe the corrected ledger even across concurrent workers.
    if (entries.length !== ledger.entries.length
      || entries.some((entry, index) => entry.id !== ledger.entries[index]?.id)) {
      if (await write(month, { version: 1, month, entries }, previous)) continue;
      continue;
    }
    if (known.has(reservationId)) {
      throw capError("blotato-credit-reservation-exists", `Blotato render ${reservationId} already has a credit reservation.`, { reservationId });
    }
    const dayCount = entries.filter((entry) => entry.date === scheduleDate).length;
    if (dayCount >= dailyCap) {
      throw capError("blotato-daily-paid-render-cap",
        `Blotato daily paid-render cap reached (${dayCount}/${dailyCap}) for ${scheduleDate}. No additional video was created.`,
        { dayCount, dailyCap });
    }
    const monthToDate = entries.reduce((sum, entry) => sum + entry.credits, 0);
    if (monthToDate + expectedCredits > monthlyCap) {
      throw capError("blotato-monthly-estimated-credit-cap",
        `Blotato monthly estimated-credit cap would be exceeded (${monthToDate}+${expectedCredits}/${monthlyCap}). No paid render was started.`,
        { monthToDateEstimatedCredits: monthToDate, nextEstimatedCredits: expectedCredits, monthlyEstimatedCreditCap: monthlyCap });
    }
    entries.push({ id: reservationId, date: scheduleDate, credits: expectedCredits });
    if (await write(month, { version: 1, month, entries }, previous)) {
      return { reservationId, monthToDateEstimatedCredits: monthToDate + expectedCredits, dayCount: dayCount + 1 };
    }
  }
  throw new Error("Could not reserve Blotato credits after concurrent ledger updates; no paid render was started.");
}

/**
 * Associate the provider-created visual with its already-reserved paid render.
 * This does not reserve any extra credits and survives the 24-hour job TTL.
 */
export async function linkPaidRenderVisual({ reservationId, scheduleDate, visualId },
  { read = readLedger, write = writeLedger } = {}) {
  if (!reservationId || !visualId || !/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate || "")) {
    throw new Error("Invalid paid-render visual linkage.");
  }
  const month = scheduleDate.slice(0, 7);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const previous = await read(month);
    const entries = previous.ledger?.entries;
    if (!Array.isArray(entries)) throw new Error("Paid-render reservation ledger missing.");
    const entry = entries.find((item) => item.id === reservationId && item.date === scheduleDate);
    if (!entry) throw new Error("Paid-render reservation not found.");
    if (entry.visualId === visualId) return true;
    if (entry.visualId && entry.visualId !== visualId) throw new Error("Paid-render reservation is linked to another visual.");
    const updated = entries.map((item) => item === entry ? { ...item, visualId } : item);
    if (await write(month, { ...previous.ledger, entries: updated }, previous)) return true;
  }
  throw new Error("Could not persist paid-render visual association.");
}
