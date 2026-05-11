import { readJsonState, readJsonStateFresh, writeJsonState } from "../../shared/utils/stateFile.js";

const STATE_FILE = "oneup-social-state.json";
const MAX_HISTORY = 12;
const MAX_SLOT_CLAIMS = 240;
const PENDING_SLOT_TTL_MS = Number(process.env.ONEUP_SLOT_PENDING_TTL_MS || 2 * 60 * 60 * 1000);
const COMPLETED_SLOT_TTL_MS = Number(process.env.ONEUP_SLOT_COMPLETED_TTL_MS || 90 * 24 * 60 * 60 * 1000);
const activeSlotClaims = new Set();

function emptyState() {
  return {
    lanes: {},
    quiz: {
      topics: [],
      scheduled: [],
    },
    slotClaims: [],
  };
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normaliseState(raw) {
  const state = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : emptyState();
  return {
    lanes: state?.lanes && typeof state.lanes === "object" ? state.lanes : {},
    quiz: {
      topics: ensureArray(state?.quiz?.topics),
      scheduled: ensureArray(state?.quiz?.scheduled),
    },
    slotClaims: ensureArray(state?.slotClaims),
  };
}

export function readOneUpState() {
  return normaliseState(readJsonState(STATE_FILE, emptyState()));
}

export async function readOneUpStateFresh() {
  return normaliseState(await readJsonStateFresh(STATE_FILE, emptyState()));
}

export function writeOneUpState(state) {
  writeJsonState(STATE_FILE, normaliseState(state));
}

function trimHistory(values) {
  return ensureArray(values).slice(-MAX_HISTORY);
}

function normaliseSlotPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function buildScheduleSlotKey({ scope, scheduledDateTime, categoryName, socialNetworkId, imageUrl }) {
  return [
    normaliseSlotPart(scope || "oneup"),
    normaliseSlotPart(scheduledDateTime),
    normaliseSlotPart(categoryName),
    normaliseSlotPart(socialNetworkId),
    normaliseSlotPart(imageUrl),
  ].join("|");
}

function cleanSlotClaims(claims, now = Date.now()) {
  return ensureArray(claims)
    .filter((claim) => claim && typeof claim.key === "string")
    .filter((claim) => {
      const expiresAt = Number(claim.expiresAt) || 0;
      return expiresAt > now;
    })
    .slice(-MAX_SLOT_CLAIMS);
}

function slotTtlForState(state) {
  return state === "completed" ? COMPLETED_SLOT_TTL_MS : PENDING_SLOT_TTL_MS;
}

function makeSlotClaim(input, state = "pending") {
  const now = Date.now();
  return {
    key: buildScheduleSlotKey(input),
    scope: input.scope || "oneup",
    scheduledDateTime: input.scheduledDateTime || null,
    categoryName: input.categoryName || null,
    socialNetworkId: input.socialNetworkId || null,
    imageUrl: input.imageUrl || null,
    state,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAt: now + slotTtlForState(state),
    result: input.result || null,
  };
}

export async function claimScheduleSlot(input = {}) {
  const key = buildScheduleSlotKey(input);
  if (activeSlotClaims.has(key)) {
    return {
      claimed: false,
      duplicatePrevented: true,
      key,
      state: "pending",
      reason: "same-slot-already-running",
    };
  }

  const state = await readOneUpStateFresh();
  const slotClaims = cleanSlotClaims(state.slotClaims);
  const existing = slotClaims.find((claim) => claim.key === key);
  if (existing) {
    state.slotClaims = slotClaims;
    writeOneUpState(state);
    return {
      claimed: false,
      duplicatePrevented: true,
      key,
      state: existing.state || "pending",
      reason: existing.state === "completed" ? "same-slot-already-completed" : "same-slot-already-claimed",
      existing,
    };
  }

  const claim = makeSlotClaim(input, "pending");
  activeSlotClaims.add(key);
  state.slotClaims = [...slotClaims, claim].slice(-MAX_SLOT_CLAIMS);
  writeOneUpState(state);

  return {
    claimed: true,
    duplicatePrevented: false,
    key,
    state: "pending",
    claim,
  };
}

export function completeScheduleSlot(slotClaim, result = {}) {
  if (!slotClaim?.key) return;
  const now = Date.now();
  const state = readOneUpState();
  const slotClaims = cleanSlotClaims(state.slotClaims, now);
  const index = slotClaims.findIndex((claim) => claim.key === slotClaim.key);
  const existing = index >= 0 ? slotClaims[index] : { key: slotClaim.key };
  const completed = {
    ...existing,
    key: slotClaim.key,
    state: "completed",
    updatedAt: new Date(now).toISOString(),
    expiresAt: now + COMPLETED_SLOT_TTL_MS,
    result,
  };

  if (index >= 0) {
    slotClaims[index] = completed;
  } else {
    slotClaims.push(completed);
  }

  activeSlotClaims.delete(slotClaim.key);
  state.slotClaims = slotClaims.slice(-MAX_SLOT_CLAIMS);
  writeOneUpState(state);
}

export function releaseScheduleSlot(slotClaim) {
  if (!slotClaim?.key) return;
  activeSlotClaims.delete(slotClaim.key);

  const state = readOneUpState();
  const slotClaims = cleanSlotClaims(state.slotClaims).filter((claim) => {
    if (claim.key !== slotClaim.key) return true;
    return claim.state === "completed";
  });
  state.slotClaims = slotClaims;
  writeOneUpState(state);
}

export function getLaneHistory(laneKey) {
  const state = readOneUpState();
  const lane = state.lanes?.[laneKey] || {};
  return {
    topics: trimHistory(lane.topics),
    scheduled: trimHistory(lane.scheduled),
  };
}

export function recordLaneSchedule(laneKey, entry) {
  const state = readOneUpState();
  const lane = state.lanes?.[laneKey] || { topics: [], scheduled: [] };
  const topics = trimHistory([...ensureArray(lane.topics), entry?.topic].filter(Boolean));
  const scheduled = trimHistory([
    ...ensureArray(lane.scheduled).filter((item) => item?.scheduledDateTime !== entry?.scheduledDateTime),
    {
      scheduledDateTime: entry?.scheduledDateTime,
      topic: entry?.topic || null,
      title: entry?.title || null,
      imageUrl: entry?.imageUrl || null,
      recordedAt: new Date().toISOString(),
    },
  ]);

  state.lanes[laneKey] = { topics, scheduled };
  writeOneUpState(state);
  return state.lanes[laneKey];
}

export function getQuizHistory() {
  const state = readOneUpState();
  return {
    topics: trimHistory(state.quiz?.topics),
    scheduled: trimHistory(state.quiz?.scheduled),
  };
}

export function recordQuizSchedule(entry) {
  const state = readOneUpState();
  state.quiz = {
    topics: trimHistory([...ensureArray(state.quiz?.topics), entry?.topic].filter(Boolean)),
    scheduled: trimHistory([
      ...ensureArray(state.quiz?.scheduled).filter((item) => item?.questionDateTime !== entry?.questionDateTime),
      {
        questionDateTime: entry?.questionDateTime,
        answerDateTime: entry?.answerDateTime,
        topic: entry?.topic || null,
        questionTitle: entry?.questionTitle || null,
        answerTitle: entry?.answerTitle || null,
        recordedAt: new Date().toISOString(),
      },
    ]),
  };
  writeOneUpState(state);
  return state.quiz;
}
