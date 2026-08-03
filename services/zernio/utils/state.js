import { readJsonState, readJsonStateFresh, writeJsonState } from "../../shared/utils/stateFile.js";

const STATE_FILE = "zernio-social-state.json";
const MAX_HISTORY = 12;
const MAX_SLOT_CLAIMS = 240;
const MAX_LEDGER = 80;
const MAX_SOURCE_HISTORY = 120;
const MAX_SPOTLIGHT_PEOPLE = 24;
const PENDING_SLOT_TTL_MS = Number(process.env.ZERNIO_SLOT_PENDING_TTL_MS || 2 * 60 * 60 * 1000);
const COMPLETED_SLOT_TTL_MS = Number(process.env.ZERNIO_SLOT_COMPLETED_TTL_MS || 90 * 24 * 60 * 60 * 1000);
const activeSlotClaims = new Set();

function emptyState() {
  return {
    lanes: {},
    quiz: {
      topics: [],
      scheduled: [],
    },
    slotClaims: [],
    weeklyLedger: [],
    spotlightPeople: [],
    usedSocialSources: [],
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
    weeklyLedger: ensureArray(state?.weeklyLedger),
    spotlightPeople: ensureArray(state?.spotlightPeople),
    usedSocialSources: ensureArray(state?.usedSocialSources),
  };
}

export function readZernioState() {
  return normaliseState(readJsonState(STATE_FILE, emptyState()));
}

export async function readZernioStateFresh() {
  return normaliseState(await readJsonStateFresh(STATE_FILE, emptyState()));
}

export function writeZernioState(state) {
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

export function buildScheduleSlotKey({ scope, scheduledDateTime, profileName, accountId, imageUrl, sourceIntentHash }) {
  return [
    normaliseSlotPart(scope || "zernio"),
    normaliseSlotPart(scheduledDateTime),
    normaliseSlotPart(profileName),
    normaliseSlotPart(accountId),
    normaliseSlotPart(imageUrl),
    normaliseSlotPart(sourceIntentHash),
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
    scope: input.scope || "zernio",
    scheduledDateTime: input.scheduledDateTime || null,
    profileName: input.profileName || null,
    accountId: input.accountId || null,
    imageUrl: input.imageUrl || null,
    sourceIntentHash: input.sourceIntentHash || null,
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

  const state = await readZernioStateFresh();
  const slotClaims = cleanSlotClaims(state.slotClaims);
  const existing = slotClaims.find((claim) => claim.key === key);
  if (existing) {
    state.slotClaims = slotClaims;
    writeZernioState(state);
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
  writeZernioState(state);

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
  const state = readZernioState();
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
  writeZernioState(state);
}

export function releaseScheduleSlot(slotClaim) {
  if (!slotClaim?.key) return;
  activeSlotClaims.delete(slotClaim.key);

  const state = readZernioState();
  const slotClaims = cleanSlotClaims(state.slotClaims).filter((claim) => {
    if (claim.key !== slotClaim.key) return true;
    return claim.state === "completed";
  });
  state.slotClaims = slotClaims;
  writeZernioState(state);
}

export function clearScheduleSlotClaim(slotClaim) {
  if (!slotClaim?.key) return;
  activeSlotClaims.delete(slotClaim.key);
  const state = readZernioState();
  state.slotClaims = cleanSlotClaims(state.slotClaims).filter((claim) => claim.key !== slotClaim.key);
  writeZernioState(state);
}

export function resetScheduleSlotClaim(input = {}) {
  const key = buildScheduleSlotKey(input);
  const state = readZernioState();
  const slotClaims = cleanSlotClaims(state.slotClaims).filter((claim) => claim.key !== key);
  const claim = makeSlotClaim(input, "pending");

  activeSlotClaims.add(key);
  state.slotClaims = [...slotClaims, claim].slice(-MAX_SLOT_CLAIMS);
  writeZernioState(state);

  return {
    claimed: true,
    duplicatePrevented: false,
    key,
    state: "pending",
    claim,
    repairedStaleCompletedSlot: true,
  };
}

export function forgetScheduleSlot(slotClaimOrKey) {
  const key = typeof slotClaimOrKey === "string" ? slotClaimOrKey : slotClaimOrKey?.key;
  if (!key) return false;

  activeSlotClaims.delete(key);
  const state = readZernioState();
  state.slotClaims = cleanSlotClaims(state.slotClaims).filter((claim) => claim.key !== key);
  writeZernioState(state);
  return true;
}

export function getLaneHistory(laneKey) {
  const state = readZernioState();
  const lane = state.lanes?.[laneKey] || {};
  return {
    topics: trimHistory(lane.topics),
    scheduled: trimHistory(lane.scheduled),
  };
}

export function recordLaneSchedule(laneKey, entry) {
  const state = readZernioState();
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
  if (entry?.topic || entry?.title) {
    state.weeklyLedger = trimHistory([
      ...ensureArray(state.weeklyLedger),
      {
        lane: laneKey,
        topic: entry?.topic || null,
        title: entry?.title || null,
        scheduledDateTime: entry?.scheduledDateTime || null,
        recordedAt: new Date().toISOString(),
      },
    ]).slice(-MAX_LEDGER);
  }
  writeZernioState(state);
  return state.lanes[laneKey];
}

export function getQuizHistory() {
  const state = readZernioState();
  return {
    topics: trimHistory(state.quiz?.topics),
    scheduled: trimHistory(state.quiz?.scheduled),
  };
}

export function recordQuizSchedule(entry) {
  const state = readZernioState();
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

  if (entry?.topic || entry?.questionTitle || entry?.answerTitle) {
    state.weeklyLedger = trimHistory([
      ...ensureArray(state.weeklyLedger),
      {
        lane: "quiz",
        topic: entry?.topic || null,
        title: entry?.questionTitle || entry?.answerTitle || null,
        scheduledDateTime: entry?.questionDateTime || null,
        recordedAt: new Date().toISOString(),
      },
    ]).slice(-MAX_LEDGER);
  }

  writeZernioState(state);
  return state.quiz;
}


function normaliseIdentity(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function socialSourceKey({ title = "", link = "" } = {}) {
  const normalisedLink = String(link || "").trim().replace(/\/$/, "").toLowerCase();
  return normalisedLink || normaliseIdentity(title).slice(0, 180);
}

export function getWeeklyTopicLedger() {
  const state = readZernioState();
  const entries = ensureArray(state.weeklyLedger).slice(-MAX_LEDGER);
  return {
    topics: entries.map((entry) => [entry.lane, entry.topic || entry.title].filter(Boolean).join(": ")).filter(Boolean).slice(-12),
    entries,
  };
}

export function isRecentSpotlightPerson(person) {
  const key = normaliseIdentity(person);
  if (!key) return false;
  const state = readZernioState();
  return ensureArray(state.spotlightPeople).slice(-12).some((entry) => normaliseIdentity(entry?.person) === key);
}

export function recordSpotlightPerson(person, context = {}) {
  const cleaned = String(person || "").trim();
  if (!cleaned) return readZernioState().spotlightPeople || [];
  const state = readZernioState();
  const key = normaliseIdentity(cleaned);
  state.spotlightPeople = [
    ...ensureArray(state.spotlightPeople).filter((entry) => normaliseIdentity(entry?.person) !== key),
    {
      person: cleaned,
      topic: context.topic || null,
      title: context.title || null,
      scheduledDateTime: context.scheduledDateTime || null,
      recordedAt: new Date().toISOString(),
    },
  ].slice(-MAX_SPOTLIGHT_PEOPLE);
  writeZernioState(state);
  return state.spotlightPeople;
}

export function hasRecentSocialSource(source = {}) {
  const key = socialSourceKey(source);
  if (!key) return false;
  const state = readZernioState();
  return ensureArray(state.usedSocialSources).some((entry) => entry?.key === key);
}

export function recordUsedSocialSource(source = {}) {
  const key = socialSourceKey(source);
  if (!key) return readZernioState().usedSocialSources || [];
  const state = readZernioState();
  state.usedSocialSources = [
    ...ensureArray(state.usedSocialSources).filter((entry) => entry?.key !== key),
    {
      key,
      lane: source.lane || null,
      title: source.title || null,
      link: source.link || null,
      pubDate: source.pubDate || null,
      scheduledDateTime: source.scheduledDateTime || null,
      recordedAt: new Date().toISOString(),
    },
  ].slice(-MAX_SOURCE_HISTORY);
  writeZernioState(state);
  return state.usedSocialSources;
}
