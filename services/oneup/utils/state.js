import { readJsonState, writeJsonState } from "../../shared/utils/stateFile.js";

const STATE_FILE = "oneup-social-state.json";
const MAX_HISTORY = 12;

function emptyState() {
  return {
    lanes: {},
    quiz: {
      topics: [],
      scheduled: [],
    },
  };
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

export function readOneUpState() {
  const state = readJsonState(STATE_FILE, emptyState());
  return {
    lanes: state?.lanes && typeof state.lanes === "object" ? state.lanes : {},
    quiz: {
      topics: ensureArray(state?.quiz?.topics),
      scheduled: ensureArray(state?.quiz?.scheduled),
    },
  };
}

export function writeOneUpState(state) {
  writeJsonState(STATE_FILE, state);
}

function trimHistory(values) {
  return ensureArray(values).slice(-MAX_HISTORY);
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
