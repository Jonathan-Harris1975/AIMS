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
    const entries = [...ledger.entries];
    const known = new Set(entries.map((entry) => entry.id));
    for (const render of priorRenders) {
      const id = `legacy:${render.visualId}`;
      if (!render.visualId || known.has(id) || render.reservationId) continue;
      if (!render.date?.startsWith(`${month}-`)) continue;
      entries.push({ id, date: render.date, credits: render.expectedCredits > 0 ? render.expectedCredits : 70 });
      known.add(id);
    }
    // Persist discovered renders even when they already exhaust a cap. If we
    // only kept them in memory, the 24-hour job prune would erase that spend.
    if (entries.length !== ledger.entries.length) {
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
